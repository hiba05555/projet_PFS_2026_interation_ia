/**
 * CONTEXT MANAGER - Redis
 * ========================
 * 
 * Gère l'historique conversationnel dans Redis
 */

const redis = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const MAX_HISTORY_LENGTH = 10;

let client = null;

async function initialize() {
  try {
    client = redis.createClient({ url: REDIS_URL });
    
    client.on('error', (err) => {
      console.error('Redis error:', err);
    });
    
    await client.connect();
    console.log(`✅ Context Manager connected to Redis: ${REDIS_URL}`);
    
  } catch (error) {
    console.error(`Failed to connect to Redis: ${error.message}`);
    throw error;
  }
}

async function getContext(conversationId) {
  try {
    if (!client || !client.isOpen) {
      await initialize();
    }
    
    const key = `chat:context:${conversationId}`;
    const history = await client.lRange(key, 0, MAX_HISTORY_LENGTH - 1);
    
    return history.map(msg => JSON.parse(msg));
    
  } catch (error) {
    console.error(`Failed to get context: ${error.message}`);
    return [];
  }
}

async function saveMessage(conversationId, role, content) {
  try {
    if (!client || !client.isOpen) {
      await initialize();
    }
    
    const key = `chat:context:${conversationId}`;
    const message = JSON.stringify({
      role: role,
      content: content,
      timestamp: new Date().toISOString()
    });
    
    await client.lPush(key, message);
    await client.lTrim(key, 0, MAX_HISTORY_LENGTH - 1);
    await client.expire(key, 7 * 24 * 60 * 60); // 7 jours TTL
    
  } catch (error) {
    console.error(`Failed to save message: ${error.message}`);
  }
}

async function resetContext(conversationId) {
  try {
    if (!client || !client.isOpen) {
      await initialize();
    }
    
    const key = `chat:context:${conversationId}`;
    await client.del(key);
    
  } catch (error) {
    console.error(`Failed to reset context: ${error.message}`);
  }
}

initialize().catch(console.error);

module.exports = { getContext, saveMessage, resetContext };
