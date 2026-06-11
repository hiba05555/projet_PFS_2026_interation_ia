# CHATBOT SERVICE - ERP DATAPROTECT

## 📦 Service Runtime

Service chatbot intelligent avec RAG (Retrieval-Augmented Generation) + LLM fine-tuné + Function calling.

---

## 🏗️ Architecture
User Query
↓
server.js (Express)
↓
├─→ rag.js (ChromaDB) → Récupère docs pertinents
├─→ context.js (Redis) → Historique conversation
├─→ ollama.js (Mistral fine-tuné) → Génère réponse
└─→ functions.js → Appelle microservices ERP
↓
Response

---

## 📂 Fichiers

| Fichier | Rôle |
|---------|------|
| `server.js` | Serveur Express principal (port 3500) |
| `rag.js` | Client ChromaDB pour recherche sémantique |
| `ollama.js` | Client Ollama pour inférence LLM |
| `functions.js` | Function calling vers microservices |
| `context.js` | Gestion contexte utilisateur (Redis) |
| `package.json` | Dépendances Node.js |
| `Dockerfile` | Container Docker |
| `chatbot.test.js` | Tests unitaires Jest |

---

## 🚀 Installation

```bash
# Installer dépendances
npm install

# Configurer .env
cp ../.env.example ../.env
# Éditer .env avec tes valeurs
```

---

## ⚙️ Configuration (.env)

```env
# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=erp-dataprotect

# ChromaDB
CHROMADB_URL=http://localhost:8000

# Redis
REDIS_URL=redis://localhost:6379

# API Gateway
API_GATEWAY_URL=http://localhost:3000
```

---

## 🧪 Tests

```bash
# Lancer tests
npm test

# Coverage
npm test -- --coverage
```

---

## 🐳 Docker

```bash
# Build
docker build -t erp-chatbot .

# Run
docker run -p 3500:3500 \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  -e CHROMADB_URL=http://chromadb:8000 \
  erp-chatbot
```

---

## 📡 API Endpoints

### POST /chat
```bash
curl -X POST http://localhost:3500/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Comment créer un ticket?",
    "userId": "user-123"
  }'
```

### POST /reset
```bash
curl -X POST http://localhost:3500/reset \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123"}'
```

### GET /health
```bash
curl http://localhost:3500/health
```

---

## 🔄 Workflow complet

1. User envoie query via POST /chat
2. `rag.js` cherche top 3 docs pertinents dans ChromaDB
3. `context.js` récupère historique conversation (10 messages)
4. Contexte = docs RAG + historique + query actuelle
5. `ollama.js` envoie contexte au LLM fine-tuné
6. LLM génère réponse (peut contenir function call)
7. Si function call détecté → `functions.js` appelle microservice
8. Response finale envoyée au user
9. Contexte sauvegardé dans Redis

---

## 📊 Métriques

- Latence moyenne: < 2s
- RAG recall@3: > 85%
- Function calling accuracy: > 90%
- Uptime: 99.9%

---

## 🔧 Troubleshooting

**Erreur: Cannot connect to Ollama**
```bash
# Vérifier Ollama
ollama list
ollama run erp-dataprotect "test"
```

**Erreur: ChromaDB not found**
```bash
# Lancer ChromaDB
docker run -p 8000:8000 chromadb/chroma
```

**Erreur: Redis connection refused**
```bash
# Lancer Redis
docker run -p 6379:6379 redis:7-alpine
```
