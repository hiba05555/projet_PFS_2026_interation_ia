/**
 * SERVICE CHATBOT - Serveur Express
 * ===================================
 * 
 * Service intelligent qui combine:
 * - RAG (Retrieval-Augmented Generation) avec ChromaDB
 * - LLM fine-tuné (Mistral 7B) via Ollama
 * - Function calling vers microservices ERP
 * - Gestion contexte conversationnel via Redis
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const client = require('prom-client');
require('dotenv').config();

const ragClient = require('./rag');
const ollamaClient = require('./ollama');
const dbClient = require('./db');
const contextManager = require('./context');
const functionHandler = require('./functions');

// Extrait l'identité utilisateur depuis le header de confiance posé par le gateway
// (plutôt que de faire confiance à userId envoyé dans le body par le client)
function getUserContext(req) {
  const raw = req.headers['x-user-context'];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.error(`Invalid X-User-Context header: ${err.message}`);
    return null;
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.CHATBOT_PORT || 3500;
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:3000';

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// ============================================================================
// APPLICATION EXPRESS
// ============================================================================

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Métriques Prometheus (endpoint non protégé — scrape sans authentification) ──
const metricsRegister = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegister });
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'chatbot',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============================================================================
// REFORMULATION TEMPLATÉE (sans appel LLM)
// ============================================================================
// Remplace le second appel ollamaClient.chat() qui reformulait le résultat d'une
// function call : sur ce CPU, une inférence supplémentaire coûte ~65-80s et fait
// systématiquement dépasser le timeout de 120s pour un round-trip qui en comporterait
// déjà un premier. Le microservice appelé renvoie déjà un message français utilisable
// (ex. "Ticket créé.") ; on l'enrichit avec les champs clés propres à chaque fonction.
function formatFunctionResultMessage(functionName, functionResult) {
  if (!functionResult || !functionResult.success) {
    return `Je n'ai pas pu effectuer cette action : ${functionResult?.error || 'erreur inconnue'}.`;
  }

  const body = functionResult.data || {};
  const entity = body.data;
  const backendMessage = body.message || 'Action effectuée avec succès.';

  switch (functionName) {
    case 'create_ticket':
      return entity?.ticket_number
        ? `${backendMessage} Numéro de ticket : ${entity.ticket_number} (priorité : ${entity.priority}).`
        : backendMessage;

    case 'submit_leave_request':
      return entity?.start_date
        ? `${backendMessage} Du ${entity.start_date} au ${entity.end_date} (${entity.total_days} jour(s)), statut : ${entity.status}.`
        : backendMessage;

    case 'submit_expense':
      return entity?.amount !== undefined
        ? `${backendMessage} Montant : ${entity.amount} ${entity.currency}, statut : ${entity.status}.`
        : backendMessage;

    case 'create_task':
      return entity?.title
        ? `${backendMessage} Priorité : ${entity.priority}, statut : ${entity.status}.`
        : backendMessage;

    case 'get_tickets':
    case 'get_leave_requests':
    case 'get_expenses':
    case 'get_tasks': {
      const list = Array.isArray(entity) ? entity : (Array.isArray(body.data) ? body.data : []);
      return `${list.length} résultat(s) trouvé(s).`;
    }

    default:
      return backendMessage;
  }
}

// Extrait un appel de fonction valide d'une réponse LLM brute, ou null. Séparé du reste du
// flux Step 5 pour être réutilisable sur la tentative de retry (voir Step 5 ci-dessous).
function extractFunctionCall(text) {
  const match = text.match(/```json\s*([\s\S]*?)(?:```|$)/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.function === 'string' && functionHandler.FUNCTION_MAP[parsed.function]) {
      return parsed;
    }
    logger.info('Function call block ignored: unknown or malformed function name');
  } catch (error) {
    logger.info(`Function call block ignored: invalid JSON (${error.message})`);
  }
  return null;
}

// Heuristique volontairement large (pas un filtre strict) : ne sert qu'à décider si on retente
// un appel LLM "à froid" (sans historique) quand la première tentative n'a produit aucun bloc
// function-calling valide. Un faux positif ne coûte qu'un appel LLM de plus (~30-240s) ;
// un faux négatif se contente de l'échec déjà observé sans aggraver la situation.
const ACTION_INTENT_PATTERN = /\b(cr[ée]e[rz]?|ajoute[rz]?|soumet(?:s|tre)|pose[rz]?|demande[rz]?|liste[rz]?|montre[rz]?|affiche[rz]?|consulte[rz]?|supprime[rz]?|annule[rz]?|combien|quels?|quelles?)\b.{0,40}\b(ticket|congés?|conges?|notes? de frais|dépenses?|depenses?|tâches?|taches?|projets?|budgets?|employés?|employ[ée]s?|factures?|paiements?|équipements?|equipements?|licences?|fournisseurs?|inventaire|candidats?|paie|évaluations?|evaluations?)\b|\b(ticket|congés?|conges?|notes? de frais|dépenses?|depenses?|tâches?|taches?|employés?|employ[ée]s?|factures?|paiements?)\b.{0,40}\b(cr[ée]e[rz]?|ajoute[rz]?|soumet(?:s|tre)|pose[rz]?|demande[rz]?)\b/i;

function looksLikeActionRequest(query) {
  return typeof query === 'string' && ACTION_INTENT_PATTERN.test(query);
}

// Verbes de consultation/création isolés de ACTION_INTENT_PATTERN (qui mélange les deux) :
// sert à détecter un conflit entre le verbe de la question et la fonction choisie par le
// LLM — ex. "Liste les employés" (verbe de consultation) qui déclenche create_ticket
// (fonction de création) : le JSON est valide et une fonction connue, donc
// extractFunctionCall() ne peut pas voir le problème seul. On ne déclenche la vérification
// que si le verbe de la question est sans ambiguïté d'un seul type (consultation XOR
// création) pour éviter de rejeter à tort une requête où les deux se mélangent légitimement.
const CREATION_VERB_PATTERN = /\b(cr[ée]e[rz]?|ajoute[rz]?|soumet(?:s|tre)|pose[rz]?)\b/i;
const CONSULTATION_VERB_PATTERN = /\b(liste[rz]?|montre[rz]?|affiche[rz]?|consulte[rz]?|combien|quels?|quelles?)\b/i;

function isFunctionCoherentWithQuery(functionCall, query) {
  if (!functionCall || typeof query !== 'string') return true;
  const isConsultationFunction = functionCall.function.startsWith('get_');
  const isCreationFunction = functionCall.function.startsWith('create_') || functionCall.function.startsWith('submit_');

  const queryLooksConsultation = CONSULTATION_VERB_PATTERN.test(query) && !CREATION_VERB_PATTERN.test(query);
  if (queryLooksConsultation && isCreationFunction) return false;

  const queryLooksCreation = CREATION_VERB_PATTERN.test(query) && !CONSULTATION_VERB_PATTERN.test(query);
  if (queryLooksCreation && isConsultationFunction) return false;

  return true;
}

// Tier 3 — filet de secours déterministe (pas de LLM impliqué), utilisé seulement si le retry
// LLM sans historique a lui aussi échoué. Observé en pratique : sur ce fine-tuning léger, le
// modèle "connaît" parfois une fonction (il la cite en prose) sans jamais émettre le bloc json
// pour des reformulations qui s'écartent du few-shot exact. Volontairement limité aux fonctions
// get_* SANS paramètre requis : aucun risque d'halluciner un contenu (titre, montant...) que
// seul le LLM peut extraire — à l'inverse des create_*/submit_*, qu'on laisse échouer plutôt que
// de deviner leurs paramètres. Exclut aussi les requêtes qui ressemblent à une création (ex.
// "crée un ticket" ne doit jamais retomber sur get_tickets si le parsing du LLM échoue) via
// CREATION_VERB_PATTERN, déjà défini plus haut.
const CONSULTATION_ENTITY_MAP = [
  { pattern: /\bemploy[ée]s?\b/i, function: 'get_employees' },
  { pattern: /\btickets?\b/i, function: 'get_tickets' },
  { pattern: /\bcong[ée]s?\b/i, function: 'get_leave_requests' },
  { pattern: /\b(notes? de frais|d[ée]penses?)\b/i, function: 'get_expenses' },
  { pattern: /\bt[âa]ches?\b/i, function: 'get_tasks' },
  { pattern: /\bfactures?\b/i, function: 'get_invoices' },
  { pattern: /\bbudgets?\b/i, function: 'get_budgets' },
  { pattern: /\bprojets?\b/i, function: 'get_projects' },
];

function detectConsultationFallback(query) {
  if (typeof query !== 'string' || CREATION_VERB_PATTERN.test(query)) return null;
  const match = CONSULTATION_ENTITY_MAP.find(({ pattern }) => pattern.test(query));
  return match ? { function: match.function, parameters: {} } : null;
}

// ============================================================================
// ENDPOINT PRINCIPAL: CHAT
// ============================================================================

app.post('/chat', async (req, res) => {
  try {
    const userContext = getUserContext(req);
    const { query, conversationId, userToken } = req.body;
    const userId = userContext?.id;
    // Validation
    if (!query || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: query, or unauthenticated request'
      });
    } 

    logger.info(`Chat request from user ${userId}: "${query}"`);
    const requestStart = Date.now();

    // ========== ÉTAPE 1: RECHERCHE RAG ==========
    logger.info('Step 1: RAG search...');
    let stepStart = Date.now();
    const relevantDocs = await ragClient.searchRelevantDocs(query, 3);
    logger.info(`Found ${relevantDocs.length} relevant documents (RAG: ${Date.now() - stepStart}ms)`);

    // ========== ÉTAPE 2: RÉCUPÉRATION CONTEXTE ==========
    logger.info('Step 2: Fetching conversation context...');
    stepStart = Date.now();
    const conversationHistory = await contextManager.getContext(
      conversationId || userId
    );
    logger.info(`Context: ${conversationHistory.length} previous messages (contexte: ${Date.now() - stepStart}ms)`);

    // ========== ÉTAPE 3: CONSTRUCTION DU CONTEXTE COMPLET ==========
    logger.info('Step 3: Building full context...');
    stepStart = Date.now();

    // Formater les docs RAG
    const docsContext = relevantDocs
      .map(doc => `[${doc.category}] ${doc.title}\n${doc.content}`)
      .join('\n\n---\n\n');

    // Formater l'historique
    const historyContext = conversationHistory
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Contexte final pour le LLM
    const fullContext = `${historyContext ? `Historique de la conversation:\n${historyContext}\n\n` : ''}Documentation ERP pertinente:\n${docsContext}\n\nQuestion: ${query}`;
    logger.info(`Full context built (construction contexte: ${Date.now() - stepStart}ms)`);

    // ========== ÉTAPE 4: INFÉRENCE LLM ==========
    logger.info('Step 4: LLM inference...');
    stepStart = Date.now();
    const llmResponse = await ollamaClient.chat(fullContext, { rawQuery: query });
    logger.info(`LLM response received (${llmResponse.length} chars) (inférence LLM: ${Date.now() - stepStart}ms)`);

    // ========== ÉTAPE 5: DÉTECTION FUNCTION CALLING ==========
    // Détection par marqueur explicite (```json ... ```) plutôt que par la structure JSON
    // elle-même : une regex sur les accolades s'arrête à la première `}` rencontrée (celle
    // de "parameters" imbriqué) et produit un JSON tronqué, invalide dans tous les cas réels.
    // La balise fermante est optionnelle : si la génération est tronquée par num_predict
    // avant le ``` final, on retombe sur la fin de la chaîne plutôt que d'échouer la détection.
    logger.info('Step 5: Checking for function calls...');
    stepStart = Date.now();
    let functionCall = extractFunctionCall(llmResponse);
    // Un JSON valide et une fonction connue ne suffisent pas : le modèle peut choisir la
    // mauvaise fonction (ex. "Liste les employés" → create_ticket). extractFunctionCall() ne
    // voit que la forme, pas le sens — cette vérification complète par le fond.
    if (functionCall && !isFunctionCoherentWithQuery(functionCall, query)) {
      logger.info(`Function call ${functionCall.function} inconsistent with query intent — discarding`);
      functionCall = null;
    }
    logger.info(`Function call detection done (détection function calling: ${Date.now() - stepStart}ms)`);

    // Filet de secours : un historique de conversation contenant un refus précédent du modèle
    // (prose au lieu de ```json) l'entraîne à répéter ce même refus sur les tours suivants de
    // la même conversation, même avec une consigne explicite. Si la requête ressemble fortement
    // à une action mais qu'aucun appel valide n'a été détecté, on retente une fois avec un
    // contexte "propre" (sans historique) pour casser ce biais d'ancrage.
    if (!functionCall && looksLikeActionRequest(query)) {
      logger.info('No valid function call but query looks like an action request — retrying without conversation history');
      const cleanContext = `Documentation ERP pertinente:\n${docsContext}\n\nQuestion: ${query}`;
      const retryResponse = await ollamaClient.chat(cleanContext, { rawQuery: query });
      functionCall = extractFunctionCall(retryResponse);
      if (functionCall && !isFunctionCoherentWithQuery(functionCall, query)) {
        logger.info(`Retry function call ${functionCall.function} also inconsistent with query intent — discarding`);
        functionCall = null;
      }
      logger.info(`Retry ${functionCall ? 'succeeded' : 'still had no valid/coherent function call'}`);
    }

    // Tier 3 : voir detectConsultationFallback — filet déterministe pour les consultations
    // (get_*) sans paramètre requis, quand même le retry LLM n'a rien produit de valide.
    if (!functionCall) {
      const fallback = detectConsultationFallback(query);
      if (fallback) {
        logger.info(`Deterministic consultation fallback: ${fallback.function}`);
        functionCall = fallback;
      }
    }

    let finalResponse = llmResponse;
    let functionResult = null;

    if (functionCall) {
      try {
        logger.info(`Function call detected: ${functionCall.function}`);

        // ========== ÉTAPE 6: EXÉCUTION FUNCTION CALL ==========
        logger.info('Step 6: Executing function call...');
        stepStart = Date.now();
        functionResult = await functionHandler.executeFunction(
          functionCall,
          userToken,
          API_GATEWAY_URL,
          userContext
        );
        logger.info(`Function executed successfully (exécution function call: ${Date.now() - stepStart}ms)`);

        // Reformulation templatée (pas de second appel LLM, voir formatFunctionResultMessage)
        const reformulationStart = Date.now();
        finalResponse = formatFunctionResultMessage(functionCall.function, functionResult);
        logger.info(`Reformulation done (reformulation templatée: ${Date.now() - reformulationStart}ms)`);

      } catch (error) {
        logger.error(`Function call error: ${error.message}`);
        finalResponse = `J'ai tenté d'exécuter l'action mais une erreur s'est produite: ${error.message}`;
      }
    }

    // ========== ÉTAPE 7: SAUVEGARDE CONTEXTE ==========
    logger.info('Step 7: Saving context...');
    stepStart = Date.now();

    // Redis - contexte temporaire pour le LLM
    await contextManager.saveMessage(conversationId || userId, 'user', query);
    await contextManager.saveMessage(conversationId || userId, 'assistant', finalResponse);

    // PostgreSQL - historique permanent
    try {
      const dbConvId = await dbClient.getOrCreateConversation(userId, conversationId || userId);
      if (dbConvId) {
        await dbClient.saveMessage(dbConvId, 'user', query);
        await dbClient.saveMessage(dbConvId, 'assistant', finalResponse);
      }
    } catch (dbError) {
      logger.error(`DB save error: ${dbError.message}`);
    }
    logger.info(`Context saved (sauvegarde: ${Date.now() - stepStart}ms)`);

    // ========== RÉPONSE FINALE ==========
    logger.info(`Sending response to user (durée totale: ${Date.now() - requestStart}ms)`);

    res.json({
      response: finalResponse,
      conversationId: conversationId || userId,
      timestamp: new Date().toISOString(),
      ...(functionResult && { functionExecuted: true, functionResult })
    });

  } catch (error) {
    logger.error(`Chat error: ${error.message}`);
    logger.error(error.stack);
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// ENDPOINT: RESET CONVERSATION
// ============================================================================

app.post('/reset', async (req, res) => {
  try {
    const userContext = getUserContext(req);
    const { conversationId } = req.body;
    const userId = userContext?.id;

    if (!conversationId && !userId) {
      return res.status(400).json({
        error: 'Missing conversationId or unauthenticated request'
      });
    }

    await contextManager.resetContext(conversationId || userId);
    
    logger.info(`Conversation reset for ${conversationId || userId}`);
    
    res.json({
      message: 'Conversation reset successfully',
      conversationId: conversationId || userId
    });

  } catch (error) {
    logger.error(`Reset error: ${error.message}`);
    res.status(500).json({
      error: 'Failed to reset conversation',
      message: error.message
    });
  }
});

// GET /history/:userId
app.get('/history/:userId', async (req, res) => {
  try {
    const conversations = await dbClient.getUserConversations(req.params.userId);
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ conversations: [] });
  }
});

// GET /history/:userId/:convId
app.get('/history/:userId/:convId', async (req, res) => {
  try {
    const messages = await dbClient.getConversationMessages(req.params.convId);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ messages: [] });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  logger.error(err.stack);
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ============================================================================
// DÉMARRAGE DU SERVEUR
// ============================================================================

app.listen(PORT, () => {
  logger.info('='.repeat(80));
  logger.info('🤖 CHATBOT SERVICE STARTED');
  logger.info('='.repeat(80));
  logger.info(`Port: ${PORT}`);
  logger.info(`API Gateway: ${API_GATEWAY_URL}`);
  logger.info(`Ollama: ${process.env.OLLAMA_URL || 'http://ollama:11434'}`);
  logger.info(`ChromaDB: ${process.env.CHROMADB_URL || 'http://chromadb:8000'}`);
  logger.info(`Redis: ${process.env.REDIS_URL || 'redis://redis:6379'}`);
  logger.info('='.repeat(80));
  logger.info('✅ Ready to accept chat requests!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
