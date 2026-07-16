# ERP DataProtect — Plateforme Microservices Sécurisée

Plateforme ERP complète pour la gestion IT, RH, Finance et Opérations, intégrant un **assistant intelligent (chatbot IA)** basé sur un LLM fine-tuné et une **démarche DevSecOps** de bout en bout.

## Stack

**Backend** · Node.js · Express · PostgreSQL · Redis · RabbitMQ
**Frontend** · React · Vite
**Infrastructure** · Docker Compose · Nginx (API Gateway)
**IA / Chatbot** · Mistral 7B (fine-tuné QLoRA) · Ollama · ChromaDB · sentence-transformers
**Monitoring** · Prometheus · Grafana · cAdvisor · Elasticsearch · Logstash · Kibana · Filebeat
**DevSecOps** · GitHub Actions · Trivy · OWASP ZAP · SonarCloud · Snyk · npm audit

## Architecture

- **22+ microservices** Node.js/Express organisés par domaine métier (IT, RH, Finance, Ops)
- **API Gateway Nginx** en point d'entrée unique avec routage par domaine
- **PostgreSQL** avec 4 schémas isolés (auth, hr, it, finance)
- **Redis** pour le cache et les refresh tokens (7 jours)
- **RabbitMQ** pour la communication asynchrone inter-services
- **Isolation réseau Docker** : front-tier et back-tier

## Démarrage en une commande

```bash
docker-compose up -d
```

## Services & Ports

### Cœur applicatif
| Service | Port |
|---------|------|
| Nginx (API Gateway) | 80 |
| API Gateway (Node) | 3000 |
| Auth | 3001 |
| **Chatbot** | **3500** |
| Frontend (Vite) | 5173 |

### Domaine IT
| Service | Port |
|---------|------|
| IT Helpdesk | 3101 |
| IT User Accounts | 3102 |
| IT Equipment | 3103 |
| IT Monitoring | 3104 |
| IT Licenses | 3105 |

### Domaine RH
| Service | Port |
|---------|------|
| HR Employees | 3201 |
| HR Leave Requests | 3202 |
| HR Recruitment | 3203 |
| HR Payroll | 3204 |
| HR Performance | 3205 |

### Domaine Finance
| Service | Port |
|---------|------|
| Finance Budget | 3301 |
| Finance Reports | 3302 |
| Finance Payments | 3303 |
| Finance Expenses | 3304 |
| Finance Invoices | 3305 |

### Domaine Opérations
| Service | Port |
|---------|------|
| Ops Tasks | 3401 |
| Ops Workflows | 3402 |
| Ops Suppliers | 3403 |
| Ops Projects | 3404 |
| Ops Inventory | 3405 |

### Infrastructure & IA
| Service | Port |
|---------|------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| RabbitMQ | 5672 / 15672 |
| **Ollama** (LLM) | **11434** |
| **ChromaDB** (base vectorielle) | **8000** |

### Monitoring & Observabilité
| Service | Port |
|---------|------|
| Prometheus | 9090 |
| Grafana | 3100 |
| cAdvisor | 8080 |
| Elasticsearch | 9200 |
| Logstash | 5044 |
| Kibana | 5601 |

## Assistant intelligent (Chatbot IA)

Le service `chatbot` est un agent conversationnel construit autour d'un **Mistral 7B fine-tuné en QLoRA** (r=16, alpha=16), servi via Ollama.

**Capacités :**
- **RAG** (Retrieval-Augmented Generation) : recherche sémantique dans la documentation ERP via ChromaDB + embeddings sentence-transformers `all-MiniLM-L6-v2`, top-3 retrieval
- **Function calling** : exécution d'actions métier sur les microservices (créer un ticket, poser un congé, soumettre une note de frais, consulter les employés, etc.)
- **Mémoire duale** : Redis pour le contexte court terme (10 derniers messages, TTL 7j), PostgreSQL pour l'historique permanent
- **Résilience gracieuse** : fallback sur toutes les briques non-vitales

**Pipeline de traitement d'une requête `/chat` :**
1. Authentification via header de confiance `X-User-Context`
2. Recherche RAG dans ChromaDB (top-3 docs)
3. Récupération de l'historique conversationnel (Redis)
4. Construction du prompt enrichi (format Alpaca)
5. Inférence LLM via Ollama
6. Détection multi-tier du function calling
7. Exécution éventuelle sur un microservice via API Gateway
8. Sauvegarde duale (Redis + PostgreSQL)

## Démarche DevSecOps

Pipeline CI/CD **GitHub Actions** avec matrix strategy couvrant l'ensemble des services :

- **Analyse statique** : SonarCloud
- **Vulnérabilités dépendances** : Snyk, npm audit
- **Vulnérabilités conteneurs** : Trivy
- **Tests de pénétration dynamiques** : OWASP ZAP
- **Secrets & signatures** : contrôles de configuration Docker

## Monitoring & Observabilité

- **Prometheus** collecte les métriques exposées par `prom-client` sur chaque service
- **Grafana** pour les dashboards par domaine métier
- **cAdvisor** pour les métriques par conteneur (CPU, mémoire, I/O)
- **ELK** (Elasticsearch, Logstash, Kibana) pour la centralisation des logs applicatifs, avec Filebeat comme agent de collecte sur chaque service

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

# 3. Utiliser le token sur une ressource protégée
curl http://localhost:3000/api/hr/employees \
  -H "Authorization: Bearer <TOKEN>"

# 4. Interroger le chatbot
curl -X POST http://localhost:3000/api/chatbot/chat \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"Crée un ticket pour un problème réseau"}'
```

## Sécurité & RBAC

- **Authentification JWT** avec access token (15 min) + refresh token stocké en Redis (7 jours)
- **RBAC** appliqué au niveau de chaque microservice via middleware Express dédié
- **Politique de mots de passe** : génération automatique + flow `must_change_password` au premier login
- **Notifications** : envoi Gmail via nodemailer
- **Isolation réseau Docker** : front-tier (Nginx + Frontend) / back-tier (services internes)

### Rôles

| Rôle | Périmètre |
|------|-----------|
| `admin` | Accès total à toutes les ressources |
| `IT` | Domaine IT (`/it/*`) + helpdesk cross-département |
| `HR` | Domaine RH (`/hr/*`) |
| `Finance` | Domaine Finance (`/finance/*`) |
| `Operations` | Domaine Opérations (`/ops/*`) |
| `manager` | Vue département scoped sur son propre département |
| `employee` | Lecture ses propres données uniquement |

## Structure du projet

```
├── services/          # 22+ microservices Node.js
│   ├── auth/
│   ├── chatbot/       # server.js, rag.js, ollama.js, functions.js, context.js, db.js
│   ├── it/
│   ├── hr/
│   ├── finance/
│   └── ops/
├── frontend/          # React + Vite
├── infrastructure/
│   ├── nginx/         # API Gateway
│   ├── monitoring/    # Prometheus, Grafana, cAdvisor
│   └── logging/       # ELK + Filebeat
├── ai/
│   ├── fine-tuning/   # Notebooks QLoRA / Unsloth
│   ├── modelfile/     # Modelfile Ollama
│   └── vectorize/     # Script Python d'indexation ChromaDB
└── docker-compose.yml
```
