'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3403;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const supplierSchema = z.object({
  name:          z.string().min(2).max(200),
  contact_name:  z.string().max(100).optional(),
  email:         z.string().email().optional(),
  phone:         z.string().max(20).optional(),
  address:       z.string().max(500).optional(),
  country:       z.string().max(100).optional(),
  category:      z.string().min(2).max(100),
  payment_terms: z.enum(['net_15','net_30','net_60','net_90','immediate']).default('net_30'),
  currency:      z.string().length(3).default('MAD'),
  tax_id:        z.string().max(100).optional(),
  website:       z.string().url().optional(),
  notes:         z.string().max(1000).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'ops-suppliers', status: 'healthy', port: PORT }));

app.get('/', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { category, status, country, search } = req.query;
    const params = []; const conds = [];

    if (category) { params.push(category); conds.push(`category = $${params.length}`); }
    if (status)   { params.push(status);   conds.push(`status = $${params.length}`); }
    if (country)  { params.push(country);  conds.push(`country = $${params.length}`); }
    if (search)   { params.push(`%${search}%`); conds.push(`(name ILIKE $${params.length} OR contact_name ILIKE $${params.length})`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM ops_schema.suppliers ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM ops_schema.suppliers ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM ops_schema.suppliers WHERE supplier_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Fournisseur introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);

    const exists = await pool.query(
      `SELECT supplier_id FROM ops_schema.suppliers WHERE name ILIKE $1 AND status = 'active'`,
      [data.name]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Un fournisseur actif avec ce nom existe déjà.' });

    const r = await pool.query(
      `INSERT INTO ops_schema.suppliers
         (name, contact_name, email, phone, address, country, category, payment_terms, currency, tax_id, website, notes, created_by, status, rating)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',0) RETURNING *`,
      [data.name, data.contact_name, data.email, data.phone, data.address, data.country,
       data.category, data.payment_terms, data.currency, data.tax_id, data.website, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Fournisseur créé.', data: r.rows[0] });
  })
);

// Évaluer un fournisseur (rating 1-5)
app.patch('/:id/rate', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const { rating, comment } = z.object({
      rating:  z.number().int().min(1).max(5),
      comment: z.string().max(500).optional(),
    }).parse(req.body);

    const r = await pool.query(
      `UPDATE ops_schema.suppliers SET rating = $1, last_rating_comment = $2, last_rated_at = NOW(), updated_at = NOW()
       WHERE supplier_id = $3 RETURNING *`,
      [rating, comment, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Fournisseur introuvable.' });
    res.json({ success: true, message: 'Évaluation enregistrée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const allowed = ['contact_name','email','phone','address','country','payment_terms','notes','status'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE ops_schema.suppliers SET ${fields.join(', ')}, updated_at = NOW()
       WHERE supplier_id = $${values.length} RETURNING *`, values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Fournisseur introuvable.' });
    res.json({ success: true, message: 'Fournisseur mis à jour.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE ops_schema.suppliers SET status = 'inactive', updated_at = NOW()
       WHERE supplier_id = $1 AND status = 'active' RETURNING supplier_id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Fournisseur introuvable ou déjà inactif.' });
    res.json({ success: true, message: 'Fournisseur désactivé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ ops-suppliers sur le port ${PORT}`));
