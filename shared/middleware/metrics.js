'use strict';
const client = require('prom-client');

/**
 * Registre Prometheus dédié par processus (pas le registre global de prom-client)
 * pour éviter les doublons de métriques si le module est require() plusieurs fois.
 */
const register = new client.Registry();
client.collectDefaultMetrics({ register });

/** Handler GET /metrics — à monter SANS middleware d'authentification (scrape Prometheus). */
const metricsHandler = async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
};

module.exports = { register, metricsHandler };
