/**
 * CLIENT OLLAMA - LLM Inference
 * ==============================
 * 
 * Module d'interaction avec Ollama pour inférence
 * du modèle Mistral 7B fine-tuné
 */

const axios = require('axios');

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL_NAME = process.env.OLLAMA_MODEL || 'mistral-erp-dataprotect-q4';

/**
 * Appel au modèle LLM pour génération de texte
 * 
 * @param {string} prompt - Contexte + question
 * @param {object} options - Options d'inférence
 * @returns {Promise<string>} - Réponse générée
 */
async function chat(prompt, options = {}) {
  try {
    const startTime = Date.now();
    
    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: MODEL_NAME,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.95,
          top_k: options.top_k || 40,
          repeat_penalty: options.repeat_penalty || 1.1,
          num_predict: options.max_tokens || 512
        }
      },
      {
        timeout: 300000
      }
    );

    const duration = Date.now() - startTime;
    console.log(`Ollama inference completed in ${duration}ms`);
    
    return response.data.response.trim();

  } catch (error) {
    console.error(`Ollama error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama service not reachable');
    }
    
    throw error;
  }
}

async function listModels() {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`);
    return response.data.models || [];
  } catch (error) {
    return [];
  }
}

async function testConnection() {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    console.log(`✅ Ollama connected: ${OLLAMA_URL}`);
    return true;
  } catch (error) {
    console.error(`❌ Ollama connection failed`);
    return false;
  }
}

testConnection();

module.exports = { chat, listModels, testConnection };
