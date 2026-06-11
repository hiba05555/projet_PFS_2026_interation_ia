'use strict';
const { Pool } = require('pg');

/**
 * Pool PostgreSQL partagé — chargé depuis les variables d'environnement UNIQUEMENT.
 * Aucun fallback de mot de passe en dur.
 */
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'erp_database',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,          // ← pas de fallback en dur
  max:      20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Erreur client inattendue :', err.message);
});

module.exports = pool;
