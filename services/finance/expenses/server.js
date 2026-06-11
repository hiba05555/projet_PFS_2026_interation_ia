'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3304;
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

const expenseSchema = z.object({
  title:       z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  amount:      z.number().positive(),
  currency:    z.string().length(3).default('MAD'),
  category:    z.enum(['travel', 'office', 'software', 'hardware', 'training', 'other']),
  expense_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budget_id:   z.string().uuid().optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'finance-expenses', status: 'healthy', port: PORT }));

app.get('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { category, status } = req.query;
    const params = []; const conds = [];

    if (category) { params.push(category); conds.push(`category = $${params.length}`); }
    if (status)   { params.push(status);   conds.push(`status = $${params.length}`); }

    // ── RBAC data scoping ────────────────────────────────────────────────────
    // admin / manager Finance → accès total (toutes les dépenses)
    // employee Finance        → uniquement les dépenses qu'il a créées
    rbacScope(req.user, conds, params, {
      employeeFilter: { sql: 'created_by = {N}' },
    });

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM finance_schema.expenses ${where} ORDER BY expense_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM finance_schema.expenses ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM finance_schema.expenses WHERE expense_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Dépense introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const data = expenseSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO finance_schema.expenses (title, description, amount, currency, category, expense_date, budget_id, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
      [data.title, data.description, data.amount, data.currency, data.category, data.expense_date, data.budget_id, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Dépense créée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const allowed = ['title','description','amount','category','expense_date','status'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE finance_schema.expenses SET ${fields.join(', ')}, updated_at = NOW() WHERE expense_id = $${values.length} RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Dépense introuvable.' });
    res.json({ success: true, message: 'Dépense mise à jour.', data: r.rows[0] });
  })
);

// Approbation
app.patch('/:id/approve', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.expenses SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE expense_id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Dépense introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Dépense approuvée.', data: r.rows[0] });
  })
);

app.patch('/:id/reject', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE finance_schema.expenses SET status = 'rejected', updated_at = NOW()
       WHERE expense_id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Dépense introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Dépense rejetée.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Finance'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `DELETE FROM finance_schema.expenses WHERE expense_id = $1 AND status = 'pending' RETURNING expense_id, title`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Dépense introuvable ou non supprimable (non-pending).' });
    res.json({ success: true, message: 'Dépense supprimée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ finance-expenses sur le port ${PORT}`));
