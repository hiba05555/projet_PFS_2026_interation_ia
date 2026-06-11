'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3202;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const leaveSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type:  z.enum(['annual','sick','maternity','paternity','unpaid','other']),
  start_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  end_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  reason:      z.string().max(500).optional(),
});

app.get('/health', (_req, res) =>
  res.json({ service: 'hr-leave-requests', status: 'healthy', port: PORT })
);

// GET / — toutes les demandes (HR/admin uniquement)
app.get('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, leave_type, employee_id } = req.query;
    const params = []; const conds = [];

    if (status)      { params.push(status);      conds.push(`lr.status = $${params.length}`); }
    if (leave_type)  { params.push(leave_type);  conds.push(`lr.leave_type = $${params.length}`); }
    if (employee_id) { params.push(employee_id); conds.push(`lr.employee_id = $${params.length}`); }

    // ── RBAC data scoping ────────────────────────────────────────────────────
    // admin / manager RH → accès total (traitement de tous les congés)
    // employee RH        → uniquement ses propres demandes (via email → employee_id)
    if (req.user.role === 'employee') {
      params.push(req.user.email);
      conds.push(
        `lr.employee_id IN (SELECT employee_id FROM hr_schema.employees WHERE email = $${params.length})`
      );
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT lr.*, e.first_name, e.last_name, e.department
         FROM hr_schema.leave_requests lr
         JOIN hr_schema.employees e ON lr.employee_id = e.employee_id
         ${where} ORDER BY lr.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM hr_schema.leave_requests lr ${where}`,
        params.slice(0, -2)
      ),
    ]);

    res.json({
      success: true,
      data: data.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
    });
  })
);

// GET /my-requests — demandes de l'employé connecté
app.get('/my-requests', verifyToken,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [req.user.id]; const conds = [`employee_id = $1`];
    if (status) { params.push(status); conds.push(`status = $${params.length}`); }

    const r = await pool.query(
      `SELECT * FROM hr_schema.leave_requests WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

// GET /:id
app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT lr.*, e.first_name, e.last_name, e.department
       FROM hr_schema.leave_requests lr
       JOIN hr_schema.employees e ON lr.employee_id = e.employee_id
       WHERE lr.leave_id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    const leave = r.rows[0];
    // Un employé ne peut voir que ses propres demandes
    const isHrOrAdmin = req.user.role === 'admin' || req.user.department === 'HR';
    if (!isHrOrAdmin && leave.employee_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    res.json({ success: true, data: leave });
  })
);

// POST / — soumettre une demande de congé
app.post('/', verifyToken,
  asyncHandler(async (req, res) => {
    const data = leaveSchema.parse(req.body);

    if (new Date(data.end_date) < new Date(data.start_date))
      return res.status(400).json({ success: false, message: 'end_date doit être après start_date.' });

    // Calcul du nombre de jours (jours calendaires)
    const totalDays = Math.ceil(
      (new Date(data.end_date) - new Date(data.start_date)) / (1000 * 60 * 60 * 24)
    ) + 1;

    // Vérifier qu'il n'y a pas de chevauchement avec une demande existante
    const overlap = await pool.query(
      `SELECT leave_id FROM hr_schema.leave_requests
       WHERE employee_id = $1 AND status NOT IN ('rejected','cancelled')
         AND (start_date, end_date) OVERLAPS ($2::date, $3::date)`,
      [data.employee_id, data.start_date, data.end_date]
    );
    if (overlap.rows.length)
      return res.status(409).json({ success: false, message: 'Une demande de congé existe déjà sur cette période.' });

    const r = await pool.query(
      `INSERT INTO hr_schema.leave_requests
         (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [data.employee_id, data.leave_type, data.start_date, data.end_date, totalDays, data.reason]
    );
    res.status(201).json({ success: true, message: 'Demande de congé soumise.', data: r.rows[0] });
  })
);

// PATCH /:id/approve
app.patch('/:id/approve', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.leave_requests
       SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE leave_id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Demande introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Congé approuvé.', data: r.rows[0] });
  })
);

// PATCH /:id/reject
app.patch('/:id/reject', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE hr_schema.leave_requests
       SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE leave_id = $2 AND status = 'pending' RETURNING *`,
      [reason, req.params.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Demande introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Congé rejeté.', data: r.rows[0] });
  })
);

// PATCH /:id/cancel — annulation par l'employé lui-même
app.patch('/:id/cancel', verifyToken,
  asyncHandler(async (req, res) => {
    const leave = await pool.query(
      'SELECT * FROM hr_schema.leave_requests WHERE leave_id = $1', [req.params.id]
    );
    if (!leave.rows.length) return res.status(404).json({ success: false, message: 'Demande introuvable.' });

    const isHrOrAdmin = req.user.role === 'admin' || req.user.department === 'HR';
    if (!isHrOrAdmin && leave.rows[0].employee_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    const r = await pool.query(
      `UPDATE hr_schema.leave_requests SET status = 'cancelled', updated_at = NOW()
       WHERE leave_id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length)
      return res.status(400).json({ success: false, message: 'Seules les demandes en attente peuvent être annulées.' });
    res.json({ success: true, message: 'Demande annulée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ hr-leave-requests sur le port ${PORT}`));
