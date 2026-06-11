'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3204;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const payrollSchema = z.object({
  employee_id:     z.string().uuid(),
  amount:          z.number().positive('Le montant doit être positif'),
  currency:        z.string().length(3).default('MAD'),
  payment_method:  z.enum(['bank_transfer', 'check', 'cash']),
  pay_period_start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pay_period_end:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bonuses:         z.number().min(0).default(0),
  deductions:      z.number().min(0).default(0),
  notes:           z.string().max(500).optional(),
});

app.get('/health', (_req, res) =>
  res.json({ service: 'hr-payroll', status: 'healthy', port: PORT })
);

// GET / — liste des fiches de paie (HR manager ou admin)
app.get('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { employee_id, status, currency } = req.query;
    const params = []; const conds = [];

    if (employee_id) { params.push(employee_id); conds.push(`pr.employee_id = $${params.length}`); }
    if (status)      { params.push(status);      conds.push(`pr.status = $${params.length}`); }
    if (currency)    { params.push(currency);    conds.push(`pr.currency = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT pr.*, e.first_name, e.last_name, e.department, e.position
         FROM hr_schema.payroll_records pr
         JOIN hr_schema.employees e ON pr.employee_id = e.employee_id
         ${where} ORDER BY pr.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM hr_schema.payroll_records pr ${where}`,
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

// GET /my-payslips — fiches de paie de l'employé connecté
app.get('/my-payslips', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const [data, total] = await Promise.all([
      pool.query(
        `SELECT payroll_id, pay_period_start, pay_period_end, amount, currency, bonuses, deductions,
                (amount + bonuses - deductions) AS net_amount, payment_method, status, paid_at
         FROM hr_schema.payroll_records
         WHERE employee_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM hr_schema.payroll_records WHERE employee_id = $1', [req.user.id]),
    ]);
    res.json({
      success: true,
      data: data.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
    });
  })
);

// GET /summary — résumé des coûts salariaux par département
app.get('/summary', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.query;
    const params = []; const conds = [];
    if (year)  { params.push(year);  conds.push(`EXTRACT(YEAR FROM pay_period_start) = $${params.length}`); }
    if (month) { params.push(month); conds.push(`EXTRACT(MONTH FROM pay_period_start) = $${params.length}`); }

    const where = conds.length ? `WHERE pr.status = 'paid' AND ${conds.join(' AND ')}` : `WHERE pr.status = 'paid'`;

    const r = await pool.query(
      `SELECT e.department,
              COUNT(*) as payslips_count,
              SUM(pr.amount + pr.bonuses - pr.deductions) as total_net,
              SUM(pr.bonuses) as total_bonuses,
              SUM(pr.deductions) as total_deductions,
              pr.currency
       FROM hr_schema.payroll_records pr
       JOIN hr_schema.employees e ON pr.employee_id = e.employee_id
       ${where} GROUP BY e.department, pr.currency ORDER BY total_net DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  })
);

// GET /:id
app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.department, e.position
       FROM hr_schema.payroll_records pr
       JOIN hr_schema.employees e ON pr.employee_id = e.employee_id
       WHERE pr.payroll_id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Fiche de paie introuvable.' });

    const record = r.rows[0];
    // Un employé ne peut voir que ses propres fiches
    const isHrOrAdmin = req.user.role === 'admin' || req.user.department === 'HR';
    if (!isHrOrAdmin && record.employee_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Accès refusé.' });

    res.json({ success: true, data: record });
  })
);

// POST / — créer une fiche de paie (HR ou admin)
app.post('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = payrollSchema.parse(req.body);

    if (new Date(data.pay_period_end) < new Date(data.pay_period_start))
      return res.status(400).json({ success: false, message: 'pay_period_end doit être après pay_period_start.' });

    // Vérifier qu'une fiche n'existe pas déjà pour cette période/employé
    const exists = await pool.query(
      `SELECT payroll_id FROM hr_schema.payroll_records
       WHERE employee_id = $1 AND pay_period_start = $2 AND pay_period_end = $3 AND status != 'cancelled'`,
      [data.employee_id, data.pay_period_start, data.pay_period_end]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Une fiche de paie existe déjà pour cette période.' });

    const r = await pool.query(
      `INSERT INTO hr_schema.payroll_records
         (employee_id, amount, currency, payment_method, pay_period_start, pay_period_end, bonuses, deductions, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *`,
      [data.employee_id, data.amount, data.currency, data.payment_method,
       data.pay_period_start, data.pay_period_end, data.bonuses, data.deductions, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Fiche de paie créée.', data: r.rows[0] });
  })
);

// PATCH /:id/approve — valider et marquer comme payée
app.patch('/:id/approve', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.payroll_records
       SET status = 'paid', paid_at = NOW(), approved_by = $1, updated_at = NOW()
       WHERE payroll_id = $2 AND status = 'draft' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Fiche introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Paie approuvée et marquée comme payée.', data: r.rows[0] });
  })
);

// PATCH /:id/cancel
app.patch('/:id/cancel', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.payroll_records SET status = 'cancelled', updated_at = NOW()
       WHERE payroll_id = $1 AND status = 'draft' RETURNING payroll_id, employee_id, status`,
      [req.params.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Fiche introuvable ou non annulable.' });
    res.json({ success: true, message: 'Fiche de paie annulée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ hr-payroll sur le port ${PORT}`));
