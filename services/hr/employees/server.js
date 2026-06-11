'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3201;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const employeeSchema = z.object({
  first_name:       z.string().min(2).max(100),
  last_name:        z.string().min(2).max(100),
  email:            z.string().email(),
  phone:            z.string().max(20).optional(),
  department:       z.string().min(2).max(100),
  position:         z.string().min(2).max(200),
  employment_type:  z.enum(['full_time', 'part_time', 'contractor', 'intern']).default('full_time'),
  hire_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  salary:           z.number().positive().optional(),
  manager_id:       z.string().uuid().optional(),
});

const employeeUpdateSchema = employeeSchema.partial().omit({ email: true, hire_date: true });

app.get('/health', (_req, res) => res.json({ service: 'hr-employees', status: 'healthy', port: PORT }));

// GET / — liste avec filtres et pagination
app.get('/', verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { department, status, employment_type, search } = req.query;
    const params = []; const conds = [];

    // ── RBAC data scoping ────────────────────────────────────────────────────
    // admin             → pas de filtre (accès total)
    // dept HR (tout rôle) → accès à tous les employés (RH gère tout le personnel)
    // manager non-RH    → uniquement son département
    // employee non-RH   → uniquement sa propre fiche (filtré par email)
    if (req.user.role === 'admin' || req.user.department === 'HR') {
      // pas de filtre supplémentaire
    } else if (req.user.role === 'manager') {
      params.push(req.user.department);
      conds.push(`department = $${params.length}`);
    } else {
      params.push(req.user.email);
      conds.push(`email = $${params.length}`);
    }

    if (department)      { params.push(department);      conds.push(`department = $${params.length}`); }
    if (status)          { params.push(status);          conds.push(`status = $${params.length}`); }
    if (employment_type) { params.push(employment_type); conds.push(`employment_type = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conds.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    // On exclut le salaire pour les non-managers/admin
    const salaryField = (req.user.role === 'admin' || req.user.department === 'HR') ? 'salary,' : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        `SELECT employee_id, employee_number, first_name, last_name, email, phone, department, position,
                employment_type, hire_date, ${salaryField} status, manager_id, created_at
         FROM hr_schema.employees ${where} ORDER BY last_name ASC, first_name ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM hr_schema.employees ${where}`, params.slice(0, -2)),
    ]);

    res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
  })
);

app.get('/:id', verifyToken,
  asyncHandler(async (req, res) => {
    const isHrOrAdmin = req.user.role === 'admin' || req.user.department === 'HR';
    const salaryField = isHrOrAdmin ? 'salary,' : '';
    const r = await pool.query(
      `SELECT employee_id, employee_number, first_name, last_name, email, phone, department, position,
              employment_type, hire_date, ${salaryField} status, manager_id, termination_date, created_at
       FROM hr_schema.employees WHERE employee_id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Employé introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

app.post('/', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = employeeSchema.parse(req.body);

    // Vérifier l'unicité de l'email
    const exists = await pool.query('SELECT employee_id FROM hr_schema.employees WHERE email = $1', [data.email]);
    if (exists.rows.length) return res.status(409).json({ success: false, message: 'Un employé avec cet email existe déjà.' });

    const empNumber = `EMP-${Date.now()}`;
    const r = await pool.query(
      `INSERT INTO hr_schema.employees
         (employee_number, first_name, last_name, email, phone, department, position, employment_type, hire_date, salary, manager_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active') RETURNING *`,
      [empNumber, data.first_name, data.last_name, data.email, data.phone, data.department,
       data.position, data.employment_type, data.hire_date, data.salary, data.manager_id]
    );
    res.status(201).json({ success: true, message: 'Employé créé.', data: r.rows[0] });
  })
);

app.patch('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const data = employeeUpdateSchema.parse(req.body);
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE hr_schema.employees SET ${fields.join(', ')}, updated_at = NOW()
       WHERE employee_id = $${values.length} AND status != 'terminated' RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Employé introuvable ou déjà terminé.' });
    res.json({ success: true, message: 'Employé mis à jour.', data: r.rows[0] });
  })
);

// Soft delete = terminaison
app.delete('/:id', verifyToken, requireDeptOrAdmin('HR'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE hr_schema.employees SET status = 'terminated', termination_date = NOW(), updated_at = NOW()
       WHERE employee_id = $1 AND status = 'active' RETURNING employee_id, first_name, last_name, department`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Employé introuvable ou déjà terminé.' });
    res.json({ success: true, message: 'Employé marqué comme terminé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ hr-employees sur le port ${PORT}`));
