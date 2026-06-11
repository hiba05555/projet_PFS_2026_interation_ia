'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const { Pool }   = require('pg');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { z }      = require('zod');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── JWT Secret — UNIQUE et depuis l'environnement ────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET manquant en production.');
    process.exit(1);
  }
  console.warn('⚠️  JWT_SECRET absent — fallback dev seulement.');
}
const _SECRET = JWT_SECRET || 'dev_secret_only_never_in_prod';

// ─── Trust proxy (nginx) ───────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    const allowed = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost'];
    if (!origin || allowed.some(o => origin.includes(o))) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(express.json({ limit: '10kb' }));

// Rate limiting spécifique au login (anti brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Base de données ───────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'erp_database',
  user:     process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,  // ← pas de fallback en dur
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});
pool.on('error', (err) => console.error('[DB Pool Auth]', err.message));

// ─── Email ─────────────────────────────────────────────────────────────────
const emailEnabled = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
let transporter = null;
if (emailEnabled) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  transporter.verify()
    .then(() => console.log('✅ Gmail connecté'))
    .catch(e => console.error('❌ Gmail:', e.message));
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const generateTempPassword = () => {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;
  let pwd =
    upper[crypto.randomInt(upper.length)] +
    lower[crypto.randomInt(lower.length)] +
    digits[crypto.randomInt(digits.length)] +
    special[crypto.randomInt(special.length)];
  for (let i = 0; i < 8; i++) pwd += all[crypto.randomInt(all.length)];
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Schémas de validation ─────────────────────────────────────────────────
const registerSchema = z.object({
  username:   z.string().min(3).max(50),
  email:      z.string().email(),
  password:   z.string().min(8),
  role:       z.enum(['admin','it','hr','finance','operations','employee']).default('employee'),
  department: z.string().min(2).max(100),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Le mot de passe doit contenir majuscule, minuscule et chiffre'
  ),
});

// ─── Routes ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ service: 'auth', status: 'healthy', port: PORT })
);

// POST /register
app.post('/register', asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  const exists = await pool.query(
    'SELECT user_id FROM auth_schema.users WHERE email = $1 OR username = $2',
    [data.email, data.username]
  );
  if (exists.rows.length)
    return res.status(409).json({ success: false, message: 'Email ou nom d\'utilisateur déjà utilisé.' });

  const hash = await bcrypt.hash(data.password, 12);
  const r = await pool.query(
    `INSERT INTO auth_schema.users (username, email, password_hash, role, department, is_active)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING user_id, username, email, role, department, created_at`,
    [data.username, data.email, hash, data.role, data.department]
  );

  const user = r.rows[0];
  const token = jwt.sign(
    { id: user.user_id, role: user.role, department: user.department, email: user.email },
    _SECRET,
    { expiresIn: '8h' }
  );

  res.status(201).json({ success: true, message: 'Compte créé.', token, user });
}));

// POST /login
app.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);

  const r = await pool.query(
    'SELECT * FROM auth_schema.users WHERE email = $1 AND is_active = true',
    [data.email]
  );

  // Même délai si l'utilisateur n'existe pas (protection timing attack)
  const dummyHash = '$2b$12$invalidhashtopreventtimingattacks000000000000000000000';
  const storedHash = r.rows[0]?.password_hash || dummyHash;
  const valid = await bcrypt.compare(data.password, storedHash);

  if (!r.rows.length || !valid)
    return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });

  const user = r.rows[0];

  // Mettre à jour last_login
  await pool.query('UPDATE auth_schema.users SET last_login = NOW() WHERE user_id = $1', [user.user_id]);

  const token = jwt.sign(
    { id: user.user_id, role: user.role, department: user.department, email: user.email },
    _SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    success: true,
    message: 'Connexion réussie.',
    token,
    mustChangePassword: user.must_change_password === true,
    user: {
      id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role,
      department: user.department,
    },
  });
}));

// GET /verify — valider un token (utilisé par la gateway)
app.get('/verify', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Token manquant.' });

  const token = authHeader.split(' ')[1];   // ✅ CORRIGÉ : [1] pas le tableau entier
  try {
    const decoded = jwt.verify(token, _SECRET);
    res.json({ success: true, valid: true, user: decoded });
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expirée.' : 'Token invalide.';
    res.status(401).json({ success: false, valid: false, message });
  }
}));

// POST /change-password
app.post('/change-password', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Token manquant.' });

  const token = authHeader.split(' ')[1];
  let decoded;
  try { decoded = jwt.verify(token, _SECRET); }
  catch { return res.status(401).json({ success: false, message: 'Token invalide.' }); }

  const { current_password, new_password } = changePasswordSchema.parse(req.body);

  const r = await pool.query('SELECT password_hash FROM auth_schema.users WHERE user_id = $1', [decoded.id]);
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

  const valid = await bcrypt.compare(current_password, r.rows[0].password_hash);
  if (!valid) return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect.' });

  const newHash = await bcrypt.hash(new_password, 12);
  await pool.query('UPDATE auth_schema.users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2', [newHash, decoded.id]);

  res.json({ success: true, message: 'Mot de passe modifié.' });
}));

// POST /forgot-password
app.post('/forgot-password', loginLimiter, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);

  const r = await pool.query('SELECT user_id, username FROM auth_schema.users WHERE email = $1 AND is_active = true', [email]);

  // Toujours répondre 200 (ne pas révéler si l'email existe)
  res.json({ success: true, message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });

  if (!r.rows.length || !emailEnabled || !transporter) return;

  const resetToken  = crypto.randomBytes(32).toString('hex');
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await pool.query(
    'UPDATE auth_schema.users SET reset_token = $1, reset_token_expires = $2 WHERE user_id = $3',
    [resetToken, resetExpiry, r.rows[0].user_id]
  );

  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
  await transporter.sendMail({
    from: `"DataProtect ERP" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: '🔐 Réinitialisation de votre mot de passe',
    html: `<p>Bonjour ${r.rows[0].username},</p>
           <p>Cliquez sur ce lien pour réinitialiser votre mot de passe (valable 1h) :</p>
           <a href="${resetUrl}">${resetUrl}</a>`,
  }).catch(e => console.error('Email reset error:', e.message));
}));

// POST /reset-password
app.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, new_password } = z.object({
    token:        z.string().min(1),
    new_password: z.string().min(8),
  }).parse(req.body);

  const r = await pool.query(
    'SELECT user_id FROM auth_schema.users WHERE reset_token = $1 AND reset_token_expires > NOW() AND is_active = true',
    [token]
  );
  if (!r.rows.length)
    return res.status(400).json({ success: false, message: 'Token invalide ou expiré.' });

  const hash = await bcrypt.hash(new_password, 12);
  await pool.query(
    'UPDATE auth_schema.users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE user_id = $2',
    [hash, r.rows[0].user_id]
  );
  res.json({ success: true, message: 'Mot de passe réinitialisé.' });
}));

// ─── Helper admin : vérifie le JWT et exige le rôle admin ─────────────────
const verifyAdmin = (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer '))
    { res.status(401).json({ success: false, message: 'Token manquant.' }); return null; }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], _SECRET);
    if (decoded.role !== 'admin')
      { res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs.' }); return null; }
    return decoded;
  } catch {
    res.status(401).json({ success: false, message: 'Token invalide.' });
    return null;
  }
};

// GET /users — liste tous les utilisateurs (admin uniquement)
app.get('/users', asyncHandler(async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const { role, is_active, search } = req.query;
  const params = []; const conds = [];

  if (role)       { params.push(role);    conds.push(`role = $${params.length}`); }
  if (is_active !== undefined) { params.push(is_active === 'true'); conds.push(`is_active = $${params.length}`); }
  if (search)     { params.push(`%${search}%`); conds.push(`(username ILIKE $${params.length} OR email ILIKE $${params.length})`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, total] = await Promise.all([
    pool.query(
      `SELECT user_id, username, email, role, department, job_title, is_active, last_login, created_at
       FROM auth_schema.users ${where} ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(`SELECT COUNT(*) FROM auth_schema.users ${where}`, params.slice(0, -2)),
  ]);
  res.json({ success: true, data: data.rows, pagination: { page, limit, total: parseInt(total.rows[0].count) } });
}));

// POST /admin/create — créer un utilisateur avec MDP auto-généré (admin uniquement)
app.post('/admin/create', asyncHandler(async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const schema = z.object({
    username:   z.string().min(3).max(50),
    email:      z.string().email(),
    role:       z.enum(['admin','it','hr','finance','operations','employee']).default('employee'),
    department: z.string().min(2).max(100),
    job_title:  z.string().max(100).optional(),
  });
  const data = schema.parse(req.body);

  const exists = await pool.query(
    'SELECT user_id FROM auth_schema.users WHERE email = $1 OR username = $2',
    [data.email, data.username]
  );
  if (exists.rows.length)
    return res.status(409).json({ success: false, message: "Email ou nom d'utilisateur déjà utilisé." });

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);

  const r = await pool.query(
    `INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,true,true)
     RETURNING user_id, username, email, role, department, job_title, created_at`,
    [data.username, data.email, hash, data.role, data.department, data.job_title || null]
  );
  const user = r.rows[0];

  let emailSent = false;
  if (emailEnabled && transporter) {
    try {
      await transporter.sendMail({
        from: `"DataProtect ERP" <${process.env.GMAIL_USER}>`,
        to:   data.email,
        subject: '🔐 Vos identifiants DataProtect ERP',
        html: `<p>Bonjour ${data.username},</p>
               <p>Votre compte ERP a été créé. Voici vos identifiants temporaires :</p>
               <ul>
                 <li><b>Email :</b> ${data.email}</li>
                 <li><b>Mot de passe temporaire :</b> <code>${tempPassword}</code></li>
               </ul>
               <p>⚠️ Vous devrez changer ce mot de passe à la première connexion.</p>`,
      });
      emailSent = true;
    } catch (e) { console.error('Email create-user error:', e.message); }
  }

  res.status(201).json({
    success: true,
    message: 'Utilisateur créé.',
    data: user,
    tempPassword: emailSent ? undefined : tempPassword,
    emailSent,
    emailMessage: emailSent
      ? 'Identifiants envoyés par email à l\'utilisateur.'
      : 'Email non configuré — communiquez ces identifiants manuellement.',
  });
}));

// POST /:id/activate — activer un compte (admin uniquement)
app.post('/:id/activate', asyncHandler(async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const r = await pool.query(
    `UPDATE auth_schema.users SET is_active = true, updated_at = NOW()
     WHERE user_id = $1 AND is_active = false
     RETURNING user_id, username, email, is_active`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Utilisateur introuvable ou déjà actif.' });
  res.json({ success: true, message: 'Compte activé.', data: r.rows[0] });
}));

// POST /:id/deactivate — désactiver un compte (admin uniquement)
app.post('/:id/deactivate', asyncHandler(async (req, res) => {
  const admin = verifyAdmin(req, res);
  if (!admin) return;

  if (String(admin.id) === String(req.params.id))
    return res.status(400).json({ success: false, message: 'Impossible de désactiver son propre compte.' });

  const r = await pool.query(
    `UPDATE auth_schema.users SET is_active = false, updated_at = NOW()
     WHERE user_id = $1 AND is_active = true AND role != 'admin'
     RETURNING user_id, username, email, is_active`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Utilisateur introuvable, déjà inactif ou admin protégé.' });
  res.json({ success: true, message: 'Compte désactivé.', data: r.rows[0] });
}));

// POST /:id/reset-password — réinitialiser le MDP avec un nouveau temporaire (admin uniquement)
app.post('/:id/reset-password', asyncHandler(async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);

  const r = await pool.query(
    `UPDATE auth_schema.users SET password_hash = $1, must_change_password = true, updated_at = NOW()
     WHERE user_id = $2
     RETURNING user_id, username, email`,
    [hash, req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

  res.json({
    success: true,
    message: 'Mot de passe réinitialisé.',
    data: r.rows[0],
    tempPassword,
  });
}));

// ─── Gestionnaire d'erreurs global ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[Auth Error]', err);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }
  res.status(500).json({
    success: false,
    message: 'Erreur interne.',
    ...(isDev ? { debug: err.message } : {}),
  });
});

app.listen(PORT, () => console.log(`✅ Auth service sur le port ${PORT}`));
