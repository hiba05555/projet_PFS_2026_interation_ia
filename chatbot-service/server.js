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
require('dotenv').config();

const ragClient = require('./rag');
const ollamaClient = require('./ollama');
const dbClient = require('./db');
const contextManager = require('./context');
const functionHandler = require('./functions');

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
// ENDPOINT PRINCIPAL: CHAT
// ============================================================================

app.post('/chat', async (req, res) => {
  try {
    const { 
      query, 
      userId, 
      conversationId, 
      userToken 
    } = req.body;

    // Validation
    if (!query || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: query and userId'
      });
    }

    logger.info(`Chat request from user ${userId}: "${query}"`);

    // ========== ÉTAPE 1: RECHERCHE RAG ==========
    logger.info('Step 1: RAG search...');
    const relevantDocs = await ragClient.searchRelevantDocs(query, 3);
    logger.info(`Found ${relevantDocs.length} relevant documents`);

    // ========== ÉTAPE 2: RÉCUPÉRATION CONTEXTE ==========
    logger.info('Step 2: Fetching conversation context...');
    const conversationHistory = await contextManager.getContext(
      conversationId || userId
    );
    logger.info(`Context: ${conversationHistory.length} previous messages`);

    // ========== ÉTAPE 3: CONSTRUCTION DU CONTEXTE COMPLET ==========
    logger.info('Step 3: Building full context...');
    
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


    // ========== ÉTAPE 4: INFÉRENCE LLM ==========
    logger.info('Step 4: LLM inference...');
    const llmResponse = await ollamaClient.chat(fullContext);
    logger.info(`LLM response received (${llmResponse.length} chars)`);

    // ========== ÉTAPE 5: DÉTECTION FUNCTION CALLING ==========
    logger.info('Step 5: Checking for function calls...');
    const functionCallMatch = llmResponse.match(/\{[\s\S]*?"function"[\s\S]*?\}/);
    
    let finalResponse = llmResponse;
    let functionResult = null;

    if (functionCallMatch) {
      try {
        const functionCall = JSON.parse(functionCallMatch[0]);
        logger.info(`Function call detected: ${functionCall.function}`);

        // ========== ÉTAPE 6: EXÉCUTION FUNCTION CALL ==========
        logger.info('Step 6: Executing function call...');
        functionResult = await functionHandler.executeFunction(
          functionCall,
          userToken,
          API_GATEWAY_URL
        );
        logger.info('Function executed successfully');

        // Reformuler la réponse avec le résultat
        const reformulationPrompt = `
Résultat de l'action: ${JSON.stringify(functionResult)}

Reformule ce résultat en langage naturel pour l'utilisateur de manière concise et professionnelle.
Ne mentionne pas les détails techniques JSON.
`.trim();

        finalResponse = await ollamaClient.chat(reformulationPrompt);
        
      } catch (error) {
        logger.error(`Function call error: ${error.message}`);
        finalResponse = `J'ai tenté d'exécuter l'action mais une erreur s'est produite: ${error.message}`;
      }
    }

    // ========== ÉTAPE 7: SAUVEGARDE CONTEXTE ==========
    logger.info('Step 7: Saving context...');

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

    // ========== RÉPONSE FINALE ==========
    logger.info('Sending response to user');
    
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
    const { conversationId, userId } = req.body;
    
    if (!conversationId && !userId) {
      return res.status(400).json({
        error: 'Missing conversationId or userId'
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
