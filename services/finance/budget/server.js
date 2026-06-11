'use strict';
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const { z }    = require('zod');
const pool     = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3301;

app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ─── RBAC : filtre SQL par rôle ───────────────────────────────────────────────
function rbacScope(user, conds, params, { managerFilter = null, employeeFilter = null } = {}) {
  if (user.role === 'admin') return;
  const filter = user.role === 'manager' ? managerFilter : employeeFilter;
  if (!filter) return;
  const idx = params.length + 1;
  conds.push(filter.sql.replace(/\{N\}/g, `$${idx}`));
  params.push(filter.val !== undefined ? filter.val : user.id);
}

// ─── Schémas de validation ─────────────────────────────────────────────────
const budgetSchema = z.object({
  name:        z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  amount:      z.number().positive('Le montant doit être positif'),
  currency:    z.string().length(3).default('MAD'),
  category:    z.string().min(2).max(100),
  fiscal_year: z.number().int().min(2000).max(2100),
  start_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  end_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
});

const budgetUpdateSchema = budgetSchema.partial();

// ─── Routes ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ service: 'finance-budget', status: 'healthy', port: PORT })
);

// GET / — liste paginée avec filtres
app.get('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { category, fiscal_year, currency } = req.query;
    const params = [];
    const conditions = [];

    if (category)    { params.push(category);    conditions.push(`category = $${params.length}`); }
    if (fiscal_year) { params.push(parseInt(fiscal_year)); conditions.push(`fiscal_year = $${params.length}`); }
    if (currency)    { params.push(currency);    conditions.push(`currency = $${params.length}`); }

    // ── RBAC data scoping ────────────────────────────────────────────────────
    // admin / manager Finance → accès total (tous les budgets)
    // employee Finance        → uniquement les budgets qu'il a créés
    rbacScope(req.user, conditions, params, {
      employeeFilter: { sql: 'created_by = {N}' },
    });

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const [data, total] = await Promise.all([
      pool.query(
        `SELECT * FROM finance_schema.budgets ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM finance_schema.budgets ${where}`, params.slice(0, -2)),
    ]);

    res.json({
      success: true,
      data: data.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count), pages: Math.ceil(total.rows[0].count / limit) },
    });
  })
);

// GET /:id
app.get('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      'SELECT * FROM finance_schema.budgets WHERE budget_id = $1',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Budget introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

// POST / — création réelle en DB
app.post('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = budgetSchema.parse(req.body);

    if (new Date(data.end_date) <= new Date(data.start_date)) {
      return res.status(400).json({ success: false, message: 'end_date doit être après start_date.' });
    }

    const r = await pool.query(
      `INSERT INTO finance_schema.budgets
         (name, description, amount, currency, category, fiscal_year, start_date, end_date, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING *`,
      [data.name, data.description, data.amount, data.currency, data.category,
       data.fiscal_year, data.start_date, data.end_date, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Budget créé.', data: r.rows[0] });
  })
);

// PATCH /:id — mise à jour partielle
app.patch('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = budgetUpdateSchema.parse(req.body);
    if (Object.keys(data).length === 0)
      return res.status(400).json({ success: false, message: 'Aucun champ à mettre à jour.' });

    const fields  = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values  = Object.values(data);
    values.push(req.params.id);

    const r = await pool.query(
      `UPDATE finance_schema.budgets SET ${fields.join(', ')}, updated_at = NOW()
       WHERE budget_id = $${values.length} RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Budget introuvable.' });
    res.json({ success: true, message: 'Budget mis à jour.', data: r.rows[0] });
  })
);

// DELETE /:id — soft delete (status = archived)
app.delete('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.budgets SET status = 'archived', updated_at = NOW()
       WHERE budget_id = $1 AND status != 'archived' RETURNING budget_id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Budget introuvable ou déjà archivé.' });
    res.json({ success: true, message: 'Budget archivé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ finance-budget sur le port ${PORT}`));
