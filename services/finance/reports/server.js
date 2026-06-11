'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3302;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const reportSchema = z.object({
  title:       z.string().min(2).max(200),
  type:        z.enum(['budget', 'expenses', 'revenue', 'cashflow', 'custom']),
  period_start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(1000).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'finance-reports', status: 'healthy', port: PORT }));

// ─── Rapports dynamiques ───────────────────────────────────────────────────

// Récapitulatif financier global
app.get('/dashboard', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const [budgets, expenses, payments, invoices] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM finance_schema.budgets WHERE status='active'`),
      pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM finance_schema.expenses WHERE status='approved'`),
      pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM finance_schema.payments WHERE status='completed'`),
      pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM finance_schema.invoices WHERE status='paid'`),
    ]);
    res.json({
      success: true,
      data: {
        active_budgets:    { count: parseInt(budgets.rows[0].count),   total: parseFloat(budgets.rows[0].total) },
        approved_expenses: { count: parseInt(expenses.rows[0].count),  total: parseFloat(expenses.rows[0].total) },
        completed_payments:{ count: parseInt(payments.rows[0].count),  total: parseFloat(payments.rows[0].total) },
        paid_invoices:     { count: parseInt(invoices.rows[0].count),  total: parseFloat(invoices.rows[0].total) },
      },
    });
  })
);

// Dépenses par catégorie sur une période
app.get('/expenses-by-category', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const params = []; const conds = [];
    if (from) { params.push(from); conds.push(`expense_date >= $${params.length}`); }
    if (to)   { params.push(to);   conds.push(`expense_date <= $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')} AND status='approved'` : `WHERE status='approved'`;
    const r = await pool.query(
      `SELECT category, COUNT(*) as count, SUM(amount) as total FROM finance_schema.expenses ${where} GROUP BY category ORDER BY total DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  })
);

// GET / — liste des rapports sauvegardés
app.get('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { type } = req.query;
    const params = []; const conds = [];
    if (type) { params.push(type); conds.push(`type = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);
    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM finance_schema.financial_reports ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM finance_schema.financial_reports ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM finance_schema.financial_reports WHERE report_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rapport introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = reportSchema.parse(req.body);
    if (new Date(data.period_end) < new Date(data.period_start))
      return res.status(400).json({ success: false, message: 'period_end doit être après period_start.' });
    const r = await pool.query(
      `INSERT INTO finance_schema.financial_reports (title, type, period_start, period_end, description, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING *`,
      [data.title, data.type, data.period_start, data.period_end, data.description, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Rapport créé.', data: r.rows[0] });
  })
);

app.patch('/:id/publish', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.financial_reports SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE report_id = $1 AND status = 'draft' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rapport introuvable ou déjà publié.' });
    res.json({ success: true, message: 'Rapport publié.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `DELETE FROM finance_schema.financial_reports WHERE report_id = $1 AND status = 'draft' RETURNING report_id, title`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rapport introuvable ou non supprimable.' });
    res.json({ success: true, message: 'Rapport supprimé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ finance-reports sur le port ${PORT}`));
