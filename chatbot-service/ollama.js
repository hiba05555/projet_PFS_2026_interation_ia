const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL_NAME = process.env.OLLAMA_MODEL || 'erp-dataprotect';

const HEADERS = {
  'Content-Type': 'application/json'
};

async function chat(prompt, options = {}) {
  try {
    const startTime = Date.now();

    // Format Alpaca pour le modèle fine-tuné (cohérent avec le dataset d'entraînement).
    // Le Modelfile passe le prompt tel quel (TEMPLATE """{{ .Prompt }}"""),
    // donc le formatage complet se fait ici, une seule fois.
    const formattedPrompt = `### Instruction:
${prompt}

### Input:


### Response:
`;

    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: MODEL_NAME,
        prompt: formattedPrompt,
        stream: false,
        stop: ["### Instruction:", "### Input:", "\n\n\n"],
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          repeat_penalty: options.repeat_penalty || 1.1,
          num_predict: options.max_tokens || 150
        }
      },
      {
        timeout: 300000,
        headers: HEADERS
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
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      headers: HEADERS
    });
    return response.data.models || [];
  } catch (error) {
    return [];
  }
}

async function testConnection() {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 300000,
      headers: HEADERS
    });
    console.log(`✅ Ollama connected: ${OLLAMA_URL}`);
    return true;
  } catch (error) {
    console.error(`❌ Ollama connection failed`);
    return false;
  }
}

testConnection();

module.exports = { chat, listModels, testConnection };