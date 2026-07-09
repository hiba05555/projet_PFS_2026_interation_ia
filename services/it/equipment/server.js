'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3103;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ─── Métriques Prometheus (endpoint non protégé — scrape sans authentification) ──
const { metricsHandler } = require('./shared/middleware/metrics');
app.get('/metrics', metricsHandler);

// ─── RBAC : filtre SQL par rôle ───────────────────────────────────────────────
function rbacScope(user, conds, params, { managerFilter = null, employeeFilter = null } = {}) {
  if (user.role === 'admin') return;
  const filter = user.role === 'manager' ? managerFilter : employeeFilter;
  if (!filter) return;
  const idx = params.length + 1;
  conds.push(filter.sql.replace(/\{N\}/g, `$${idx}`));
  params.push(filter.val !== undefined ? filter.val : user.id);
}

const equipmentSchema = z.object({
  name:            z.string().min(2).max(200),
  type:            z.enum(['laptop', 'desktop', 'monitor', 'phone', 'tablet', 'printer', 'server', 'network', 'other']),
  brand:           z.string().max(100).optional(),
  model:           z.string().max(100).optional(),
  serial_number:   z.string().max(100).optional(),
  purchase_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchase_price:  z.number().positive().optional(),
  warranty_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assigned_to:     z.string().uuid().optional(),
  location:        z.string().max(200).optional(),
  notes:           z.string().max(500).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'it-equipment', status: 'healthy', port: PORT }));

// Équipements dont la garantie expire dans les 30 jours
app.get('/warranty-expiring', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM it_schema.equipment
       WHERE warranty_end BETWEEN NOW() AND NOW() + INTERVAL '30 days'
       AND status != 'retired' ORDER BY warranty_end ASC`
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

app.get('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { type, status, assigned_to } = req.query;
    const params = []; const conds = [];

    if (type)        { params.push(type);        conds.push(`type = $${params.length}`); }
    if (status)      { params.push(status);      conds.push(`status = $${params.length}`); }
    if (assigned_to) { params.push(assigned_to); conds.push(`assigned_to = $${params.length}`); }

    // RBAC : manager IT → tout l'équipement | employee → uniquement le sien
    rbacScope(req.user, conds, params, {
      employeeFilter: { sql: 'assigned_to = {N}' },
    });

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM it_schema.equipment ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM it_schema.equipment ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM it_schema.equipment WHERE equipment_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Équipement introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const data = equipmentSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO it_schema.equipment
         (name, type, brand, model, serial_number, purchase_date, purchase_price, warranty_end, assigned_to, location, notes, added_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'available') RETURNING *`,
      [data.name, data.type, data.brand, data.model, data.serial_number, data.purchase_date,
       data.purchase_price, data.warranty_end, data.assigned_to, data.location, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Équipement ajouté.', data: r.rows[0] });
  })
);

// Assigner à un employé
app.patch('/:id/assign', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { employee_id } = z.object({ employee_id: z.string().uuid() }).parse(req.body);
    const r = await pool.query(
      `UPDATE it_schema.equipment SET assigned_to = $1, status = 'in_use', updated_at = NOW()
       WHERE equipment_id = $2 AND status IN ('available','in_use') RETURNING *`,
      [employee_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Équipement introuvable ou non disponible.' });
    res.json({ success: true, message: 'Équipement assigné.', data: r.rows[0] });
  })
);

// Retirer l'affectation
app.patch('/:id/unassign', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE it_schema.equipment SET assigned_to = NULL, status = 'available', updated_at = NOW()
       WHERE equipment_id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Équipement introuvable.' });
    res.json({ success: true, message: 'Affectation retirée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const allowed = ['name','brand','model','location','notes','status','warranty_end'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE it_schema.equipment SET ${fields.join(', ')}, updated_at = NOW()
       WHERE equipment_id = $${values.length} RETURNING *`, values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Équipement introuvable.' });
    res.json({ success: true, message: 'Équipement mis à jour.', data: r.rows[0] });
  })
);

// Soft delete = retired
app.delete('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE it_schema.equipment SET status = 'retired', updated_at = NOW()
       WHERE equipment_id = $1 AND status != 'retired' RETURNING equipment_id, name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Équipement introuvable ou déjà retiré.' });
    res.json({ success: true, message: 'Équipement retiré.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ it-equipment sur le port ${PORT}`));
