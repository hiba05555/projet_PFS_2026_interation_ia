'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const proxy   = require('express-http-proxy');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { verifyToken } = require('./shared/middleware/auth'); // Middleware de vérification JWT partagé
const axios = require('axios');
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:3500';


const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.GATEWAY_PORT || 3000;

// ─── Sécurité des headers HTTP ─────────────────────────────────────────────
app.use(helmet());

// ─── CORS restrictif ───────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origine CORS non autorisée : ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '10kb' }));

// ─── Rate Limiting global ──────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
}));

// ─── Routes publiques ──────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'up', service: 'api-gateway', timestamp: new Date().toISOString() })
);

// Auth : pas de token requis (login / register / reset)
app.use('/api/auth', proxy(process.env.AUTH_SERVICE_URL || 'http://erp-auth:3001', {
  timeout: 5000,
  proxyErrorHandler: (_err, res) =>
    res.status(503).json({ success: false, error: 'Service Auth indisponible.' }),
}));

// ─── Protection globale : JWT requis pour tout /api/* ─────────────────────
app.use('/api', verifyToken);

// Décorateur commun : transmet le contexte utilisateur aux microservices via header signé
const addUserContext = (proxyReqOpts, srcReq) => {
  if (srcReq.user) {
    proxyReqOpts.headers['X-User-Context'] = JSON.stringify(srcReq.user);
    // Supprime le JWT en clair pour éviter de le retransmettre en interne
    delete proxyReqOpts.headers['authorization'];
  }
  return proxyReqOpts;
};

const proxyOptions = (url) => ({
  timeout: 5000,
  proxyReqOptDecorator: addUserContext,
  proxyErrorHandler: (err, res) => {
    console.error(`[Gateway Proxy Error] → ${url}:`, err.message);
    res.status(503).json({ success: false, error: 'Service momentanément indisponible.' });
  },
});

// ─── Table de routage complète ─────────────────────────────────────────────
const services = {
  // IT
  '/api/it/helpdesk':      process.env.IT_HELPDESK_URL      || 'http://erp-it-helpdesk:3101',
  '/api/it/user-accounts': process.env.IT_ACCOUNTS_URL      || 'http://erp-it-accounts:3102',
  '/api/it/equipment':     process.env.IT_EQUIPMENT_URL     || 'http://erp-it-equipment:3103',
  '/api/it/monitoring':    process.env.IT_MONITORING_URL    || 'http://erp-it-monitoring:3104',
  '/api/it/licenses':      process.env.IT_LICENSES_URL      || 'http://erp-it-licenses:3105',

  // HR
  '/api/hr/employees':     process.env.HR_EMPLOYEES_URL     || 'http://erp-hr-employees:3201',
  '/api/hr/leave':         process.env.HR_LEAVE_URL         || 'http://erp-hr-leave:3202',
  '/api/hr/recruitment':   process.env.HR_RECRUITMENT_URL   || 'http://erp-hr-recruitment:3203',
  '/api/hr/payroll':       process.env.HR_PAYROLL_URL       || 'http://erp-hr-payroll:3204',
  '/api/hr/performance':   process.env.HR_PERFORMANCE_URL   || 'http://erp-hr-performance:3205',

  // Finance
  '/api/finance/budget':   process.env.FINANCE_BUDGET_URL   || 'http://erp-finance-budget:3301',
  '/api/finance/reports':  process.env.FINANCE_REPORTS_URL  || 'http://erp-finance-reports:3302',
  '/api/finance/payments': process.env.FINANCE_PAYMENTS_URL || 'http://erp-finance-payments:3303',
  '/api/finance/expenses': process.env.FINANCE_EXPENSES_URL || 'http://erp-finance-expenses:3304',
  '/api/finance/invoices': process.env.FINANCE_INVOICES_URL || 'http://erp-finance-invoices:3305',

  // Operations
  '/api/ops/tasks':        process.env.OPS_TASKS_URL        || 'http://erp-ops-tasks:3401',
  '/api/ops/workflows':    process.env.OPS_WORKFLOWS_URL    || 'http://erp-ops-workflows:3402',
  '/api/ops/suppliers':    process.env.OPS_SUPPLIERS_URL    || 'http://erp-ops-suppliers:3403',
  '/api/ops/projects':     process.env.OPS_PROJECTS_URL     || 'http://erp-ops-projects:3404',
  '/api/ops/inventory':    process.env.OPS_INVENTORY_URL    || 'http://erp-ops-inventory:3405',
};

// ============================================================================
// CHATBOT AI - Routes
// ============================================================================

// POST /api/chatbot/chat - Envoyer une question au chatbot
app.post('/api/chatbot/chat', async (req, res) => {
  try {
    const response = await axios.post(`${CHATBOT_SERVICE_URL}/chat`, req.body, {
      headers: { 
        Authorization: req.headers.authorization,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 secondes timeout
    });
    res.json(response.data);
  } catch (error) {
    console.error('Chatbot chat error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Chatbot request failed',
      message: error.response?.data?.message || error.message
    });
  }
});

// POST /api/chatbot/reset - Réinitialiser contexte conversation
app.post('/api/chatbot/reset', async (req, res) => {
  try {
    const response = await axios.post(`${CHATBOT_SERVICE_URL}/reset`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('Chatbot reset error:', error.message);
    res.status(500).json({ 
      error: 'Reset failed',
      message: error.message 
    });
  }
});

// GET /api/chatbot/health - Vérifier santé du service chatbot
app.get('/api/chatbot/health', async (req, res) => {
  try {
    const response = await axios.get(`${CHATBOT_SERVICE_URL}/health`);
    res.json(response.data);
  } catch (error) {
    console.error('Chatbot health check failed:', error.message);
    res.status(503).json({ 
      status: 'unhealthy',
      service: 'chatbot',
      error: error.message
    });
  }
});

// Enregistre tous les proxies dynamiquement
Object.entries(services).forEach(([path, url]) => {
  app.use(path, proxy(url, proxyOptions(url)));
  console.log(`  ✅ ${path} → ${url}`);
});

// ─── 404 pour les routes inconnues ────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route introuvable.' }));

// ─── Gestionnaire d'erreurs global ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Gateway Error]', err);
  res.status(500).json({ success: false, message: 'Erreur interne de la gateway.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 API Gateway démarrée sur le port ${PORT}`);
  console.log(`   Routes enregistrées : ${Object.keys(services).length} services\n`);
});
