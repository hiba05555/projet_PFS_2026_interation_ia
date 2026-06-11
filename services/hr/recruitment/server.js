'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3203;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const candidateSchema = z.object({
  first_name:    z.string().min(2).max(100),
  last_name:     z.string().min(2).max(100),
  email:         z.string().email(),
  phone:         z.string().max(20).optional(),
  position_applied: z.string().min(2).max(200),
  department:    z.string().min(2).max(100),
  cv_url:        z.string().url().optional(),
  source:        z.enum(['linkedin', 'indeed', 'referral', 'website', 'other']).default('other'),
  notes:         z.string().max(1000).optional(),
});

const interviewSchema = z.object({
  interview_date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  interviewer:    z.string().min(2),
  type:           z.enum(['phone', 'video', 'onsite', 'technical']).default('video'),
  notes:          z.string().max(1000).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'hr-recruitment', status: 'healthy', port: PORT }));

app.get('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, department, source } = req.query;
    const params = []; const conds = [];

    if (status)     { params.push(status);     conds.push(`status = $${params.length}`); }
    if (department) { params.push(department); conds.push(`department = $${params.length}`); }
    if (source)     { params.push(source);     conds.push(`source = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM hr_schema.recruitment_candidates ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM hr_schema.recruitment_candidates ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM hr_schema.recruitment_candidates WHERE candidate_id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Candidat introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = candidateSchema.parse(req.body);

    const exists = await pool.query(
      `SELECT candidate_id FROM hr_schema.recruitment_candidates WHERE email = $1 AND status NOT IN ('rejected','withdrawn')`,
      [data.email]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Un candidat actif avec cet email existe déjà.' });

    const r = await pool.query(
      `INSERT INTO hr_schema.recruitment_candidates
         (first_name, last_name, email, phone, position_applied, department, cv_url, source, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new') RETURNING *`,
      [data.first_name, data.last_name, data.email, data.phone, data.position_applied,
       data.department, data.cv_url, data.source, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Candidat ajouté.', data: r.rows[0] });
  })
);

// Workflow recrutement : new → screening → interview → offer → hired / rejected
const VALID_TRANSITIONS = {
  new:        ['screening', 'rejected'],
  screening:  ['interview', 'rejected'],
  interview:  ['offer', 'rejected'],
  offer:      ['hired', 'rejected', 'withdrawn'],
};

app.patch('/:id/status', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const { status: newStatus } = z.object({ status: z.string() }).parse(req.body);
    const current = await pool.query('SELECT status FROM hr_schema.recruitment_candidates WHERE candidate_id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ success: false, message: 'Candidat introuvable.' });

    const allowed = VALID_TRANSITIONS[current.rows[0].status] || [];
    if (!allowed.includes(newStatus))
      return res.status(400).json({ success: false, message: `Transition invalide : ${current.rows[0].status} → ${newStatus}. Valides : ${allowed.join(', ')}` });

    const r = await pool.query(
      `UPDATE hr_schema.recruitment_candidates SET status = $1, updated_at = NOW() WHERE candidate_id = $2 RETURNING *`,
      [newStatus, req.params.id]
    );
    res.json({ success: true, message: `Statut mis à jour : ${newStatus}.`, data: r.rows[0] });
  })
);

// Planifier un entretien
app.post('/:id/interviews', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = interviewSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO hr_schema.candidate_interviews (candidate_id, interview_date, interviewer, type, notes, scheduled_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, data.interview_date, data.interviewer, data.type, data.notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Entretien planifié.', data: r.rows[0] });
  })
);

app.delete('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.recruitment_candidates SET status = 'withdrawn', updated_at = NOW()
       WHERE candidate_id = $1 RETURNING candidate_id, first_name, last_name`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Candidat introuvable.' });
    res.json({ success: true, message: 'Candidature retirée.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ hr-recruitment sur le port ${PORT}`));
