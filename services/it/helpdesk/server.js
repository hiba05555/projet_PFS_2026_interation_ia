'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3101;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ─── RBAC : filtre SQL par rôle ───────────────────────────────────────────────
// Mute conds[] et params[] pour restreindre la visibilité des lignes.
// Appeler AVANT d'ajouter limit/offset dans params.
//   managerFilter  → appliqué si role='manager'
//   employeeFilter → appliqué si role='employee'
// Chaque filter = { sql: '...{N}...', val? }  ({N} est remplacé par $idx)
function rbacScope(user, conds, params, { managerFilter = null, employeeFilter = null } = {}) {
  if (user.role === 'admin') return;                          // admin : accès total
  const filter = user.role === 'manager' ? managerFilter : employeeFilter;
  if (!filter) return;
  const idx = params.length + 1;
  conds.push(filter.sql.replace(/\{N\}/g, `$${idx}`));
  params.push(filter.val !== undefined ? filter.val : user.id);
}

const ticketSchema = z.object({
  title:       z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  priority:    z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  category:    z.enum(['hardware', 'software', 'network', 'access', 'email', 'general']).default('general'),
});

const assignSchema = z.object({
  assigned_to: z.string().uuid(),
});

const resolveSchema = z.object({
  resolution_notes: z.string().min(10).max(2000),
});

app.get('/health', (_req, res) =>
  res.json({ service: 'it-helpdesk', status: 'healthy', port: PORT })
);

// GET / — IT staff voit tous les tickets avec filtres
app.get('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority, category, assigned_to } = req.query;
    const params = []; const conds = [];

    if (status)      { params.push(status);      conds.push(`status = $${params.length}`); }
    if (priority)    { params.push(priority);    conds.push(`priority = $${params.length}`); }
    if (category)    { params.push(category);    conds.push(`category = $${params.length}`); }
    if (assigned_to) { params.push(assigned_to); conds.push(`assigned_to = $${params.length}`); }

    // RBAC : manager IT → tous les tickets IT | employee → uniquement les siens
    rbacScope(req.user, conds, params, {
      employeeFilter: { sql: '(created_by = {N} OR assigned_to = {N})' },
    });

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT * FROM it_schema.helpdesk_tickets ${where}
         ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                  created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM it_schema.helpdesk_tickets ${where}`, params.slice(0, -2)),
    ]);
    res.json({
      success: true,
      data: data.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
    });
  })
);

// GET /stats — tableau de bord IT
app.get('/stats', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    // RBAC : employee → stats de ses tickets uniquement
    const statsConds = []; const statsParams = [];
    rbacScope(req.user, statsConds, statsParams, {
      employeeFilter: { sql: '(created_by = {N} OR assigned_to = {N})' },
    });
    const statsWhere = statsConds.length ? `WHERE ${statsConds.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open') as open,
         COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
         COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
         COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('resolved','closed')) as critical_open,
         ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE resolved_at IS NOT NULL), 1) as avg_resolution_hours
       FROM it_schema.helpdesk_tickets ${statsWhere}`,
      statsParams
    );
    res.json({ success: true, data: r.rows[0] });
  })
);

// GET /my-tickets — tickets créés par l'utilisateur connecté
app.get('/my-tickets', verifyToken,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [req.user.id]; const conds = [`created_by = $1`];
    if (status) { params.push(status); conds.push(`status = $${params.length}`); }

    const r = await pool.query(
      `SELECT * FROM it_schema.helpdesk_tickets WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

// GET /:id — tout employé peut voir ses propres tickets, IT voit tout
app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      'SELECT * FROM it_schema.helpdesk_tickets WHERE ticket_id = $1',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Ticket introuvable.' });

    const ticket = r.rows[0];
    const isIT = req.user.role === 'admin' || req.user.department === 'IT';
    if (!isIT && ticket.created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    res.json({ success: true, data: ticket });
  })
);

// POST / — tous les employés peuvent créer un ticket
app.post('/', verifyToken,
  asyncHandler(async (req, res) => {
    const data = ticketSchema.parse(req.body);
    const ticketNumber = `HELP-${Date.now()}`;

    const r = await pool.query(
      `INSERT INTO it_schema.helpdesk_tickets
         (ticket_number, title, description, priority, category, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'open',$6) RETURNING *`,
      [ticketNumber, data.title, data.description, data.priority, data.category, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Ticket créé.', data: r.rows[0] });
  })
);

// POST /:id/assign — IT staff assigne un ticket
app.post('/:id/assign', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { assigned_to } = assignSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE it_schema.helpdesk_tickets
       SET assigned_to = $1, status = 'in_progress', updated_at = NOW()
       WHERE ticket_id = $2 AND status IN ('open','in_progress') RETURNING *`,
      [assigned_to, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Ticket introuvable ou déjà résolu.' });
    res.json({ success: true, message: 'Ticket assigné.', data: r.rows[0] });
  })
);

// POST /:id/resolve — IT staff résout un ticket
app.post('/:id/resolve', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { resolution_notes } = resolveSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE it_schema.helpdesk_tickets
       SET status = 'resolved', resolution_notes = $1, resolved_at = NOW(), updated_at = NOW()
       WHERE ticket_id = $2 AND status NOT IN ('resolved','closed') RETURNING *`,
      [resolution_notes, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Ticket introuvable ou déjà résolu.' });
    res.json({ success: true, message: 'Ticket résolu.', data: r.rows[0] });
  })
);

// POST /:id/close — fermé par le demandeur ou IT
app.post('/:id/close', verifyToken,
  asyncHandler(async (req, res) => {
    const ticket = await pool.query('SELECT * FROM it_schema.helpdesk_tickets WHERE ticket_id = $1', [req.params.id]);
    if (!ticket.rows.length) return res.status(404).json({ success: false, message: 'Ticket introuvable.' });

    const t = ticket.rows[0];
    const isIT = req.user.role === 'admin' || req.user.department === 'IT';
    if (!isIT && t.created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    const r = await pool.query(
      `UPDATE it_schema.helpdesk_tickets SET status = 'closed', updated_at = NOW()
       WHERE ticket_id = $1 AND status = 'resolved' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, message: 'Seuls les tickets résolus peuvent être fermés.' });
    res.json({ success: true, message: 'Ticket fermé.', data: r.rows[0] });
  })
);

// PATCH /:id — mise à jour de priorité/catégorie (IT uniquement)
app.patch('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const allowed = ['priority', 'category', 'title'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE it_schema.helpdesk_tickets SET ${fields.join(', ')}, updated_at = NOW()
       WHERE ticket_id = $${values.length} AND status NOT IN ('resolved','closed') RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Ticket introuvable ou déjà fermé.' });
    res.json({ success: true, message: 'Ticket mis à jour.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ it-helpdesk sur le port ${PORT}`));
