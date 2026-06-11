'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const bcrypt  = require('bcrypt');
const { z }   = require('zod');
const pool    = require('./shared/middleware/db');
const { verifyToken, requireDeptOrAdmin, asyncHandler, errorHandler, getPagination } =
  require('./shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3102;
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const SALT_ROUNDS = 12;

const userSchema = z.object({
  username:   z.string().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Caractères invalides dans le nom d\'utilisateur'),
  email:      z.string().email(),
  password:   z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    'Mot de passe trop faible (min 8 chars, majuscule, chiffre, caractère spécial)'
  ),
  role:       z.enum(['admin','it','hr','finance','operations','employee']).default('employee'),
  department: z.string().min(2).max(100),
});

const passwordSchema = z.object({
  new_password: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    'Mot de passe trop faible (min 8 chars, majuscule, chiffre, caractère spécial)'
  ),
});

app.get('/health', (_req, res) =>
  res.json({ service: 'it-user-accounts', status: 'healthy', port: PORT })
);

// GET / — liste des comptes avec filtres
app.get('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { department, role, is_active, search } = req.query;
    const params = []; const conds = [];

    if (department) { params.push(department);    conds.push(`department = $${params.length}`); }
    if (role)       { params.push(role);          conds.push(`role = $${params.length}`); }
    if (is_active !== undefined) { params.push(is_active === 'true'); conds.push(`is_active = $${params.length}`); }
    if (search)     { params.push(`%${search}%`); conds.push(`(username ILIKE $${params.length} OR email ILIKE $${params.length})`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const [data, total] = await Promise.all([
      pool.query(
        // ⚠️ Ne jamais retourner password_hash
        `SELECT account_id, username, email, role, department, is_active, last_login, created_at, updated_at
         FROM it_schema.user_accounts ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM it_schema.user_accounts ${where}`, params.slice(0, -2)),
    ]);
    res.json({
      success: true,
      data: data.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
    });
  })
);

// GET /:id
app.get('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT account_id, username, email, role, department, is_active, last_login, created_at
       FROM it_schema.user_accounts WHERE account_id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    res.json({ success: true, data: r.rows[0] });
  })
);

// POST / — créer un compte utilisateur
app.post('/', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const data = userSchema.parse(req.body);

    const exists = await pool.query(
      'SELECT account_id FROM it_schema.user_accounts WHERE email = $1 OR username = $2',
      [data.email, data.username]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Email ou nom d\'utilisateur déjà utilisé.' });

    const hash = await bcrypt.hash(data.password, SALT_ROUNDS);
    const r = await pool.query(
      `INSERT INTO it_schema.user_accounts (username, email, password_hash, role, department, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6)
       RETURNING account_id, username, email, role, department, is_active, created_at`,
      [data.username, data.email, hash, data.role, data.department, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Compte créé.', data: r.rows[0] });
  })
);

// PATCH /:id — mise à jour (sans toucher au mot de passe)
app.patch('/:id', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const allowed = ['username', 'role', 'department'];
    const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ valide à mettre à jour.' });

    // Vérifier unicité du username si changé
    if (data.username) {
      const dup = await pool.query(
        'SELECT account_id FROM it_schema.user_accounts WHERE username = $1 AND account_id != $2',
        [data.username, req.params.id]
      );
      if (dup.rows.length)
        return res.status(409).json({ success: false, message: 'Ce nom d\'utilisateur est déjà pris.' });
    }

    const fields = Object.keys(data).map((k, i) => `${k} = $${i + 1}`);
    const values = [...Object.values(data), req.params.id];
    const r = await pool.query(
      `UPDATE it_schema.user_accounts SET ${fields.join(', ')}, updated_at = NOW()
       WHERE account_id = $${values.length}
       RETURNING account_id, username, email, role, department, is_active`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    res.json({ success: true, message: 'Compte mis à jour.', data: r.rows[0] });
  })
);

// POST /:id/deactivate — désactivation
app.post('/:id/deactivate', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    // Empêcher de se désactiver soi-même
    if (req.params.id === req.user.id)
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas désactiver votre propre compte.' });

    const r = await pool.query(
      `UPDATE it_schema.user_accounts SET is_active = false, updated_at = NOW()
       WHERE account_id = $1 AND is_active = true
       RETURNING account_id, username, email, is_active`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Compte introuvable ou déjà inactif.' });
    res.json({ success: true, message: 'Compte désactivé.', data: r.rows[0] });
  })
);

// POST /:id/activate — réactivation
app.post('/:id/activate', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `UPDATE it_schema.user_accounts SET is_active = true, updated_at = NOW()
       WHERE account_id = $1 AND is_active = false
       RETURNING account_id, username, email, is_active`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Compte introuvable ou déjà actif.' });
    res.json({ success: true, message: 'Compte activé.', data: r.rows[0] });
  })
);

// POST /:id/reset-password — réinitialisation par IT
app.post('/:id/reset-password', verifyToken, requireDeptOrAdmin('IT'),
  asyncHandler(async (req, res) => {
    const { new_password } = passwordSchema.parse(req.body);
    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);

    const r = await pool.query(
      `UPDATE it_schema.user_accounts SET password_hash = $1, updated_at = NOW()
       WHERE account_id = $2 RETURNING account_id, username`,
      [hash, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    res.json({ success: true, message: 'Mot de passe réinitialisé.', data: r.rows[0] });
  })
);

app.use(errorHandler);
app.listen(PORT, () => console.log(`✅ it-user-accounts sur le port ${PORT}`));
