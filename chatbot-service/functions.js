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
  'create_ticket': { method: 'POST', path: '/api/it/helpdesk/tickets' },
  'get_tickets': { method: 'GET', path: '/api/it/helpdesk/tickets' },
  'get_ticket': { method: 'GET', path: '/api/it/helpdesk/tickets/:id' },
  
  // HR Functions
  'get_leave_balance': { method: 'GET', path: '/api/hr/leave/balance' },
  'submit_leave_request': { method: 'POST', path: '/api/hr/leave' },
  'get_leave_requests': { method: 'GET', path: '/api/hr/leave' },
  
  // Finance Functions
  'submit_expense': { method: 'POST', path: '/api/finance/expenses' },
  'get_expenses': { method: 'GET', path: '/api/finance/expenses' },
  'get_budget_status': { method: 'GET', path: '/api/finance/budget/:id/status' },
  
  // Operations Functions
  'create_task': { method: 'POST', path: '/api/ops/tasks' },
  'get_tasks': { method: 'GET', path: '/api/ops/tasks' },
  'get_project_progress': { method: 'GET', path: '/api/ops/projects/:id/progress' }
};

/**
 * ExÃ©cute un function call
 * 
 * @param {object} functionCall - {function: string, parameters: object}
 * @param {string} userToken - JWT token de l'utilisateur
 * @param {string} apiGatewayUrl - URL de l'API Gateway
 * @returns {Promise<object>} - RÃ©sultat de l'appel
 */
async function executeFunction(functionCall, userToken, apiGatewayUrl) {
  const { function: functionName, parameters } = functionCall;
  
  console.log(`Executing function: ${functionName}`);
  console.log(`Parameters:`, parameters);

  // VÃ©rifier que la fonction existe
  if (!FUNCTION_MAP[functionName]) {
    throw new Error(`Unknown function: ${functionName}`);
  }

  const { method, path: pathTemplate } = FUNCTION_MAP[functionName];
  
  // Remplacer les paramÃ¨tres dans le path (:id, etc.)
  let path = pathTemplate;
  if (parameters.id) {
    path = path.replace(':id', parameters.id);
  }
  
  // Construire la requÃªte
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

module.exports = { executeFunction };
