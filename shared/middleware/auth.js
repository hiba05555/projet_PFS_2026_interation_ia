'use strict';
const jwt = require('jsonwebtoken');

/**
 * SÉCURITÉ : Secret JWT chargé depuis les variables d'environnement UNIQUEMENT.
 * Le serveur s'arrête en production si le secret est absent.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET manquant en production.');
    process.exit(1);
  } else {
    console.warn('⚠️  JWT_SECRET absent — fallback dev uniquement (jamais en production !)');
  }
}
const _SECRET = JWT_SECRET || 'dev_secret_only_never_in_prod';

// ─── Utilitaires internes ──────────────────────────────────────────────────

/** Wrapper async pour éviter les try/catch répétitifs dans les routes */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Gestionnaire d'erreur global — masque les détails techniques au client */
const errorHandler = (err, req, res, _next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  const status = err.status || 500;
  return res.status(status).json({
    success: false,
    message: status === 500 ? 'Une erreur interne est survenue.' : err.message,
    ...(isDev && status === 500 ? { debug: err.message } : {}),
  });
};

// ─── Middlewares d'authentification ───────────────────────────────────────

/**
 * VERIFY TOKEN : Authentification — vérifie la validité du JWT.
 * Accepte deux modes :
 *   1. X-User-Context header (injecté par l'API Gateway après vérification JWT)
 *   2. Authorization: Bearer <token> (accès direct, dev / tests)
 */
const verifyToken = (req, res, next) => {
  // Mode 1 : contexte utilisateur transmis par la gateway (header interne de confiance)
  const userContext = req.headers['x-user-context'];
  if (userContext) {
    try {
      req.user = JSON.parse(userContext);
      return next();
    } catch {
      return res.status(401).json({ success: false, message: 'Contexte utilisateur invalide.' });
    }
  }

  // Mode 2 : JWT direct (accès sans passer par la gateway)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Accès refusé. Aucun jeton fourni.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, _SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      department: decoded.department,
      email: decoded.email,
    };
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Session expirée. Reconnectez-vous.' : 'Jeton invalide.';
    return res.status(401).json({ success: false, message });
  }
};

// ─── Middlewares d'autorisation ────────────────────────────────────────────

/** Autorise uniquement les rôles listés. */
const requireRole = (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Accès refusé. Rôle requis : ${roles.join(' ou ')}.`,
      });
    }
    next();
  };

/** Autorise les départements listés + les admins (passe-partout). */
const requireDepartment = (...depts) =>
  (req, res, next) => {
    if (!req.user) return res.status(403).json({ success: false, message: 'Accès refusé.' });
    if (req.user.role === 'admin' || depts.includes(req.user.department)) return next();
    return res.status(403).json({
      success: false,
      message: `Accès restreint aux départements : ${depts.join(', ')}.`,
    });
  };

/** Combinaison département + rôle admin en un seul middleware. */
const requireDeptOrAdmin = (...depts) => requireDepartment(...depts);

/** Pagination helper — extrait page/limit depuis query params avec des défauts sûrs. */
const getPagination = (query) => {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

module.exports = {
  verifyToken,
  requireRole,
  requireDepartment,
  requireDeptOrAdmin,
  asyncHandler,
  errorHandler,
  getPagination,
};
