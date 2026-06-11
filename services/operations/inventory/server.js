'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } = require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3405;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const itemSchema = z.object({
  name:          z.string().min(2).max(200),
  sku:           z.string().max(100).optional(),
  category:      z.string().min(2).max(100),
  description:   z.string().max(1000).optional(),
  quantity:      z.number().int().min(0),
  min_quantity:  z.number().int().min(0).default(0),
  unit_price:    z.number().positive().optional(),
  currency:      z.string().length(3).default('MAD'),
  location:      z.string().max(200).optional(),
  supplier_id:   z.string().uuid().optional(),
  unit:          z.string().max(50).default('pièce'),
});

const movementSchema = z.object({
  quantity:    z.number().int().positive(),
  type:        z.enum(['in', 'out', 'adjustment']),
  reason:      z.string().max(500).optional(),
  reference:   z.string().max(200).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'ops-inventory', status: 'healthy', port: PORT }));

// Articles en rupture ou sous le seuil minimal
app.get('/low-stock', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT *, (min_quantity - quantity) as shortage FROM ops_schema.inventory
       WHERE quantity <= min_quantity AND status = 'active' ORDER BY shortage DESC`
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

app.get('/', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { category, search } = req.query;
    const params = []; const conds = [`status = 'active'`];

    if (category) { params.push(category);        conds.push(`category = $${params.length}`); }
    if (search)   { params.push(`%${search}%`);   conds.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`); }

    const where = `WHERE ${conds.join(' AND ')}`;
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM ops_schema.inventory ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM ops_schema.inventory ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM ops_schema.inventory WHERE item_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Article introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

// Historique des mouvements d'un article
app.get('/:id/movements', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const [data, total] = await Promise.all([
      pool.query(
        `SELECT m.*, u.email as performed_by_email FROM ops_schema.inventory_movements m
         LEFT JOIN auth_schema.users u ON m.performed_by = u.user_id
         WHERE m.item_id = $1 ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM ops_schema.inventory_movements WHERE item_id = $1`, [req.params.id]),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = itemSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO ops_schema.inventory
         (name, sku, category, description, quantity, min_quantity, unit_price, currency, location, supplier_id, unit, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active') RETURNING *`,
      [data.name, data.sku, data.category, data.description, data.quantity, data.min_quantity,
       data.unit_price, data.currency, data.location, data.supplier_id, data.unit, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Article ajouté.', data: r.rows[0] });
  })
);

// Enregistrer un mouvement de stock (entrée / sortie / ajustement)
app.post('/:id/movement', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = movementSchema.parse(req.body);

    const item = await pool.query('SELECT quantity, name FROM ops_schema.inventory WHERE item_id = $1 AND status = $2', [req.params.id, 'active']);
    if (!item.rows.length) return res.status(404).json({ success: false, message: 'Article introuvable.' });

    let newQty;
    if (data.type === 'in')         newQty = item.rows[0].quantity + data.quantity;
    else if (data.type === 'out')   newQty = item.rows[0].quantity - data.quantity;
    else /* adjustment */           newQty = data.quantity;

    if (newQty < 0) return res.status(400).json({ success: false, message: `Stock insuffisant. Disponible : ${item.rows[0].quantity}` });

    await pool.query('BEGIN');
    try {
      await pool.query('UPDATE ops_schema.inventory SET quantity = $1, updated_at = NOW() WHERE item_id = $2', [newQty, req.params.id]);
      const mv = await pool.query(
        `INSERT INTO ops_schema.inventory_movements (item_id, quantity_before, quantity_after, movement_qty, type, reason, reference, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.params.id, item.rows[0].quantity, newQty, data.quantity, data.type, data.reason, data.reference, req.user.id]
      );
      await pool.query('COMMIT');
      res.status(201).json({ success: true, message: 'Mouvement enregistré.', new_quantity: newQty, movement: mv.rows[0] });
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const allowed = ['name','category','description','min_quantity','unit_price','location','unit','supplier_id'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE ops_schema.inventory SET ${fields.join(', ')}, updated_at = NOW()
       WHERE item_id = $${values.length} AND status = 'active' RETURNING *`, values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Article introuvable.' });
    res.json({ success: true, message: 'Article mis à jour.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE ops_schema.inventory SET status = 'archived', updated_at = NOW()
       WHERE item_id = $1 AND status = 'active' RETURNING item_id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Article introuvable ou déjà archivé.' });
    res.json({ success: true, message: 'Article archivé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ ops-inventory sur le port ${PORT}`));
