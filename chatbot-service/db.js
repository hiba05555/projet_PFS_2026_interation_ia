const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'erp-postgres',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'erp_database',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function getOrCreateConversation(userId, conversationId) {
  try {
    const existing = await pool.query(
      'SELECT id FROM chat_conversations WHERE user_id = $1 AND id::text = $2',
      [userId, String(conversationId)]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;
    const result = await pool.query(
      'INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING id',
      [userId, 'Nouvelle conversation']
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('DB getOrCreate error:', error.message);
    return null;
  }
}

async function saveMessage(convId, role, content) {
  try {
    await pool.query(
      'INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [convId, role, content]
    );
  } catch (error) {
    console.error('DB saveMessage error:', error.message);
  }
}

async function getUserConversations(userId) {
  try {
    const result = await pool.query(
      'SELECT id, title, created_at FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    return result.rows;
  } catch (error) {
    return [];
  }
}

async function getConversationMessages(convId) {
  try {
    const result = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convId]
    );
    return result.rows;
  } catch (error) {
    return [];
  }
}

module.exports = {
  getOrCreateConversation,
  saveMessage,
  getUserConversations,
  getConversationMessages
};