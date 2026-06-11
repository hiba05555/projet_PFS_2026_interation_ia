'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3401;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const taskSchema = z.object({
  title:       z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  priority:    z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assigned_to: z.string().uuid().optional(),
  project_id:  z.string().uuid().optional(),
  tags:        z.array(z.string().max(50)).max(10).optional(),
});

const taskUpdateSchema = taskSchema.partial().extend({
  status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'ops-tasks', status: 'healthy', port: PORT }));

// Mes tâches
app.get('/my-tasks', verifyToken,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [req.user.id]; const conds = [`assigned_to = $1`];
    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    const r = await pool.query(
      `SELECT * FROM ops_schema.tasks WHERE ${conds.join(' AND ')} ORDER BY due_date ASC NULLS LAST, priority DESC`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

// Tâches en retard
app.get('/overdue', verifyToken,
  asyncHandler(async (req, res) => {
    const params = [];
    let cond = `due_date < NOW() AND status NOT IN ('done','cancelled')`;
    if (req.user.role !== 'admin' && req.user.department !== 'Operations') {
      params.push(req.user.id);
      cond += ` AND (assigned_to = $1 OR created_by = $1)`;
    }
    const r = await pool.query(`SELECT * FROM ops_schema.tasks WHERE ${cond} ORDER BY due_date ASC`, params);
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

app.get('/', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority, project_id, assigned_to } = req.query;
    const params = []; const conds = [];

    // Accès : opérations voit tout, autres voient leurs tâches
    if (req.user.role !== 'admin' && req.user.department !== 'Operations') {
      params.push(req.user.id);
      conds.push(`(assigned_to = $${params.length} OR created_by = $${params.length})`);
    }

    if (status)      { params.push(status);      conds.push(`status = $${params.length}`); }
    if (priority)    { params.push(priority);    conds.push(`priority = $${params.length}`); }
    if (project_id)  { params.push(project_id);  conds.push(`project_id = $${params.length}`); }
    if (assigned_to) { params.push(assigned_to); conds.push(`assigned_to = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM ops_schema.tasks ${where} ORDER BY priority DESC, due_date ASC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM ops_schema.tasks ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM ops_schema.tasks WHERE task_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Tâche introuvable.' });
    const task = r.rows[0];
    // Vérifier l'accès si non admin/ops
    if (req.user.role !== 'admin' && req.user.department !== 'Operations' &&
        task.assigned_to !== req.user.id && task.created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    res.json({ success: true, data: task });
  })
);

app.post('/', verifyToken,
  asyncHandler(async (req, res) => {
    const data = taskSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO ops_schema.tasks
         (title, description, priority, due_date, assigned_to, project_id, tags, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'todo') RETURNING *`,
      [data.title, data.description, data.priority, data.due_date, data.assigned_to,
       data.project_id, JSON.stringify(data.tags || []), req.user.id]
    );
    res.status(201).json({ success: true, message: 'Tâche créée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const data = taskUpdateSchema.parse(req.body);
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide.' });

    // Seul l'assigné ou admin/ops peut modifier
    const current = await pool.query('SELECT * FROM ops_schema.tasks WHERE task_id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ success: false, message: 'Tâche introuvable.' });
    const task = current.rows[0];
    if (req.user.role !== 'admin' && req.user.department !== 'Operations' &&
        task.assigned_to !== req.user.id && task.created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    // Ajouter completed_at si statut → done
    if (data.status === 'done') data.completed_at = new Date().toISOString();

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE ops_schema.tasks SET ${fields.join(', ')}, updated_at = NOW()
       WHERE task_id = $${values.length} RETURNING *`, values
    );
    res.json({ success: true, message: 'Tâche mise à jour.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE ops_schema.tasks SET status = 'cancelled', updated_at = NOW()
       WHERE task_id = $1 AND status NOT IN ('done','cancelled') RETURNING task_id, title`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Tâche introuvable ou déjà terminée.' });
    res.json({ success: true, message: 'Tâche annulée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ ops-tasks sur le port ${PORT}`));
