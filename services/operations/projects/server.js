'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3404;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const projectSchema = z.object({
  name:         z.string().min(2).max(200),
  description:  z.string().max(2000).optional(),
  manager_id:   z.string().uuid().optional(),
  budget:       z.number().positive().optional(),
  currency:     z.string().length(3).default('MAD'),
  start_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority:     z.enum(['low','medium','high','critical']).default('medium'),
  tags:         z.array(z.string().max(50)).max(10).optional(),
});

const projectUpdateSchema = projectSchema.partial().extend({
  status: z.enum(['planning','active','on_hold','completed','cancelled']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

const memberSchema = z.object({
  user_id: z.string().uuid(),
  role:    z.enum(['member','lead','observer']).default('member'),
});

app.get('/health', (_req, res) => res.json({ service: 'ops-projects', status: 'healthy', port: PORT }));

// Statistiques globales
app.get('/stats', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='active') as active,
         COUNT(*) FILTER (WHERE status='completed') as completed,
         COUNT(*) FILTER (WHERE status='on_hold') as on_hold,
         COUNT(*) FILTER (WHERE status='planning') as planning,
         ROUND(AVG(progress),1) as avg_progress
       FROM ops_schema.projects`
    );
    res.json({ success: true, data: r.rows[0] });
  })
);

app.get('/', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority } = req.query;
    const params = []; const conds = [];

    // Non-ops : voir seulement les projets où ils sont membres
    if (req.user.role !== 'admin' && req.user.department !== 'Operations') {
      params.push(req.user.id);
      conds.push(`p.project_id IN (SELECT project_id FROM ops_schema.project_members WHERE user_id = $${params.length})`);
    }

    if (status)   { params.push(status);   conds.push(`p.status = $${params.length}`); }
    if (priority) { params.push(priority); conds.push(`p.priority = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT p.*, COUNT(pm.user_id) as member_count
         FROM ops_schema.projects p
         LEFT JOIN ops_schema.project_members pm ON p.project_id = pm.project_id
         ${where} GROUP BY p.project_id
         ORDER BY p.start_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM ops_schema.projects p ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT p.*, COALESCE(json_agg(pm.*) FILTER (WHERE pm.user_id IS NOT NULL), '[]') as members
       FROM ops_schema.projects p
       LEFT JOIN ops_schema.project_members pm ON p.project_id = pm.project_id
       WHERE p.project_id = $1 GROUP BY p.project_id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Projet introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = projectSchema.parse(req.body);
    if (data.end_date && new Date(data.end_date) <= new Date(data.start_date))
      return res.status(400).json({ success: false, message: 'end_date doit être après start_date.' });

    const r = await pool.query(
      `INSERT INTO ops_schema.projects
         (name, description, manager_id, budget, currency, start_date, end_date, priority, tags, created_by, status, progress)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planning',0) RETURNING *`,
      [data.name, data.description, data.manager_id || req.user.id, data.budget, data.currency,
       data.start_date, data.end_date, data.priority, JSON.stringify(data.tags || []), req.user.id]
    );
    res.status(201).json({ success: true, message: 'Projet créé.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = projectUpdateSchema.parse(req.body);
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE ops_schema.projects SET ${fields.join(', ')}, updated_at = NOW()
       WHERE project_id = $${values.length} RETURNING *`, values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Projet introuvable.' });
    res.json({ success: true, message: 'Projet mis à jour.', data: r.rows[0] });
  })
);

// Ajouter un membre
app.post('/:id/members', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = memberSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO ops_schema.project_members (project_id, user_id, role)
       VALUES ($1,$2,$3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
      [req.params.id, data.user_id, data.role]
    );
    res.status(201).json({ success: true, message: 'Membre ajouté.', data: r.rows[0] });
  })
);

// Retirer un membre
app.delete('/:id/members/:userId', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `DELETE FROM ops_schema.project_members WHERE project_id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.params.userId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Membre introuvable.' });
    res.json({ success: true, message: 'Membre retiré.' });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE ops_schema.projects SET status = 'cancelled', updated_at = NOW()
       WHERE project_id = $1 AND status NOT IN ('completed','cancelled') RETURNING project_id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Projet introuvable ou déjà finalisé.' });
    res.json({ success: true, message: 'Projet annulé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ ops-projects sur le port ${PORT}`));
