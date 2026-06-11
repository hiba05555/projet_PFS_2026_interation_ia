'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3105;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const licenseSchema = z.object({
  software_name:   z.string().min(2).max(200),
  vendor:          z.string().min(2).max(200),
  license_type:    z.enum(['perpetual', 'subscription', 'oem', 'open_source', 'trial']),
  license_key:     z.string().max(500).optional(),
  seats:           z.number().int().positive(),
  purchase_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiry_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchase_price:  z.number().positive().optional(),
  renewal_cost:    z.number().positive().optional(),
  contact_email:   z.string().email().optional(),
  notes:           z.string().max(500).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'it-licenses', status: 'healthy', port: PORT }));

// Licences expirant dans les 60 jours
app.get('/expiring-soon', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 60;
    const r = await pool.query(
      `SELECT *, EXTRACT(DAY FROM (expiry_date - NOW())) as days_remaining
       FROM it_schema.software_licenses
       WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '${days} days'
         AND status = 'active'
       ORDER BY expiry_date ASC`
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

// Licences déjà expirées
app.get('/expired', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM it_schema.software_licenses WHERE expiry_date < NOW() AND status = 'active' ORDER BY expiry_date DESC`
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  })
);

app.get('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { license_type, status } = req.query;
    const params = []; const conds = [];

    if (license_type) { params.push(license_type); conds.push(`license_type = $${params.length}`); }
    if (status)       { params.push(status);        conds.push(`status = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT license_id, software_name, vendor, license_type, seats, seats_used, purchase_date, expiry_date, status, created_at
         FROM it_schema.software_licenses ${where} ORDER BY expiry_date ASC NULLS LAST
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM it_schema.software_licenses ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM it_schema.software_licenses WHERE license_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Licence introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const data = licenseSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO it_schema.software_licenses
         (software_name, vendor, license_type, license_key, seats, seats_used, purchase_date, expiry_date,
          purchase_price, renewal_cost, contact_email, notes, added_by, status)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,'active') RETURNING *`,
      [data.software_name, data.vendor, data.license_type, data.license_key, data.seats,
       data.purchase_date, data.expiry_date, data.purchase_price, data.renewal_cost,
       data.contact_email, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Licence ajoutée.', data: r.rows[0] });
  })
);

// Renouveler une licence
app.patch('/:id/renew', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { new_expiry_date, renewal_cost } = z.object({
      new_expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      renewal_cost:    z.number().positive().optional(),
    }).parse(req.body);

    const r = await pool.query(
      `UPDATE it_schema.software_licenses SET expiry_date = $1, renewal_cost = COALESCE($2, renewal_cost),
       status = 'active', updated_at = NOW() WHERE license_id = $3 RETURNING *`,
      [new_expiry_date, renewal_cost, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Licence introuvable.' });
    res.json({ success: true, message: 'Licence renouvelée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const allowed = ['software_name','vendor','seats','contact_email','notes','status'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE it_schema.software_licenses SET ${fields.join(', ')}, updated_at = NOW()
       WHERE license_id = $${values.length} RETURNING *`, values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Licence introuvable.' });
    res.json({ success: true, message: 'Licence mise à jour.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE it_schema.software_licenses SET status = 'retired', updated_at = NOW()
       WHERE license_id = $1 AND status != 'retired' RETURNING license_id, software_name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Licence introuvable ou déjà retirée.' });
    res.json({ success: true, message: 'Licence retirée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ it-licenses sur le port ${PORT}`));
