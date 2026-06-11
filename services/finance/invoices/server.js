'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3305;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const invoiceSchema = z.object({
  client_name:    z.string().min(2).max(200),
  client_email:   z.string().email().optional(),
  description:    z.string().max(1000).optional(),
  amount:         z.number().positive(),
  tax_rate:       z.number().min(0).max(100).default(20),
  currency:       z.string().length(3).default('MAD'),
  due_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  line_items:     z.array(z.object({
    description: z.string().min(1),
    quantity:    z.number().positive(),
    unit_price:  z.number().positive(),
  })).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'finance-invoices', status: 'healthy', port: PORT }));

app.get('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, client_name } = req.query;
    const params = []; const conds = [];

    if (status)      { params.push(status);       conds.push(`status = $${params.length}`); }
    if (client_name) { params.push(`%${client_name}%`); conds.push(`client_name ILIKE $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM finance_schema.invoices ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM finance_schema.invoices ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/overdue', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM finance_schema.invoices WHERE status NOT IN ('paid','cancelled') AND due_date < NOW() ORDER BY due_date ASC`
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM finance_schema.invoices WHERE invoice_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Facture introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = invoiceSchema.parse(req.body);
    const invoiceNumber = `INV-${Date.now()}`;
    const taxAmount = (data.amount * data.tax_rate) / 100;
    const totalAmount = data.amount + taxAmount;

    const r = await pool.query(
      `INSERT INTO finance_schema.invoices
         (invoice_number, client_name, client_email, description, amount, tax_rate, tax_amount, total_amount, currency, due_date, line_items, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft') RETURNING *`,
      [invoiceNumber, data.client_name, data.client_email, data.description, data.amount,
       data.tax_rate, taxAmount, totalAmount, data.currency, data.due_date,
       JSON.stringify(data.line_items || []), req.user.id]
    );
    res.status(201).json({ success: true, message: 'Facture créée.', data: r.rows[0] });
  })
);

// Workflow : draft → sent → paid / cancelled
app.patch('/:id/send', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE invoice_id = $1 AND status = 'draft' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Facture introuvable ou déjà envoyée.' });
    res.json({ success: true, message: 'Facture envoyée.', data: r.rows[0] });
  })
);

app.patch('/:id/mark-paid', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
       WHERE invoice_id = $1 AND status = 'sent' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Facture introuvable ou non envoyée.' });
    res.json({ success: true, message: 'Facture marquée comme payée.', data: r.rows[0] });
  })
);

app.patch('/:id/cancel', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.invoices SET status = 'cancelled', updated_at = NOW()
       WHERE invoice_id = $1 AND status NOT IN ('paid','cancelled') RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Facture introuvable ou déjà finalisée.' });
    res.json({ success: true, message: 'Facture annulée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ finance-invoices sur le port ${PORT}`));
