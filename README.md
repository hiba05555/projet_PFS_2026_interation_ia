# ERP Platform — Backend Complet

## Stack
Node.js · Express · PostgreSQL · RabbitMQ · Redis · Docker · Nginx · Prometheus · Grafana

## Démarrage en une commande
```bash
docker-compose up -d
```

## Services & Ports
| Service | Port |
|---------|------|
| Nginx | 80 |
| API Gateway | 3000 |
| Auth | 3001 |
| IT Helpdesk | 3101 |
| IT User Accounts | 3102 |
| IT Equipment | 3103 |
| IT Monitoring | 3104 |
| IT Licenses | 3105 |
| HR Employees | 3201 |
| HR Leave Requests | 3202 |
| HR Recruitment | 3203 |
| HR Payroll | 3204 |
| HR Performance | 3205 |
| Finance Budget | 3301 |
| Finance Reports | 3302 |
| Finance Payments | 3303 |
| Finance Expenses | 3304 |
| Finance Invoices | 3305 |
| Ops Tasks | 3401 |
| Ops Workflows | 3402 |
| Ops Suppliers | 3403 |
| Ops Projects | 3404 |
| Ops Inventory | 3405 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| RabbitMQ | 5672 / 15672 |
| Prometheus | 9090 |
| Grafana | 3100 |

## Test rapide
```bash
# 1. Créer un compte admin
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@erp.com","password":"admin123","role":"admin","department":"IT"}'

# 2. Login → récupérer le token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@erp.com","password":"admin123"}'

# 3. Utiliser le token
curl http://localhost:3000/api/hr/employees \
  -H "Authorization: Bearer <TOKEN>"
```

## RBAC — Rôles
- admin → accès total
- IT → it/* + helpdesk pour tous
- HR → hr/*
- Finance → finance/*
- Operations → ops/*
- employee → lecture + ses données
