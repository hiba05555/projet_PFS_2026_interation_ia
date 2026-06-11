'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3104;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const metricSchema = z.object({
  service_name: z.string().min(2).max(200),
  metric_type:  z.enum(['cpu','memory','disk','network','latency','error_rate','uptime','custom']),
  value:        z.number(),
  unit:         z.string().max(50).default('%'),
  threshold_warn:  z.number().optional(),
  threshold_crit:  z.number().optional(),
  host:         z.string().max(200).optional(),
  tags:         z.record(z.string()).optional(),
});

const alertSchema = z.object({
  service_name: z.string().min(2).max(200),
  severity:     z.enum(['info','warning','critical']),
  message:      z.string().min(5).max(500),
  metric_type:  z.string().max(100).optional(),
  value:        z.number().optional(),
  host:         z.string().max(200).optional(),
});

app.get('/health', (_req, res) => res.json({ service: 'it-monitoring', status: 'healthy', port: PORT }));

// Dashboard — état global des services
app.get('/dashboard', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const [metrics, alerts] = await Promise.all([
      pool.query(
        `SELECT service_name, metric_type, value, unit, recorded_at
         FROM it_schema.monitoring_metrics
         WHERE recorded_at > NOW() - INTERVAL '1 hour'
         ORDER BY recorded_at DESC`
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE severity='critical' AND status='open') as critical_open,
                COUNT(*) FILTER (WHERE severity='warning' AND status='open') as warning_open,
                COUNT(*) FILTER (WHERE status='open') as total_open
         FROM it_schema.monitoring_alerts`
      ),
    ]);
    res.json({ success: true, data: { recent_metrics: metrics.rows, alert_summary: alerts.rows[0] } });
  })
);

// Métriques par service
app.get('/metrics', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { service_name, metric_type, from, to } = req.query;
    const params = []; const conds = [];

    if (service_name) { params.push(service_name);    conds.push(`service_name = $${params.length}`); }
    if (metric_type)  { params.push(metric_type);     conds.push(`metric_type = $${params.length}`); }
    if (from)         { params.push(from);            conds.push(`recorded_at >= $${params.length}`); }
    if (to)           { params.push(to);              conds.push(`recorded_at <= $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT * FROM it_schema.monitoring_metrics ${where}
         ORDER BY recorded_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM it_schema.monitoring_metrics ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

// Enregistrer une métrique (depuis les agents de monitoring)
app.post('/metrics', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const data = metricSchema.parse(req.body);

    // Déterminer automatiquement le niveau d'alerte
    let alertLevel = null;
    if (data.threshold_crit !== undefined && data.value >= data.threshold_crit) alertLevel = 'critical';
    else if (data.threshold_warn !== undefined && data.value >= data.threshold_warn) alertLevel = 'warning';

    const r = await pool.query(
      `INSERT INTO it_schema.monitoring_metrics
         (service_name, metric_type, value, unit, threshold_warn, threshold_crit, alert_level, host, tags, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [data.service_name, data.metric_type, data.value, data.unit, data.threshold_warn,
       data.threshold_crit, alertLevel, data.host, JSON.stringify(data.tags || {}), req.user.id]
    );

    // Créer automatiquement une alerte si seuil dépassé
    if (alertLevel) {
      await pool.query(
        `INSERT INTO it_schema.monitoring_alerts
           (service_name, severity, message, metric_type, value, host, status)
         VALUES ($1,$2,$3,$4,$5,$6,'open')`,
        [data.service_name, alertLevel,
         `${data.metric_type} à ${data.value}${data.unit} (seuil ${alertLevel === 'critical' ? data.threshold_crit : data.threshold_warn}${data.unit})`,
         data.metric_type, data.value, data.host]
      );
    }

    res.status(201).json({ success: true, message: 'Métrique enregistrée.', data: r.rows[0], alert_triggered: alertLevel });
  })
);

// Alertes
app.get('/alerts', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { severity, status, service_name } = req.query;
    const params = []; const conds = [];

    if (severity)     { params.push(severity);     conds.push(`severity = $${params.length}`); }
    if (status)       { params.push(status);       conds.push(`status = $${params.length}`); }
    if (service_name) { params.push(service_name); conds.push(`service_name = $${params.length}`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT * FROM it_schema.monitoring_alerts ${where}
         ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM it_schema.monitoring_alerts ${where}`, params.slice(0, -2)),
    ]);
    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.post('/alerts', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const data = alertSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO it_schema.monitoring_alerts
         (service_name, severity, message, metric_type, value, host, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open') RETURNING *`,
      [data.service_name, data.severity, data.message, data.metric_type, data.value, data.host, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Alerte créée.', data: r.rows[0] });
  })
);

// Acquitter une alerte
app.patch('/alerts/:id/acknowledge', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE it_schema.monitoring_alerts
       SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW()
       WHERE alert_id = $2 AND status = 'open' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Alerte introuvable ou déjà traitée.' });
    res.json({ success: true, message: 'Alerte acquittée.', data: r.rows[0] });
  })
);

// Résoudre une alerte
app.patch('/alerts/:id/resolve', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { resolution } = z.object({ resolution: z.string().max(500).optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE it_schema.monitoring_alerts
       SET status = 'resolved', resolved_by = $1, resolved_at = NOW(), resolution = $2
       WHERE alert_id = $3 AND status != 'resolved' RETURNING *`,
      [req.user.id, resolution, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Alerte introuvable ou déjà résolue.' });
    res.json({ success: true, message: 'Alerte résolue.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ it-monitoring sur le port ${PORT}`));
