const axios = require('axios');
const { FUNCTION_MAP } = require('./functions');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL_NAME = process.env.OLLAMA_MODEL || 'erp-dataprotect';

const HEADERS = {
  'Content-Type': 'application/json'
};

// Documentation des paramètres attendus par chaque fonction, alignée sur les schémas
// zod réels des microservices (voir services/*/server.js). FUNCTION_MAP (functions.js)
// reste la source de vérité pour les noms de fonctions disponibles ; ce dictionnaire ne
// fait qu'enrichir chaque nom avec la description de ses paramètres pour le prompt.
const FUNCTION_PARAM_DOCS = {
  create_ticket: '{ "title": string (5-200 caractères), "description": string (10-2000 caractères), "priority": "low"|"medium"|"high"|"critical" (défaut "medium"), "category": "hardware"|"software"|"network"|"access"|"email"|"general" (défaut "general") }',
  get_tickets: '{} (aucun paramètre requis)',
  get_ticket: '{ "id": string (UUID du ticket) }',
  submit_leave_request: '{ "leave_type": "annual"|"sick"|"maternity"|"paternity"|"unpaid"|"other", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "reason": string (optionnel) } (employee_id est résolu automatiquement par le serveur, ne jamais le demander ni l\'inventer)',
  get_leave_requests: '{} (aucun paramètre requis)',
  submit_expense: '{ "title": string, "description": string (optionnel), "amount": number, "currency": string 3 lettres (défaut "MAD"), "category": "travel"|"office"|"software"|"hardware"|"training"|"other", "expense_date": "YYYY-MM-DD", "budget_id": string (UUID, optionnel) }',
  get_expenses: '{} (aucun paramètre requis)',
  get_budget_status: '{ "id": string (UUID du budget) }',
  get_budgets: '{} (aucun paramètre requis ; filtres optionnels : "category", "fiscal_year", "currency")',
  get_invoices: '{} (aucun paramètre requis ; filtres optionnels : "status", "client_name")',
  create_task: '{ "title": string, "description": string (optionnel), "priority": "low"|"medium"|"high"|"urgent" (défaut "medium"), "due_date": "YYYY-MM-DD" (optionnel), "project_id": string (UUID, optionnel) }',
  get_tasks: '{} (aucun paramètre requis)',
  get_project_progress: '{ "id": string (UUID du projet) }',
  get_projects: '{} (aucun paramètre requis ; filtres optionnels : "status", "priority")',
  get_employees: '{} (aucun paramètre requis ; filtres optionnels : "department", "status", "employment_type", "search")'
};

const FUNCTION_LIST_BLOCK = Object.keys(FUNCTION_MAP)
  .map(name => `- ${name}${FUNCTION_PARAM_DOCS[name] ? ` : paramètres attendus ${FUNCTION_PARAM_DOCS[name]}` : ''}`)
  .join('\n');

// Instructions de function calling injectées à chaque appel, car le SYSTEM du Modelfile
// n'est jamais rendu par Ollama (TEMPLATE = """{{ .Prompt }}""", qui ignore {{ .System }}).
const FUNCTION_CALLING_INSTRUCTIONS = `Tu es l'assistant IA de l'ERP DataProtect.
Si l'utilisateur demande explicitement d'effectuer une action métier (créer un ticket, poser un congé, soumettre une note de frais, créer une tâche, etc.), tu dois répondre UNIQUEMENT avec un appel de fonction, encadré exactement par un bloc \`\`\`json comme ceci :
\`\`\`json
{"function": "nom_de_la_fonction", "parameters": {...}}
\`\`\`
N'ajoute aucun texte avant ou après ce bloc dans ce cas.
Si la demande de l'utilisateur n'est pas une action mais une simple question ou une demande d'information, réponds normalement en langage naturel, sans bloc \`\`\`json.

Fonctions disponibles :
${FUNCTION_LIST_BLOCK}

Exemples :
Question: Crée-moi un ticket pour un problème réseau
Réponse:
\`\`\`json
{"function": "create_ticket", "parameters": {"title": "Problème réseau", "description": "L'utilisateur signale un problème de connexion réseau", "priority": "medium", "category": "network"}}
\`\`\`

Question: Je veux poser un congé du 10 au 15 août pour des vacances
Réponse:
\`\`\`json
{"function": "submit_leave_request", "parameters": {"leave_type": "annual", "start_date": "2026-08-10", "end_date": "2026-08-15", "reason": "vacances"}}
\`\`\`

Question: Soumets une note de frais de 50 euros pour le transport
Réponse:
\`\`\`json
{"function": "submit_expense", "parameters": {"title": "Frais de transport", "amount": 50, "currency": "EUR", "category": "travel", "expense_date": "2026-08-10"}}
\`\`\`
Attention : "category" doit toujours être une des valeurs autorisées ("travel", "office", "software", "hardware", "training", "other"), jamais un mot recopié tel quel depuis la question de l'utilisateur (ici "transport" devient "travel").

Question: Liste les employés du département RH
Réponse:
\`\`\`json
{"function": "get_employees", "parameters": {"department": "HR"}}
\`\`\`
Attention : les appels de consultation (fonctions commençant par "get_") suivent exactement le même format que les appels de création ci-dessus — n'ajoute des "parameters" que pour les filtres explicitement mentionnés par l'utilisateur, sinon utilise {}.

Ne confonds jamais consultation et création, même si les deux portent sur la même entité — compare :
Question: Liste les employés du département RH → verbe "liste" = CONSULTATION → {"function": "get_employees", "parameters": {"department": "HR"}}
Question: Crée un ticket réseau pour le département IT → verbe "crée" = CRÉATION → {"function": "create_ticket", "parameters": {"title": "Ticket réseau", "description": "...", "priority": "medium", "category": "network"}}
Une question de consultation ("liste", "montre", "affiche", "combien", "quels") n'appelle JAMAIS une fonction "create_*" ou "submit_*". Une question de création ("crée", "ajoute", "soumets", "pose") n'appelle JAMAIS une fonction "get_*".

Question: Quels sont les horaires du support IT ?
Réponse: Le support IT est disponible du lundi au vendredi de 8h à 18h.`;

// Instructions courtes utilisées à la place du bloc function-calling (~1000+ tokens) pour
// les messages de pure politesse/small-talk, qui ne peuvent déclencher aucune action métier.
// Économise l'essentiel du budget de contexte (num_ctx) sur ces échanges.
const SMALL_TALK_INSTRUCTIONS = `Tu es l'assistant IA de l'ERP DataProtect. Réponds normalement en
langage naturel, de façon brève et amicale, sans jamais générer de bloc \`\`\`json.`;

// Liste fermée (deny-list) plutôt que liste ouverte de mots-clés d'action : un faux négatif ici
// (small-talk mal détecté) dégrade juste le message d'accueil, alors qu'une liste d'action
// incomplète risquerait de faire passer une vraie demande métier (ex. "je veux poser un congé")
// à côté des instructions function-calling. On ne retire les instructions que quand on est sûr.
const SMALL_TALK_PATTERN = /^(bonjour|salut|bonsoir|bonne\s?nuit|coucou|hello|hi|hey|merci|merci\s?beaucoup|au\s?revoir|bye|ça\s?va\s?\??|comment\s?(ça\s?va|vas-tu|allez-vous)\s?\??|ok|okay|d'accord|d\s?accord)[\s!.,?]*$/i;

function isSmallTalk(query) {
  return typeof query === 'string' && SMALL_TALK_PATTERN.test(query.trim());
}

async function chat(prompt, options = {}) {
  try {
    const startTime = Date.now();

    const smallTalk = isSmallTalk(options.rawQuery);
    const instructions = smallTalk ? SMALL_TALK_INSTRUCTIONS : FUNCTION_CALLING_INSTRUCTIONS;

    // Rappel collé juste avant "### Response:" : le fine-tuning QLoRA est très léger (120 steps,
    // r=16) et l'historique de conversation intercalé entre les instructions et la question dilue
    // leur poids — observé en pratique : le modèle bascule parfois en prose/refus au lieu du bloc
    // ```json pour une demande d'action pourtant explicite. Répéter la consigne au plus près du
    // point de génération augmente nettement l'adhérence au format (technique dite "sandwiching").
    const reminder = smallTalk
      ? ''
      : "\n\n(Rappel : si la question ci-dessus est une demande d'action métier explicite, réponds UNIQUEMENT par le bloc ```json défini plus haut, sans aucun texte autour. Sinon, réponds normalement en langage naturel.)";

    // Format Alpaca pour le modèle fine-tuné (cohérent avec le dataset d'entraînement).
    // Le Modelfile passe le prompt tel quel (TEMPLATE """{{ .Prompt }}"""),
    // donc le formatage complet (y compris les instructions de function calling,
    // le SYSTEM du Modelfile n'étant jamais rendu) se fait ici, une seule fois.
    const formattedPrompt = `### Instruction:
${instructions}

${prompt}${reminder}

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
          // 0.7 laissait trop de liberté au modèle pour une tâche à sortie structurée
          // (bloc ```json) : fine-tuning léger (120 steps QLoRA) => adhérence fragile au
          // format dès que le prompt s'écarte des exemples vus à l'entraînement (ex. avec
          // historique de conversation). 0.2 privilégie la reproduction fidèle du pattern
          // appris plutôt que la créativité, ce qui est ce qu'on veut ici dans les deux cas
          // (function-calling précis ET réponses factuelles sur l'ERP).
          temperature: options.temperature || 0.2,
          top_p: options.top_p || 0.9,
          repeat_penalty: options.repeat_penalty || 1.1,
          num_predict: options.max_tokens || 300,
          // Passé explicitement par requête car Ollama ignore le num_ctx du Modelfile pour
          // /api/generate si non fourni ici. 2048 (valeur précédente) laissait trop peu de
          // place pour la réponse une fois RAG + instructions function-calling injectés
          // (jusqu'à ~1800 tokens de prompt observés), provoquant des générations tronquées.
          num_ctx: options.num_ctx || 4096
        }
      },
      {
        // La taille du prompt varie fortement (docs RAG + bloc function-calling + query),
        // jusqu'à approcher num_ctx=2048 (voir Modelfile). Mesuré en pratique sur ce CPU :
        // ~84ms/token en lecture de prompt + ~250ms/token en génération (num_predict=300)
        // → pire cas ≈ 2048*0.084 + 300*0.25 ≈ 247s. 180000ms était encore insuffisant et
        // coupait des requêtes dont le prompt RAG était simplement plus long que la moyenne.
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