/**
 * FUNCTION CALLING HANDLER
 * =========================
 * 
 * ExÃ©cute les function calls dÃ©tectÃ©s dans les rÃ©ponses LLM
 * et appelle les microservices ERP appropriÃ©s
 */

const axios = require('axios');

/**
 * Mapping des functions vers les endpoints API
 */
const FUNCTION_MAP = {
  // IT Functions
  // NB: le service IT helpdesk est monté à la racine de /api/it/helpdesk (routes
  // /, /my-tickets, /:id) — il n'y a PAS de segment /tickets.
  'create_ticket': { method: 'POST', path: '/api/it/helpdesk' },
  'get_tickets': { method: 'GET', path: '/api/it/helpdesk/my-tickets' },
  'get_ticket': { method: 'GET', path: '/api/it/helpdesk/:id' },

  // HR Functions
  // get_leave_balance retiré : aucun endpoint /api/hr/leave/balance n'existe
  // dans les microservices (voir services/hr/leave-requests/server.js).
  'submit_leave_request': { method: 'POST', path: '/api/hr/leave' },
  // GET /api/hr/leave (racine) exige le rôle HR/admin ; /my-requests est la
  // route destinée à l'utilisateur courant.
  'get_leave_requests': { method: 'GET', path: '/api/hr/leave/my-requests' },
  
  // Finance Functions
  'submit_expense': { method: 'POST', path: '/api/finance/expenses' },
  'get_expenses': { method: 'GET', path: '/api/finance/expenses' },
  'get_budget_status': { method: 'GET', path: '/api/finance/budget/:id/status' },
  // get_budgets liste les budgets (nécessaire pour obtenir un :id à passer à get_budget_status,
  // qui sans ça ne peut jamais être appelé par un utilisateur ne connaissant pas déjà l'UUID).
  'get_budgets': { method: 'GET', path: '/api/finance/budget' },
  'get_invoices': { method: 'GET', path: '/api/finance/invoices' },

  // Operations Functions
  'create_task': { method: 'POST', path: '/api/ops/tasks' },
  'get_tasks': { method: 'GET', path: '/api/ops/tasks' },
  'get_project_progress': { method: 'GET', path: '/api/ops/projects/:id/progress' },
  // Même raison que get_budgets : donne accès à la liste des :id de projets.
  'get_projects': { method: 'GET', path: '/api/ops/projects' },

  // HR Functions (suite) — get_employees manquait entièrement : aucune fonction ne permettait
  // de lister/consulter les employés, alors que GET /api/hr/employees existe et est
  // self-service (RBAC scopé côté serveur : admin/RH voient tout, manager voit son
  // département, employé voit sa propre fiche — donc sûr à exposer à tout utilisateur).
  'get_employees': { method: 'GET', path: '/api/hr/employees' }
};

// Fonctions dont le backend exige un identifiant que le LLM ne peut pas connaître
// (employee_id != user_id du JWT, voir hr_schema.employees vs auth_schema.users) :
// on le résout nous-mêmes plutôt que de faire confiance à ce que le modèle invente.
const FUNCTIONS_REQUIRING_EMPLOYEE_ID = new Set(['submit_leave_request']);

/**
 * Résout l'employee_id (hr_schema.employees) de l'utilisateur authentifié à partir
 * de son email, via l'API self-service /api/hr/employees (chaque rôle y voit au
 * moins sa propre fiche, cf. services/hr/employees/server.js).
 */
async function resolveEmployeeId(userEmail, userToken, apiGatewayUrl) {
  const response = await axios.get(`${apiGatewayUrl}/api/hr/employees`, {
    headers: { 'Authorization': `Bearer ${userToken}` },
    params: { search: userEmail }
  });
  const employees = response.data?.data || [];
  const match = employees.find(e => e.email === userEmail);
  return match?.employee_id || null;
}

/**
 * Exécute un function call
 *
 * @param {object} functionCall - {function: string, parameters: object}
 * @param {string} userToken - JWT token de l'utilisateur
 * @param {string} apiGatewayUrl - URL de l'API Gateway
 * @param {object} [userContext] - Contexte utilisateur décodé (id, email, role...)
 * @returns {Promise<object>} - Résultat de l'appel
 */
async function executeFunction(functionCall, userToken, apiGatewayUrl, userContext) {
  const { function: functionName, parameters } = functionCall;

  console.log(`Executing function: ${functionName}`);
  console.log(`Parameters:`, parameters);

  // Vérifier que la fonction existe
  if (!FUNCTION_MAP[functionName]) {
    throw new Error(`Unknown function: ${functionName}`);
  }

  // Le modèle ne peut pas connaître l'employee_id (distinct du user_id du JWT) :
  // on l'injecte côté serveur, en écrasant toute valeur hallucinée par le LLM.
  if (FUNCTIONS_REQUIRING_EMPLOYEE_ID.has(functionName)) {
    if (!userContext?.email) {
      throw new Error(`Impossible de déterminer l'employé courant (email manquant dans le contexte utilisateur)`);
    }
    const employeeId = await resolveEmployeeId(userContext.email, userToken, apiGatewayUrl);
    if (!employeeId) {
      throw new Error(`Aucune fiche employé RH trouvée pour ${userContext.email}`);
    }
    parameters.employee_id = employeeId;
  }

  const { method, path: pathTemplate } = FUNCTION_MAP[functionName];

  // Remplacer les paramètres dans le path (:id, etc.)
  let path = pathTemplate;
  if (parameters.id) {
    path = path.replace(':id', parameters.id);
  }

  // Construire la requête
  const config = {
    method: method,
    url: `${apiGatewayUrl}${path}`,
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
  };
  
  // Ajouter query params pour GET
  if (method === 'GET' && parameters) {
    const queryParams = { ...parameters };
    delete queryParams.id; // DÃ©jÃ  dans le path
    config.params = queryParams;
  }
  
  // Ajouter body pour POST/PATCH/PUT
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    config.data = parameters;
  }
  
  try {
    const response = await axios(config);
    
    console.log(`Function ${functionName} executed successfully`);
    
    return {
      success: true,
      data: response.data,
      status: response.status
    };
    
  } catch (error) {
    console.error(`Function ${functionName} failed: ${error.message}`);
    
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      status: error.response?.status || 500
    };
  }
}

module.exports = { executeFunction, FUNCTION_MAP };
