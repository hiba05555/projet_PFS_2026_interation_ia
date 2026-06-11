'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3205;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const reviewSchema = z.object({
  employee_id:     z.string().uuid(),
  review_period:   z.string().min(2).max(50),          // ex: "Q2-2025", "Annuel-2025"
  review_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewer_id:     z.string().uuid().optional(),
  overall_rating:  z.number().min(1).max(5),
  goals_rating:    z.number().min(1).max(5).optional(),
  skills_rating:   z.number().min(1).max(5).optional(),
  conduct_rating:  z.number().min(1).max(5).optional(),
  strengths:       z.string().max(1000).optional(),
  improvements:    z.string().max(1000).optional(),
  goals_next:      z.string().max(1000).optional(),
  comments:        z.string().max(2000).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'hr-performance', status: 'healthy', port: PORT }));

// Statistiques globales des performances
app.get('/stats', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT
         ROUND(AVG(overall_rating), 2) as avg_rating,
         COUNT(*) as total_reviews,
         COUNT(CASE WHEN overall_rating >= 4 THEN 1 END) as high_performers,
         COUNT(CASE WHEN overall_rating <= 2 THEN 1 END) as needs_improvement
       FROM hr_schema.performance_reviews WHERE status = 'completed'`
    );
    res.json({ success: true, data: r.rows[0] });
  })
);

app.get('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { employee_id, review_period, status } = req.query;
    const params = []; const conds = [];

    if (employee_id)   { params.push(employee_id);   conds.push(`pr.employee_id = $${params.length}`); }
    if (review_period) { params.push(review_period); conds.push(`pr.review_period = $${params.length}`); }
    if (status)        { params.push(status);        conds.push(`pr.status = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT pr.*, e.first_name, e.last_name, e.department
         FROM hr_schema.performance_reviews pr
         JOIN hr_schema.employees e ON pr.employee_id = e.employee_id
         ${where} ORDER BY pr.review_date DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM hr_schema.performance_reviews pr ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.department, e.position
       FROM hr_schema.performance_reviews pr
       JOIN hr_schema.employees e ON pr.employee_id = e.employee_id
       WHERE pr.review_id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Évaluation introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = reviewSchema.parse(req.body);

    // Vérifier qu'une évaluation n'existe pas déjà pour cette période/employé
    const exists = await pool.query(
      `SELECT review_id FROM hr_schema.performance_reviews WHERE employee_id = $1 AND review_period = $2 AND status != 'cancelled'`,
      [data.employee_id, data.review_period]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Une évaluation existe déjà pour cet employé et cette période.' });

    const r = await pool.query(
      `INSERT INTO hr_schema.performance_reviews
         (employee_id, review_period, review_date, reviewer_id, overall_rating, goals_rating, skills_rating,
          conduct_rating, strengths, improvements, goals_next, comments, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft') RETURNING *`,
      [data.employee_id, data.review_period, data.review_date, data.reviewer_id || req.user.id,
       data.overall_rating, data.goals_rating, data.skills_rating, data.conduct_rating,
       data.strengths, data.improvements, data.goals_next, data.comments, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Évaluation créée.', data: r.rows[0] });
  })
);

app.patch('/:id/complete', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.performance_reviews SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE review_id = $1 AND status = 'draft' RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Évaluation introuvable ou déjà finalisée.' });
    res.json({ success: true, message: 'Évaluation finalisée.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const allowed = ['overall_rating','goals_rating','skills_rating','conduct_rating','strengths','improvements','goals_next','comments'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE hr_schema.performance_reviews SET ${fields.join(', ')}, updated_at = NOW()
       WHERE review_id = $${values.length} AND status = 'draft' RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Évaluation introuvable ou déjà finalisée.' });
    res.json({ success: true, message: 'Évaluation mise à jour.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ hr-performance sur le port ${PORT}`));
