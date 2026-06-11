'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3303;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const paymentSchema = z.object({
  invoice_id:     z.string().uuid().optional(),
  payee_name:     z.string().min(2).max(200),
  payee_iban:     z.string().optional(),
  amount:         z.number().positive(),
  currency:       z.string().length(3).default('MAD'),
  payment_method: z.enum(['bank_transfer', 'check', 'cash', 'card', 'mobile']),
  payment_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference:      z.string().max(200).optional(),
  notes:          z.string().max(500).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'finance-payments', status: 'healthy', port: PORT }));

app.get('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { payment_method, status } = req.query;
    const params = []; const conds = [];

    if (payment_method) { params.push(payment_method); conds.push(`payment_method = $${params.length}`); }
    if (status)         { params.push(status);         conds.push(`status = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM finance_schema.payments ${where} ORDER BY payment_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM finance_schema.payments ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

// Résumé par méthode de paiement
app.get('/summary', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT payment_method, COUNT(*) as count, SUM(amount) as total_amount, currency
       FROM finance_schema.payments WHERE status = 'completed'
       GROUP BY payment_method, currency ORDER BY total_amount DESC`
    );
    res.json({ success: true, data: r.rows });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM finance_schema.payments WHERE payment_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Paiement introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = paymentSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO finance_schema.payments
         (invoice_id, payee_name, payee_iban, amount, currency, payment_method, payment_date, reference, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING *`,
      [data.invoice_id, data.payee_name, data.payee_iban, data.amount, data.currency,
       data.payment_method, data.payment_date, data.reference, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Paiement enregistré.', data: r.rows[0] });
  })
);

app.patch('/:id/confirm', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.payments SET status = 'completed', confirmed_by = $1, confirmed_at = NOW(), updated_at = NOW()
       WHERE payment_id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Paiement introuvable ou déjà traité.' });
    res.json({ success: true, message: 'Paiement confirmé.', data: r.rows[0] });
  })
);

app.patch('/:id/cancel', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.payments SET status = 'cancelled', updated_at = NOW()
       WHERE payment_id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Paiement introuvable ou non annulable.' });
    res.json({ success: true, message: 'Paiement annulé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ finance-payments sur le port ${PORT}`));
