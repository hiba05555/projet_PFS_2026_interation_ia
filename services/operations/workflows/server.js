'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3402;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const workflowSchema = z.object({
  name:        z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  type:        z.enum(['approval','onboarding','procurement','maintenance','custom']).default('custom'),
  steps:       z.array(z.object({
    name:       z.string().min(1).max(200),
    order:      z.number().int().positive(),
    assignee_role: z.string().max(100).optional(),
    due_days:   z.number().int().positive().optional(),
    required:   z.boolean().default(true),
  })).min(1),
  triggered_by: z.string().max(200).optional(),
});

const instanceSchema = z.object({
  workflow_id:  z.string().uuid(),
  title:        z.string().min(2).max(200),
  initiated_for: z.string().uuid().optional(),
  context:      z.record(z.unknown()).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'ops-workflows', status: 'healthy', port: PORT }));

// ─── Définitions de workflows ──────────────────────────────────────────────

app.get('/definitions', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { type } = req.query;
    const params = []; const conds = [];
    if (type) { params.push(type); conds.push(`type = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);
    const [data, total] = await Promise.all([
      pool.query(`SELECT * FROM ops_schema.workflow_definitions ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM ops_schema.workflow_definitions ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.post('/definitions', verifyToken, requireDeptOrAdmin('Operations'),
  asyncHandler(async (req, res) => {
    const data = workflowSchema.parse(req.body);
    // Vérifier que les orders sont uniques et séquentiels
    const orders = data.steps.map(s => s.order).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length)
      return res.status(400).json({ success: false, message: 'Les ordres des étapes doivent être uniques.' });

    const r = await pool.query(
      `INSERT INTO ops_schema.workflow_definitions (name, description, type, steps, triggered_by, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
      [data.name, data.description, data.type, JSON.stringify(data.steps), data.triggered_by, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Workflow créé.', data: r.rows[0] });
  })
);

// ─── Instances de workflows (exécutions) ──────────────────────────────────

app.get('/instances', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, workflow_id } = req.query;
    const params = []; const conds = [];

    if (req.user.role !== 'admin' && req.user.department !== 'Operations') {
      params.push(req.user.id);
      conds.push(`(initiated_by = $${params.length} OR initiated_for = $${params.length})`);
    }
    if (status)      { params.push(status);      conds.push(`status = $${params.length}`); }
    if (workflow_id) { params.push(workflow_id); conds.push(`workflow_id = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT wi.*, wd.name as workflow_name, wd.type
         FROM ops_schema.workflow_instances wi
         JOIN ops_schema.workflow_definitions wd ON wi.workflow_id = wd.definition_id
         ${where} ORDER BY wi.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM ops_schema.workflow_instances wi ${where}`,
        params.slice(0, -2)
      ),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

// Démarrer une instance de workflow
app.post('/instances', verifyToken,
  asyncHandler(async (req, res) => {
    const data = instanceSchema.parse(req.body);

    const wf = await pool.query(
      `SELECT * FROM ops_schema.workflow_definitions WHERE definition_id = $1 AND status = 'active'`,
      [data.workflow_id]
    );
    if (!wf.rows.length)
      return res.status(404).json({ success: false, message: 'Définition de workflow introuvable ou inactive.' });

    const steps = wf.rows[0].steps;
    const firstStep = steps.sort((a, b) => a.order - b.order)[0];

    const r = await pool.query(
      `INSERT INTO ops_schema.workflow_instances
         (workflow_id, title, initiated_by, initiated_for, context, current_step, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
      [data.workflow_id, data.title, req.user.id, data.initiated_for,
       JSON.stringify(data.context || {}), firstStep.order]
    );
    res.status(201).json({ success: true, message: 'Workflow démarré.', data: r.rows[0], current_step: firstStep });
  })
);

// Avancer à l'étape suivante / compléter
app.patch('/instances/:id/advance', verifyToken,
  asyncHandler(async (req, res) => {
    const { action, comment } = z.object({
      action:  z.enum(['approve','reject','complete']),
      comment: z.string().max(500).optional(),
    }).parse(req.body);

    const inst = await pool.query(
      `SELECT wi.*, wd.steps FROM ops_schema.workflow_instances wi
       JOIN ops_schema.workflow_definitions wd ON wi.workflow_id = wd.definition_id
       WHERE wi.instance_id = $1 AND wi.status = 'active'`,
      [req.params.id]
    );
    if (!inst.rows.length) return res.status(404).json({ success: false, message: 'Instance introuvable ou déjà terminée.' });

    const instance = inst.rows[0];
    const steps = instance.steps.sort((a, b) => a.order - b.order);
    const currentIdx = steps.findIndex(s => s.order === instance.current_step);
    const nextStep = steps[currentIdx + 1];

    let newStatus = 'active';
    let newStep = instance.current_step;

    if (action === 'reject') {
      newStatus = 'rejected';
    } else if (!nextStep || action === 'complete') {
      newStatus = 'completed';
    } else {
      newStep = nextStep.order;
    }

    // Enregistrer l'action
    await pool.query(
      `INSERT INTO ops_schema.workflow_step_logs (instance_id, step_order, action, performed_by, comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, instance.current_step, action, req.user.id, comment]
    );

    const r = await pool.query(
      `UPDATE ops_schema.workflow_instances SET current_step = $1, status = $2, updated_at = NOW()
       ${newStatus !== 'active' ? ', completed_at = NOW()' : ''}
       WHERE instance_id = $3 RETURNING *`,
      [newStep, newStatus, req.params.id]
    );

    res.json({
      success: true,
      message: newStatus === 'completed' ? 'Workflow complété.' : newStatus === 'rejected' ? 'Workflow rejeté.' : 'Étape avancée.',
      data: r.rows[0],
      next_step: nextStep || null,
    });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ ops-workflows sur le port ${PORT}`));
