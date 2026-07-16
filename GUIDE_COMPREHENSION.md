# Guide de compréhension — DataProtect ERP

Ce guide est écrit pour toi, pour ta soutenance. L'idée : après l'avoir lu une fois, tu dois pouvoir répondre à "pourquoi t'as fait ça comme ça ?" sur n'importe quel bout du projet, pas juste réciter "ça fait ça".

---

# PARTIE 1 — VUE D'ENSEMBLE (le "pourquoi")

## 1.1 En 10 lignes

DataProtect ERP est un système de gestion d'entreprise couvrant 4 domaines métier (RH, Finance, IT, Opérations), construit en architecture microservices : 20 petits services Express indépendants, chacun propriétaire d'un bout de données PostgreSQL, coordonnés par une API Gateway unique qui fait l'authentification et le routage. Un frontend React (monolithe à 3 fichiers, pas de router) consomme cette API. Par-dessus, un assistant conversationnel (chatbot) permet à un utilisateur de poser des questions ou de déclencher des actions ("crée-moi un ticket") en langage naturel, grâce à un LLM open-source (Mistral 7B) fine-tuné spécifiquement sur le vocabulaire de cet ERP et exécuté localement via Ollama (pas d'appel à une API cloud type OpenAI — donnée sensible, coût, indépendance). Le tout tourne dans 36 conteneurs Docker orchestrés par Docker Compose, avec une chaîne CI/CD GitHub Actions à 11 jobs qui fait du lint, du SAST, du scan de dépendances, du scan de conteneurs, des tests end-to-end et du DAST avant tout déploiement. Une stack de observabilité (Prometheus/Grafana pour les métriques, ELK pour les logs) tourne en parallèle. Le projet illustre volontairement une architecture "entreprise" complète — pas juste un CRUD, mais RBAC fin, sécurité JWT, IA appliquée à un vrai cas d'usage métier, et pipeline DevSecOps.

## 1.2 Architecture en ASCII

```
                                   ┌─────────────────────┐
                                   │   NAVIGATEUR (React)  │
                                   │  dataprotect-frontend  │
                                   └──────────┬───────────┘
                                              │ HTTP (fetch/axios)
                                              ▼
                                   ┌─────────────────────┐
                                   │        nginx         │  :80
                                   │  reverse proxy /api/  │
                                   └──────────┬───────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │     API GATEWAY      │  :3000
                                   │  - CORS               │
                                   │  - verifyToken (JWT)   │
                                   │  - proxy vers 20 svc   │
                                   └──┬───────┬───────┬───┘
                    ┌─────────────────┘       │       └──────────────────┐
                    ▼                         ▼                          ▼
         ┌─────────────────┐      ┌─────────────────────┐    ┌──────────────────────┐
         │   AUTH SERVICE   │      │  20 MICROSERVICES    │    │   CHATBOT-SERVICE     │  :3500
         │  :3001           │      │  IT/HR/Finance/Ops    │    │                       │
         │  login/register   │      │  :3101-3405           │    │  1. RAG (ChromaDB)     │
         │  JWT + bcrypt      │      │  chacun → sa table     │    │  2. Contexte (Redis)   │
         └────────┬─────────┘      │  PostgreSQL dédiée      │    │  3. Prompt → Ollama    │
                  │                └──────────┬───────────┘    │  4. Function-calling   │
                  │                           │                 │  5. Exécute la fonction │
                  │                           │                 │     (rappelle la        │
                  │                           │                 │      Gateway !)          │
                  │                           │                 └──────┬───────┬─────────┘
                  │                           ▼                        │       │
                  │                ┌─────────────────────┐            ▼       ▼
                  └───────────────▶│      PostgreSQL       │◀──┌───────────┐ ┌──────────┐
                                   │  (28 tables, 6 schémas) │  │  ChromaDB  │ │  Ollama   │
                                   └─────────────────────┘   │  (RAG,     │ │ (Mistral  │
                                                              │  35 docs)   │ │  7B fine-  │
                                   ┌─────────────────────┐   └───────────┘ │  tuné)     │
                                   │        Redis          │◀──────────────┘ └──────────┘
                                   │  historique court terme │
                                   │  du chatbot              │
                                   └─────────────────────┘

        ─── En parallèle, indépendant du flux requête ───

  Prometheus (scrape /metrics × 23 services) ──▶ Grafana (dashboards)
  Filebeat (logs des conteneurs Docker) ──▶ Logstash ──▶ Elasticsearch ──▶ Kibana
```

**Point clé à retenir** : le chatbot-service, quand il exécute une fonction (ex. "crée un ticket"), ne parle **jamais directement** à la base de données ni au microservice — il repasse par l'API Gateway, exactement comme le ferait le frontend. Ça veut dire que le chatbot hérite automatiquement de tout le RBAC déjà en place (un employé qui demande au chatbot de voir les infos RH d'un autre département se fera refuser, comme s'il avait cliqué dans l'interface).

## 1.3 Choix technologiques — et pourquoi

| Techno | Pourquoi celle-là et pas une autre |
|---|---|
| **Microservices (20 services Express) plutôt qu'un monolithe** | Isolation par domaine métier : un bug/crash dans `finance-invoices` n'affecte pas `hr-payroll`. Permet de montrer une vraie compétence archi distribuée pour le rapport de stage. Contrepartie assumée : zéro appel HTTP inter-services (voir 1.5 du rapport d'architecture) — la composition cross-domaine se fait soit à la Gateway, soit par accès direct Postgres (ex. `finance-reports` lit directement les tables budgets/expenses/payments/invoices). |
| **PostgreSQL avec un schéma par domaine** (`it_schema`, `hr_schema`, etc.) | Isolation logique des données sans la lourdeur opérationnelle de 20 bases séparées. `pgcrypto`/`gen_random_uuid()` pour des clés primaires UUID plutôt que des entiers auto-incrémentés — évite la devinabilité des ID et facilite une éventuelle sharding future. |
| **JWT (pas de sessions serveur)** | Stateless — n'importe quel microservice peut vérifier un token sans taper la base de session à chaque requête. Le compromis classique : pas de révocation immédiate possible (un token volé reste valide jusqu'à expiration, 8h ici) — pas de mécanisme de refresh token implémenté, donc ce compromis est encore plus présent (voir Partie 4, question sécurité). |
| **Zod pour la validation** | Typé, déclaratif, message d'erreur structuré automatiquement mappé en HTTP 400 — évite d'écrire des `if (!req.body.title || req.body.title.length < 5)` à la main dans 20 fichiers. |
| **API Gateway avec `express-http-proxy`** | Un seul point d'entrée pour tout — CORS, rate limiting et vérification JWT ne sont écrits qu'une fois, pas dupliqués 20 fois. Le pattern `X-User-Context` (voir 3.3) permet de ne transmettre en interne QUE les infos utilisateur nécessaires, jamais le JWT brut. |
| **Ollama + Mistral 7B fine-tuné (au lieu d'un appel API OpenAI/Claude)** | Souveraineté des données (l'ERP contient des infos RH/Finance sensibles — les envoyer à une API tierce serait un problème), coût nul par requête (vs facturation à l'usage), et démonstration technique de fine-tuning (compétence différenciante pour un rapport de stage). Contrepartie lourde assumée : un modèle 7B quantifié sur CPU est lent (60-300s par réponse) et un fine-tuning léger (120 steps QLoRA) est moins fiable qu'un gros modèle propriétaire — d'où tout le travail de fiabilisation (tiers 1/2/3, cohérence, sandwich, voir Partie 2.4 et Étape 6). |
| **ChromaDB pour le RAG** | Base vectorielle légère, embarquable en conteneur, suffisante pour 35 documents — pas besoin d'un Pinecone/Weaviate managé pour ce volume. |
| **Redis pour le contexte court terme du chatbot, PostgreSQL pour le long terme** | Redis = rapide, TTL natif (expire tout seul après 7 jours), parfait pour "les 10 derniers messages à injecter dans le prompt". PostgreSQL = persistant, interrogeable, pour l'historique complet consultable dans l'UI (`/history/:userId`). Deux besoins différents, deux outils différents plutôt qu'un seul mal adapté aux deux. |
| **React sans router, sans Redux** | Choix pragmatique/minimaliste plutôt qu'une lacune — l'appli a ~12 "pages" gérées par un simple `switch` sur un `useState`. Pour ce volume d'écrans, `react-router-dom` aurait ajouté une dépendance sans bénéfice réel. C'est un choix défendable en soutenance ("j'ai évalué que la complexité ne justifiait pas la dépendance"), mais assume-le comme un choix, pas comme un oubli.
| **Docker Compose (pas Kubernetes)** | 36 conteneurs sur une seule machine de dev/démo — Kubernetes serait une sur-ingénierie pour ce contexte (pas de besoin de scaling horizontal automatique, pas de cluster multi-nœud). Compose reste lisible et suffisant. |
| **GitHub Actions pour le CI/CD** | Gratuit pour un repo, intégration native avec le repo, pas besoin d'infra CI séparée (Jenkins etc.) à maintenir. |

---

# PARTIE 2 — FLUX DE REQUÊTE (le "comment ça marche")

## 2.1 L'utilisateur clique "Login"

1. **Frontend** (`App.jsx`, composant `LoginPage`) : `fetch POST /api/auth/login` avec `{ email, password }` dans le body.
2. **nginx** intercepte tout ce qui commence par `/api/` et le renvoie vers `api-gateway:3000` (voir `nginx.conf`, Étape 1).
3. **API Gateway** (`server.js`) : la route `/api/auth/*` est déclarée **avant** le middleware global `app.use('/api', verifyToken)` — donc **aucune vérification JWT** n'est appliquée sur le login (logique, on n'a pas encore de token !). La requête est juste proxifiée telle quelle vers `auth-service:3001`.
4. **Auth service** (`POST /login`) :
   - Passe d'abord par `loginLimiter` (rate limiting : 10 tentatives / 15 min, anti brute-force)
   - `loginSchema.parse(req.body)` (Zod) valide le format email/password
   - `SELECT * FROM auth_schema.users WHERE email = $1 AND is_active = true`
   - **Protection anti-timing-attack** : même si l'utilisateur n'existe pas, un `bcrypt.compare` est quand même exécuté contre un hash factice — sinon un attaquant pourrait déduire qu'un email existe juste en mesurant que la réponse est plus rapide (pas de hash à comparer) quand l'email n'existe pas.
   - Si mot de passe valide : `jwt.sign({ id, role, department, email }, _SECRET, { expiresIn: '8h' })`
   - Réponse : `{ token, user, mustChangePassword }`
5. **Frontend** : stocke `token`, `user` (JSON.stringify), `mustChangePw` dans `localStorage`. Si `mustChangePassword` est vrai, affiche `ChangePasswordScreen` au lieu du dashboard.
6. À partir de là, **chaque requête** du frontend vers l'API ajoute manuellement `headers: { Authorization: 'Bearer ' + token }` — il n'y a pas de client HTTP centralisé qui le fait automatiquement (chaque module React répète ce pattern).

**Point faible à connaître** : si le token expire (après 8h) ou est invalide, il n'y a **aucune gestion globale du 401** côté frontend — les appels échouent silencieusement (`catch {}` vide dans beaucoup d'endroits), l'utilisateur voit juste des listes vides sans message d'erreur clair, au lieu d'être redirigé vers le login. C'est une vraie limite à assumer si on te pose la question.

## 2.2 L'utilisateur crée un ticket (formulaire classique, pas le chatbot)

1. **Frontend** (`ITModule` dans `App.jsx`) : `fetch POST /api/it/helpdesk` avec `Authorization: Bearer <token>` et le body `{ title, description, priority, category }`.
2. **nginx** → **API Gateway**.
3. **API Gateway** : la requête tombe sous `app.use('/api', verifyToken)` (middleware global, appliqué à tout sauf `/api/auth`). `verifyToken` (importé de `shared/middleware/auth.js`) vérifie le JWT, peuple `req.user = { id, role, department, email }`.
4. Ensuite, `services['/api/it/helpdesk']` correspond à l'URL `http://erp-it-helpdesk:3101` → `proxy(url, proxyOptions(url))`. Le décorateur `addUserContext` s'exécute : il **retire le header `Authorization`** et le remplace par `X-User-Context: {"id":..,"role":..,"department":..,"email":..}` (JSON stringifié). C'est la frontière de confiance : le microservice ne revérifie jamais la signature JWT, il fait confiance à ce header **parce que seule la gateway peut le poser** (les microservices ne sont pas exposés publiquement, seule la gateway l'est via nginx).
5. **it-helpdesk** (`POST /`) :
   - `verifyToken` (mode `X-User-Context` cette fois, pas de JWT à revérifier) → `req.user` peuplé depuis le header
   - **Pas de `requireDeptOrAdmin`** sur cette route précise — n'importe quel utilisateur authentifié peut créer un ticket (logique : tout le monde peut avoir un problème IT)
   - `ticketSchema.parse(req.body)` (Zod) : title 5-200 caractères, description 10-2000, priority/category dans une liste fermée
   - `ticketNumber = 'HELP-' + Date.now()` (généré côté serveur, jamais fourni par le client)
   - `INSERT INTO it_schema.helpdesk_tickets (...) VALUES (...) RETURNING *` — statut initial `'open'`, `created_by = req.user.id`
   - Réponse `201 { success: true, data: ticket }`

## 2.3 L'utilisateur envoie "bonjour" au chatbot

C'est le chemin le plus long du système :

```
Widget (ChatWidget.jsx)
  → axios.post('/api/chatbot/chat', { query, conversationId, userToken }, timeout: 720000)
  → nginx (proxy_pass /api/ → erp-gateway:3000, proxy_read_timeout 720s)
  → API Gateway (route custom app.post('/api/chatbot/chat', ...), PAS le proxy générique)
      → axios.post(`${CHATBOT_SERVICE_URL}/chat`, req.body, { headers: buildChatbotHeaders(req), timeout: 660000 })
  → chatbot-service (POST /chat)
      Étape 1 — RAG : ragClient.searchRelevantDocs("bonjour", 3)
        → ChromaDB (embedding local via DefaultEmbeddingFunction, distance sémantique)
        → tous les résultats ont une distance ≥ 1.6 (seuil MAX_DISTANCE = 1.1) → 0 documents retournés
      Étape 2 — Contexte : contextManager.getContext(conversationId) → Redis, historique des 10 derniers messages
      Étape 3 — Construction du prompt complet (historique + docs RAG (vide ici) + "Question: bonjour")
      Étape 4 — Inférence LLM : ollamaClient.chat(fullContext, { rawQuery: "bonjour" })
        → isSmallTalk("bonjour") === true (regex SMALL_TALK_PATTERN)
        → utilise SMALL_TALK_INSTRUCTIONS (2 lignes) au lieu de FUNCTION_CALLING_INSTRUCTIONS (~1000+ tokens)
        → POST http://erp-ollama:11434/api/generate { model: "erp-dataprotect", prompt: ..., options: { temperature: 0.2, num_ctx: 4096, num_predict: 300 } }
        → Ollama charge le modèle (GGUF Q4_K_M) et génère une réponse en langage naturel
      Étape 5 — Détection function-calling : extractFunctionCall(réponse) → pas de bloc ```json → null (normal, "bonjour" n'est pas une action)
      Étape 7 — Sauvegarde : Redis (contexte court terme) + PostgreSQL (chat_conversations/chat_messages, historique permanent)
  ← réponse JSON { response: "Bonjour ! Je suis l'assistant...", conversationId, timestamp }
  ← remonte telle quelle jusqu'au widget, qui l'affiche dans la bulle de chat
```

Temps réel observé pendant le développement : entre 15s (modèle déjà "chaud" en mémoire, prompt court) et 110s (premier appel après redémarrage du conteneur Ollama, qui doit recharger le modèle depuis le disque).

## 2.4 L'utilisateur demande "crée un ticket réseau" au chatbot

Même début que 2.3 (étapes 1-4), mais avec deux différences : `isSmallTalk` renvoie `false` (donc les `FUNCTION_CALLING_INSTRUCTIONS` complètes sont injectées), et à l'étape 5, la réponse du LLM contient (idéalement) un bloc :
```
```json
{"function": "create_ticket", "parameters": {"title": "Problème réseau", "description": "...", "priority": "medium", "category": "network"}}
```
```

Ensuite, tout le mécanisme de fiabilisation entre en jeu (voir Étape 6 pour le détail complet) :

```
extractFunctionCall(réponse) → JSON.parse + vérifie que "create_ticket" existe dans FUNCTION_MAP
  ↓ (si trouvé)
isFunctionCoherentWithQuery({function:"create_ticket",...}, "crée un ticket réseau")
  → la requête contient un verbe de CRÉATION ("crée"), la fonction est bien create_* → cohérent, on garde
  ↓ (si le LLM avait halluciné, ex. choisi get_tickets, ce serait rejeté ici → retour à null)
  ↓ (si null après tout ça : Tier 2 — retry LLM SANS historique, puis Tier 3 — fallback déterministe get_* uniquement)
functionCall = {"function": "create_ticket", "parameters": {...}}
  ↓
Étape 6 — Exécution : functionHandler.executeFunction(functionCall, userToken, API_GATEWAY_URL, userContext)
  → FUNCTION_MAP["create_ticket"] = { method: "POST", path: "/api/it/helpdesk" }
  → axios.post(`${API_GATEWAY_URL}/api/it/helpdesk`, parameters, { headers: { Authorization: `Bearer ${userToken}` } })
  → RE-TRAVERSE TOUTE LA CHAÎNE GATEWAY → verifyToken → it-helpdesk → ticketSchema.parse → INSERT → réponse
  ↓
formatFunctionResultMessage("create_ticket", functionResult)
  → "Ticket créé. Numéro de ticket : HELP-1234567890 (priorité : medium)."
```

**Le point à bien comprendre pour la soutenance** : le chatbot n'a **aucun accès direct** à la base de données ni à l'API Gateway avec des privilèges spéciaux — il utilise le **token JWT de l'utilisateur qui a posé la question** (`userToken` transmis depuis le frontend dans le body de `/chat`). Si cet utilisateur n'a pas le droit de créer un ticket (il l'a toujours, c'est ouvert à tous), ou n'a pas le droit de lister les factures (réservé à Finance/admin), le chatbot se fait refuser exactement comme si l'utilisateur avait cliqué dans l'interface. Le LLM ne contourne jamais le RBAC.

---

# PARTIE 3 — ANALYSE FICHIER PAR FICHIER

## Étape 1 — Infrastructure

### `docker-compose.yml`

36 conteneurs, organisés en 4 couches logiques :

- **Données** : `postgres` (seul avec un `healthcheck: pg_isready`), `redis`, `rabbitmq` (provisionné mais jamais utilisé par le code — pas de publication/consommation d'événements trouvée)
- **Edge** : `nginx` (port 80 publié), `api-gateway` (port 3000 publié, seul microservice exposé en plus de nginx)
- **20 microservices métier** : chacun `build: context: . / dockerfile: services/<domaine>/<service>/Dockerfile`, un port interne dédié (3101-3405), **jamais de port publié sur l'hôte** — inaccessibles autrement que via la gateway ou en `docker exec`
- **IA** : `chromadb` (port 8000 publié, utile pour debug direct), `ollama` (build custom qui embarque le GGUF + le Modelfile), `chatbot-service`
- **Monitoring** : `prometheus`, `grafana`, `cadvisor` (métriques conteneurs), `elasticsearch`, `logstash`, `kibana`, `filebeat`

**Deux réseaux** : `erp-front-tier` (nginx, gateway, monitoring UI — ce qui doit être atteignable depuis l'extérieur) et `erp-back-tier` (tout le reste — communication interne). La gateway est sur les deux, elle fait le pont.

**Volumes nommés** : `postgres_data`, `chromadb_data`, `ollama_data`, `grafana_data`, `prometheus_data`, `elasticsearch_data` — sans eux, tout ce qui est indexé/entraîné/stocké disparaîtrait à chaque `docker compose down`.

**Pourquoi seul postgres a un healthcheck** : c'est la seule dépendance dont le démarrage lent (quelques secondes d'initialisation) pouvait faire planter les autres services au boot (`depends_on: postgres: condition: service_healthy`). Les autres services démarrent vite et gèrent eux-mêmes leurs erreurs de connexion (retry/reconnexion), donc ce n'était pas jugé critique — mais c'est un vrai point faible en observabilité (Docker ne peut pas détecter tout seul qu'un microservice est "up mais en fait cassé").

### `nginx/nginx.conf`

Rôle : reverse proxy unique en entrée du système (port 80).
```nginx
location /api/ {
    proxy_pass http://erp-gateway:3000;
    proxy_connect_timeout 10s;
    proxy_send_timeout    720s;
    proxy_read_timeout    720s;
}
location / {
    return 200 'DataProtect ERP - API OK';
}
```
Tout ce qui commence par `/api/` part vers la gateway. La route `/` ne sert **pas** le frontend React (juste un texte de statut) — le frontend est servi séparément par le serveur de dev Vite (`npm run dev`, port 5173) en développement ; en prod il faudrait ajouter un `location /` qui sert les fichiers statiques buildés (`dist/`), ce qui n'est pas fait actuellement (à mentionner si on te demande le déploiement prod).

Le timeout `720s` (12 minutes) est volontairement énorme — c'est le résultat direct du travail de fiabilisation du chatbot (pire cas : RAG + 2 appels LLM séquentiels de 300s chacun en cas de retry). Sans ce réglage, une requête chatbot lente aurait été coupée par nginx avant même que le chatbot-service ait fini de répondre → "erreur réseau" côté utilisateur alors que le calcul était toujours en cours côté serveur.

### `database/init.sql`

Exécuté **une seule fois**, au tout premier démarrage du conteneur `postgres` (le volume est vide). 6 schémas :
- `auth_schema` (1 table : `users`)
- `it_schema`, `hr_schema`, `finance_schema`, `ops_schema` (5-9 tables chacun, 26 au total)
- `public` (2 tables : `chat_conversations`, `chat_messages` — ajoutées après coup pour le chatbot, voir Partie 4)

**Pourquoi un schéma par domaine plutôt qu'un préfixe de nom de table** (`it_helpdesk_tickets` au lieu de `it_schema.helpdesk_tickets`) : `SEARCH_PATH`, permissions Postgres granulaires possibles par schéma (pas exploité ici mais l'architecture le permettrait), et surtout lisibilité — en un coup d'œil sur une requête SQL on sait de quel domaine elle parle.

**Convention** : quasiment toutes les tables ont une clé primaire `UUID DEFAULT gen_random_uuid()` (nécessite l'extension `pgcrypto`), sauf `auth_schema.users` (`SERIAL`) — c'est pour ça que le JWT contient `id: user.user_id` qui est un entier, pas un UUID (à savoir si on te demande pourquoi les deux coexistent).

## Étape 2 — Authentification

### `services/auth/auth/server.js`

Toutes les routes en détail (voir aussi Partie 3bis pour le format fonction-par-fonction) :

- **`POST /register`** : Zod `registerSchema` (`role` restreint à `admin|manager|employee`, défaut `employee`) → vérifie unicité email/username → `bcrypt.hash(password, 12)` → `INSERT` → génère un JWT immédiatement (auto-login après inscription).
- **`POST /login`** : passe par `loginLimiter` (10 tentatives/15min) → `loginSchema` → requête + comparaison bcrypt avec protection anti-timing (hash factice comparé même si l'email n'existe pas) → si valide, `UPDATE last_login` puis `jwt.sign(...)`.
- **`GET /verify`** : utilisé (en théorie) par la gateway pour valider un token — en pratique la gateway utilise directement `verifyToken` du middleware partagé (même logique dupliquée), cette route sert surtout pour du debug/test manuel ou un futur usage externe.
- **`POST /change-password`** : vérifie le JWT inline (pas via le middleware partagé — ce fichier a sa propre copie de la logique JWT), vérifie l'ancien mot de passe par bcrypt, hash le nouveau.
- **`POST /forgot-password`** : rate-limité, **répond toujours 200** même si l'email n'existe pas (anti-énumération de comptes) ; si l'email existe et que Gmail est configuré (`GMAIL_USER`/`GMAIL_APP_PASSWORD`), génère un token aléatoire (`crypto.randomBytes(32)`) valable 1h et envoie un email.
- **`POST /reset-password`** : vérifie `reset_token` + `reset_token_expires > NOW()`, hash le nouveau mot de passe.
- **Routes admin** (`GET /users`, `POST /admin/create`, `POST /:id/activate`, `POST /:id/deactivate`, `POST /:id/reset-password`) : gated par un helper local `verifyAdmin()` qui revérifie le JWT à la main et check `role === 'admin'` — **pas** le middleware partagé `requireRole` (qui existe mais n'est utilisé nulle part dans tout le projet, curieusement).

**Mécanismes de sécurité présents** : bcrypt (12 rounds), rate limiting sur login/forgot-password, protection timing-attack, anti-énumération sur forgot-password, blocage de l'auto-désactivation et de la désactivation d'un compte admin, mot de passe temporaire aléatoire cryptographiquement sûr (`crypto.randomInt`, pas `Math.random()`).

**Absent** : pas de refresh token, pas de 2FA, pas de verrouillage de compte après N échecs (seulement du rate limiting par IP, contournable en changeant d'IP), pas de journal d'audit des connexions.

### `shared/middleware/auth.js`

Le fichier le plus important en transversalité — importé par les 20 microservices + la gateway. Trois exports principaux :

- **`verifyToken`** : double mode. Si `X-User-Context` est présent dans les headers → `JSON.parse` direct, **sans revérifier de signature** (c'est la gateway qui a déjà vérifié le JWT avant de poser ce header). Sinon → vérifie un `Authorization: Bearer <JWT>` classique avec `jwt.verify`. Ce deuxième mode permet d'appeler un microservice directement (en dev/test) sans passer par la gateway.
- **`requireDeptOrAdmin(...depts)`** : alias de `requireDepartment` — autorise si `role === 'admin'` OU si `department` est dans la liste donnée. **Ne distingue pas manager d'employee** au sein du département — c'est un choix de simplicité (le scoping plus fin, quand il existe, est fait à la main dans chaque service, voir Étape 4).
- **`requireRole(...roles)`** : existe, mais grep sur tout le repo montre qu'il n'est utilisé **nulle part** dans les routes — tout le monde utilise `requireDeptOrAdmin` à la place. Point à noter si on te demande "y a-t-il du code mort".

## Étape 3 — API Gateway

### `services/api-gateway/server.js`

- **CORS restrictif** : liste blanche d'origines exactes (`allowedOrigins.includes(origin)`), `credentials: true` pour que les cookies/headers d'auth passent en cross-origin.
- **Ordre des middlewares crucial** : `helmet()` → `cors()` → `express.json()` → `/metrics` (public) → `rateLimit` global (300 req/15min) → `/health` (public) → `/api/auth/*` proxifié **sans** `verifyToken` → **puis** `app.use('/api', verifyToken)` qui s'applique à tout le reste.
- **`addUserContext`** : le cœur de la sécurité inter-services. Transforme un JWT vérifié en header `X-User-Context` de confiance, et **supprime** le header `Authorization` original avant de proxifier — les microservices internes ne voient jamais le JWT brut du client.
- **Table `services`** : un simple objet `{ '/api/it/helpdesk': 'http://erp-it-helpdesk:3101', ... }`, bouclé avec `Object.entries(services).forEach(...)` pour enregistrer 20 proxies automatiquement — évite d'écrire 20 fois le même bloc `app.use(path, proxy(url, options))`.
- **Routes chatbot en dehors du système de proxy générique** : `/api/chatbot/chat`, `/reset`, `/health`, `/history/*` sont des handlers `axios` écrits à la main (pas `express-http-proxy`) — parce que le chatbot a besoin d'un **timeout radicalement différent** (660s vs 5s pour tous les autres services) et d'un formatage de headers spécifique (`buildChatbotHeaders`). Utiliser le même `proxyOptions` générique (timeout 5s) aurait coupé systématiquement les requêtes chatbot avant que le LLM ait fini de répondre — c'est exactement le bug qu'on a chassé durant tout le développement (Partie 4, Étape 10 du rapport d'architecture).

## Étape 4 — Un microservice type : `services/it/helpdesk/server.js`

C'est LE modèle que suivent (avec variations) les 19 autres. Détail complet :

- **`rbacScope(user, conds, params, {managerFilter, employeeFilter})`** : helper local (dupliqué, pas partagé — présent aussi dans `it/equipment`, `finance/budget`, `finance/expenses`) qui ajoute une condition SQL selon le rôle. Sur `it-helpdesk`, il n'est utilisé que dans `/stats` — pas dans `GET /` (le commentaire dans le code dit explicitement que `requireDeptOrAdmin('IT')` suffit déjà à ce niveau, donc le scoping manager serait du code mort).
- **3 schémas Zod** : `ticketSchema` (création), `assignSchema` (juste un UUID), `resolveSchema` (juste des notes de résolution min 10 caractères).
- **`GET /`** : `verifyToken` + `requireDeptOrAdmin('IT')` → seuls IT et admin listent tous les tickets, avec filtres (`status`, `priority`, `category`, `assigned_to`) et tri par priorité (`CASE priority WHEN 'critical' THEN 1 ...`) puis date.
- **`GET /stats`** : dashboard — comptages par statut + temps moyen de résolution en heures via `EXTRACT(EPOCH FROM (resolved_at - created_at))/3600`.
- **`GET /my-tickets`** : n'importe quel utilisateur, filtré sur `created_by = req.user.id` — c'est la route que le chatbot appelle pour `get_tickets` (pas `GET /`, qui est réservée IT/admin).
- **`GET /:id`** : `verifyToken` seul, mais check manuel en handler (`isIT || ticket.created_by === req.user.id`) — exemple de RBAC fait "à la main" plutôt que par middleware, parce que la règle dépend de la donnée elle-même (le ticket), pas juste du rôle.
- **`POST /`** : ouvert à tout utilisateur authentifié (n'importe qui peut avoir un problème IT), génère `ticket_number` côté serveur (`HELP-${Date.now()}`), statut initial forcé à `'open'`.
- **`POST /:id/assign`, `/:id/resolve`** : réservés IT/admin, avec des `WHERE status IN (...)` qui empêchent les transitions d'état invalides (ex. impossible d'assigner un ticket déjà résolu).
- **`POST /:id/close`** : le demandeur original OU IT/admin peuvent fermer — mais seulement si le ticket est déjà `'resolved'`.
- **`PATCH /:id`** : liste blanche de champs modifiables (`priority`, `category`, `title`) construite dynamiquement, bloquée si le ticket est `resolved`/`closed`.

## Étape 5 — Ce qui diffère des autres services

Plutôt que de re-détailler chaque service (déjà fait dans `ARCHITECTURE_REPORT.md` section 1), voici uniquement les **différences notables** par rapport au modèle it-helpdesk :

**HR**
- `hr-employees` : RBAC à 3 niveaux en un seul handler (admin/RH voient tout + `salary`, manager voit son département sans `salary`, employé voit sa propre fiche par email sans `salary`) — la colonne sensible est conditionnellement retirée du `SELECT` lui-même, pas juste masquée côté client.
- `hr-leave-requests` : validation métier dans le handler (pas dans Zod) — `end_date >= start_date`, calcul de `total_days`, **détection de chevauchement** avec les congés déjà posés (requête qui vérifie qu'aucune plage de dates existante ne recoupe la nouvelle).
- `hr-recruitment` : machine à états explicite (`VALID_TRANSITIONS`) — un candidat ne peut passer de `new` qu'à `screening` ou `rejected`, jamais directement à `hired`. C'est le seul service avec ce pattern de state machine formalisée en objet JS.
- `hr-payroll` : `GET /summary` agrège le coût par département/devise ; empêche les doublons de bulletin pour un même employé sur une même période.

**Finance**
- `finance-reports` : le seul service qui **lit** (SELECT uniquement) les tables d'autres services du même domaine (`budgets`, `expenses`, `payments`, `invoices`) pour construire un dashboard agrégé — géographiquement dans son propre schéma mais fonctionnellement transversal.
- `finance-invoices` : calcule lui-même `invoice_number`, `tax_amount`, `total_amount` côté serveur à partir de `amount` et `tax_rate` — jamais fournis bruts par le client.
- `finance-expenses` : **seul service Finance** où `GET /` et `POST /` n'exigent que `verifyToken` (pas `requireDeptOrAdmin`) — self-service assumé (n'importe qui peut soumettre/voir SES notes de frais), avec scoping `created_by = self` en SQL pour les non-Finance.

**Operations**
- `ops-workflows` : moteur générique à étapes configurables (`steps` en JSONB), calcule la prochaine étape par `order` minimal, journalise chaque transition dans `workflow_step_logs` — le service le plus "moteur" (générique) plutôt que "métier" (spécifique à une entité).
- `ops-inventory` : **seul endpoint de tout le projet avec une transaction SQL explicite** (`BEGIN`/`COMMIT`/`ROLLBACK`) sur `POST /:id/movement` — parce qu'il faut garantir que la mise à jour du stock et l'écriture du mouvement dans le journal (`inventory_movements`) réussissent ou échouent ensemble (cohérence comptable).
- `ops-projects` : agrégation `json_agg` pour renvoyer la liste des membres directement imbriquée dans la réponse du projet, plutôt qu'un second appel séparé.

## Étape 6 — Le chatbot (cœur du projet)

### `chatbot-service/server.js` — le pipeline `/chat`

7 étapes séquentielles dans le handler `app.post('/chat', ...)` :

1. **RAG** — `ragClient.searchRelevantDocs(query, 3)`
2. **Contexte** — `contextManager.getContext(conversationId || userId)` (Redis)
3. **Construction du prompt** — concatène historique + docs RAG + question dans `fullContext`
4. **Inférence LLM** — `ollamaClient.chat(fullContext, { rawQuery: query })`
5. **Détection function-calling** — `extractFunctionCall` + `isFunctionCoherentWithQuery` + le mécanisme à 3 tiers
6. **Exécution de la fonction** (si détectée) — `functionHandler.executeFunction(...)`
7. **Sauvegarde** — Redis + PostgreSQL, puis réponse JSON au client

Le mécanisme à 3 tiers (étape 5), résumé :

| Tier | Condition de déclenchement | Ce qu'il fait |
|---|---|---|
| 1 | Toujours | `extractFunctionCall` extrait le bloc ` ```json `, `isFunctionCoherentWithQuery` vérifie que le verbe de la question correspond au type de fonction choisie |
| 2 | Rien de valide au tier 1 + `looksLikeActionRequest(query)` vrai | Réappelle le LLM avec un prompt **sans historique de conversation** (casse l'effet "le modèle imite son propre refus précédent") |
| 3 | Rien de valide au tier 2 | `detectConsultationFallback` — construit l'appel **sans LLM**, uniquement pour les fonctions `get_*` sans paramètre requis, et seulement si la question ne contient pas de verbe de création |

**Pourquoi 3 tiers et pas juste "on réessaie" ?** Parce que chaque tier a un coût et une garantie différents. Le tier 1 est gratuit mais peu fiable seul. Le tier 2 coûte un appel LLM entier (jusqu'à 300s) mais reste flexible (peut gérer n'importe quelle fonction, avec paramètres). Le tier 3 est instantané et 100% fiable, mais seulement pour les consultations sans paramètre — on ne peut pas l'utiliser pour "crée un ticket" parce que personne ne peut deviner le titre/description à la place du LLM.

### `chatbot-service/ollama.js` — construction du prompt

Le prompt final envoyé à Ollama suit toujours ce squelette (format Alpaca, celui utilisé à l'entraînement) :
```
### Instruction:
{instructions}          ← FUNCTION_CALLING_INSTRUCTIONS ou SMALL_TALK_INSTRUCTIONS

{prompt}{reminder}       ← historique + docs RAG + question + rappel sandwich

### Input:


### Response:
```

**`FUNCTION_CALLING_INSTRUCTIONS`** (~1000+ tokens) : décrit le format attendu (bloc ` ```json `), liste les 15 fonctions disponibles (générée dynamiquement depuis `FUNCTION_MAP`), donne 5 exemples few-shot (création de ticket, congé, note de frais, **consultation d'employés** — ajouté spécifiquement pour corriger un bug de fiabilité, voir Partie 4 du rapport d'architecture), et une section de contraste explicite consultation vs création.

**`isSmallTalk(query)`** : regex `SMALL_TALK_PATTERN` en deny-list fermée (bonjour, salut, merci, ok...). Si vrai, remplace les instructions lourdes par 2 lignes (`SMALL_TALK_INSTRUCTIONS`) — économise l'essentiel du budget de contexte sur les échanges qui ne peuvent de toute façon déclencher aucune action.

**Le rappel "sandwich"** : une phrase répétée juste avant `### Response:`, en plus des instructions en tête de prompt. Pourquoi ce doublon ? Parce que le fine-tuning est léger et que l'historique de conversation, quand il est présent, s'intercale entre les instructions et la question — ça dilue le poids des instructions. Répéter la consigne juste avant le point de génération augmente l'adhérence au format (technique connue en prompt engineering).

**`temperature: 0.2`** (au lieu de 0.7 par défaut dans le Modelfile) : pour une tâche à sortie structurée (générer du JSON exact), on veut que le modèle reproduise fidèlement le pattern appris plutôt qu'il "improvise" — la créativité est un défaut ici, pas une qualité.

**`num_ctx: 4096`** (au lieu de 2048 dans le Modelfile) : passé explicitement par requête car Ollama ignore la valeur du Modelfile pour `/api/generate` si elle n'est pas redonnée dans `options`. Le prompt (instructions + RAG + historique) peut atteindre ~1800 tokens à lui seul — avec seulement 2048 de contexte total, il ne restait presque plus de place pour la réponse, ce qui provoquait des générations tronquées ou incohérentes.

### `chatbot-service/functions.js` — FUNCTION_MAP

15 fonctions, chacune un simple `{ method, path }` pointant vers un endpoint de l'API Gateway (jamais directement vers un microservice — toujours via la gateway, donc toujours avec RBAC appliqué). Cas particulier : `submit_leave_request` exige un `employee_id` que le LLM ne peut pas connaître (distinct du `user_id` du JWT) — `resolveEmployeeId()` le résout côté serveur via une recherche par email, en écrasant toute valeur que le LLM aurait pu halluciner.

### `chatbot-service/rag.js` — ChromaDB

`searchRelevantDocs(query, nResults)` : récupère `nResults + 5` candidats, filtre les catégories "meta" (chatbot/devops/docker/monitoring/infrastructure/api — ces documents parlent du fonctionnement interne du système et perturberaient le function-calling s'ils étaient injectés), puis filtre par `MAX_DISTANCE = 1.1` (calibré empiriquement : docs pertinents ≈ 0.90-1.0, requête hors-sujet type "bonjour" ≥ 1.6), puis tronque au nombre demandé (3).

### `chatbot-service/context.js` et `db.js`

`context.js` (Redis) : `MAX_HISTORY_LENGTH = 10` messages, TTL 7 jours, clé `chat:context:{conversationId}`. Utilisé pour construire le prompt à chaque tour.
`db.js` (PostgreSQL) : `chat_conversations`/`chat_messages`, historique permanent, consultable via `GET /history/:userId`. Les deux sont écrits en parallèle à chaque tour (étape 7) — Redis pour la vitesse d'accès au prompt, Postgres pour la durabilité/consultation.

## Étape 7 — Le fine-tuning

### `chatbot-finetuning/notebook_unsloth_simple.py`

- **`r = 16`** : rang de la décomposition LoRA — plus c'est grand, plus le modèle peut apprendre de nuances, mais plus ça coûte de mémoire/temps. 16 est une valeur "légère", raisonnable pour un fine-tuning rapide sur un jeu de données petit.
- **`lora_alpha = 16`** : facteur d'échelle appliqué aux poids LoRA — ici égal à `r`, un ratio 1:1 assez standard qui évite de sur- ou sous-pondérer l'adaptation par rapport aux poids originaux du modèle.
- **`target_modules`** : q/k/v/o_proj + gate/up/down_proj — c'est-à-dire toutes les projections d'attention ET les couches du MLP (feed-forward) du transformer. Cibler plus de couches = plus de capacité d'adaptation, au prix de plus de paramètres entraînables.
- **`~58 millions de paramètres entraînables sur 7,25 milliards`** (~0.8%) : c'est le principe même de LoRA/QLoRA — on ne touche pas les poids originaux, on entraîne juste une petite matrice additive.
- **`learning_rate = 2e-4`** : valeur assez haute mais standard pour du QLoRA (les fine-tunes LoRA tolèrent des LR plus élevés qu'un fine-tuning complet, car peu de paramètres bougent).
- **`max_steps = 120`, `batch_size = 2`, `gradient_accumulation_steps = 4`** : batch effectif de 8, 120 steps = 960 exemples vus au total (avec répétitions si le dataset est plus petit). **C'est un entraînement volontairement court** — probablement pour tenir dans les contraintes de temps/GPU d'un Colab gratuit. C'est aussi la cause directe de la fragilité du function-calling qu'on a dû corriger côté prompt/serveur (Partie 4 du rapport d'architecture) : peu de steps → généralisation faible → le modèle reproduit bien les exemples vus quasi à l'identique, mais dérape sur des reformulations.
- **`load_in_4bit = True`** : quantification 4-bit du modèle de base pendant l'entraînement — réduit drastiquement l'empreinte mémoire GPU, indispensable pour fine-tuner un 7B sur un GPU grand public/Colab.

**Point faible à assumer directement** : le dataset d'entraînement lui-même (`erp_data`, la liste des exemples instruction/input/output) n'est présent dans **aucun fichier du dépôt** — il a été défini dans une cellule Colab non exportée. Si on te demande "combien d'exemples, quelle diversité" — tu ne peux pas répondre avec certitude depuis le code, et c'est important de le dire plutôt que d'inventer un chiffre.

### `chatbot-finetuning/Modelfile`

```
FROM /models/mistral-7b-instruct-v0.3.Q4_K_M.gguf
TEMPLATE """{{ .Prompt }}"""
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
PARAMETER stop "### Instruction:"
SYSTEM """Tu es l'assistant IA de l'ERP DataProtect..."""
```
- `FROM` : le modèle de base, au format GGUF (format de fichier optimisé pour l'inférence CPU/GPU via llama.cpp, sur lequel Ollama s'appuie), quantifié Q4_K_M (4 bits, un bon compromis taille/qualité).
- `TEMPLATE """{{ .Prompt }}"""` : **passthrough brut** — Ollama n'ajoute aucun formatage de chat automatique. Conséquence directe : le `SYSTEM` défini plus bas dans ce même fichier **n'est jamais réellement injecté dans le prompt final** (Ollama ne le rend que si le TEMPLATE le référence, ce qui n'est pas le cas ici). C'est pour ça que `ollama.js` reconstruit tout le prompt lui-même à chaque appel, plutôt que de compter sur le Modelfile.
- `temperature 0.7`, `num_ctx 4096` : valeurs par défaut du modèle, mais **toutes les deux surchargées par requête** dans `ollama.js` (0.2 et 4096 respectivement — ce n'est qu'une coïncidence que num_ctx soit la même valeur dans les deux endroits, ça a été corrigé aux deux niveaux séparément).
- `stop` : séquences qui font arrêter la génération — évite que le modèle continue à halluciner un tour de conversation suivant après sa réponse.

## Étape 8 — Le frontend

### `dataprotect-frontend/src/App.jsx`

Pas de `react-router-dom`. Navigation par `const [active, setActive] = useState(null)` (un identifiant de vue en string) + un gros `switch(active)` dans `renderContent()` qui retourne le bon composant. Cliquer sur un item du menu = `setActive("hr")`, ce qui redéclenche le rendu du switch.

Adaptation par rôle via `canAccess(module)` :
```js
const canAccess = (module) => {
  if (isAdmin) return true;
  if (isManager) return DEPT_MODULE[userDept] === module || module === "dashboard";
  return false; // un simple employé n'a jamais accès aux vues "module admin"
};
```
Combiné à un menu différent construit selon le rôle (`Sidebar`) : admin voit tout, manager voit son département + les items communs, employee voit un menu fixe restreint (accueil, mes tickets, congés, dépenses, profil).

### `dataprotect-frontend/src/ChatWidget.jsx`

```js
const res = await axios.post(`${API_URL}/api/chatbot/chat`,
  { query: q, userId, conversationId, userToken: token },
  { headers: { Authorization: `Bearer ${token}` }, timeout: 720000 }
);
```
`timeout: 720000` (12 minutes) — aligné avec le pire cas côté serveur (nginx/gateway). Gestion d'erreur minimale :
```js
} catch (err) {
  console.error('Chatbot request failed:', err);
  setMessages(prev => [...prev, { role: 'assistant', content: 'Erreur de connexion.' }]);
}
```
Un `catch` générique qui affiche toujours le même message quelle que soit la cause réelle (timeout, 500, 401, réseau coupé) — pratique pour l'utilisateur final (message simple) mais ça a compliqué le diagnostic pendant le développement (c'est justement ce message qu'on voyait à chaque bug, sans savoir lequel des multiples problèmes sous-jacents en était la cause).

## Étape 9 — Le pipeline DevSecOps

`.github/workflows/ci.yml`, déclenché sur push (`main`/`develop`) et pull request (`main`). 11 jobs :

1. **`code-analysis`** (bloquant) : ESLint, matrice sur 24 cibles (23 services + frontend)
2. **`sast-scan`** (bloquant) : SonarCloud + Snyk (`--severity-threshold=critical`)
3. **`dependency-scan`** (bloquant) : `npm audit --audit-level=critical`
4. **`unit-tests`** (mixte) : Jest sur auth (bloquant) et chatbot (`continue-on-error` — Ollama/ChromaDB indisponibles en CI, donc les tests ne peuvent pas tourner en conditions réelles), `node --check` sur la gateway
5. **`docker-build`** (bloquant, dépend de 2+3) : build de l'image de chaque service
6. **`container-scan`** (bloquant, dépend de 5) : Hadolint (lint du Dockerfile) + Trivy (CVE, bloque sur CRITICAL)
7. **`staging-deploy`** (bloquant, dépend de 6+4) : `docker-compose up` réel + Newman/Postman (login + 4 GET cross-domaine)
8. **`dast-scan`** (informatif, `continue-on-error`) : OWASP ZAP baseline scan
9. **`production`** : stub, aucune action réelle (juste un plan documenté)
10. **`monitoring-check`** : `docker-compose config --quiet` (bloquant sur la syntaxe), détection de présence prometheus/grafana/kibana (informatif)
11. **`pipeline-summary`** : résumé final, `if: always()`

**Pourquoi certains jobs sont bloquants et d'autres non** : la règle implicite est "bloquant si l'outil donne un résultat fiable et actionnable" (ESLint, npm audit, Trivy sur CRITICAL, Newman) vs "informatif si le résultat nécessite un contexte qu'on n'a pas en CI" (ZAP scan une app qui vient de démarrer avec des données de test, pas représentatives d'un vrai audit de sécu ; Jest chatbot ne peut pas vraiment tester le LLM sans Ollama).

## Étape 10 — Le monitoring

- **`monitoring/prometheus.yml`** : 9 jobs de scrape (`static_configs`, pas de service discovery) — les 23 microservices métier + gateway + auth + chatbot + cAdvisor (métriques conteneurs) + RabbitMQ (plugin Prometheus). `scrape_interval: 15s`.
- **`monitoring/filebeat/filebeat.yml`** : collecte les logs de **tous** les conteneurs Docker de l'hôte (`/var/lib/docker/containers/*/*.log`), tague chaque événement `application: erp-dataprotect`, envoie à Logstash (port 5044).
- **`monitoring/logstash/logstash.conf`** : reçoit du Beats (5044) et du JSON brut en TCP (5000, dispo pour du logging applicatif direct si besoin), normalise le timestamp, écrit dans Elasticsearch avec un index journalier `erp-logs-YYYY.MM.dd`.
- **`monitoring/grafana/provisioning/`** : une datasource Prometheus provisionnée, un provider de dashboards configuré — mais **aucun dashboard JSON n'existe réellement dans le repo**. Le monitoring est câblé mais pas exploité visuellement.

**Point faible à assumer** : aucune métrique métier custom (`Counter`/`Histogram`/`Gauge`) nulle part dans le code — seulement les métriques par défaut de `prom-client` (CPU/mémoire process). On ne peut pas dire "combien de tickets créés par heure" depuis Prometheus, seulement "combien de CPU utilise le service qui gère les tickets".

---

# PARTIE 3 BIS — FONCTIONS ESSENTIELLES PAR FICHIER

## 📄 chatbot-service/server.js

```
├── Fonction: getUserContext(req)
│   ├── Rôle : parse le header X-User-Context posé par la gateway en objet JS
│   ├── Appelée par : le handler POST /chat (tout début)
│   ├── Appelle : JSON.parse
│   ├── Lignes clés : const raw = req.headers['x-user-context']; return JSON.parse(raw);
│   └── Pourquoi important : sans elle, aucune requête ne sait QUI pose la question → impossible de savoir quel employee_id résoudre, quel token utiliser pour exécuter une fonction
│
├── Fonction: formatFunctionResultMessage(functionName, functionResult)
│   ├── Rôle : transforme le JSON brut renvoyé par le microservice en phrase française lisible
│   ├── Appelée par : le handler /chat, après exécution réussie d'une fonction
│   ├── Appelle : rien (pur switch/case)
│   ├── Lignes clés : case 'create_ticket': return `${backendMessage} Numéro de ticket : ${entity.ticket_number}...`
│   └── Pourquoi important : remplace un second appel LLM qui existait avant (coûtait 65-80s de plus) — sans elle, soit on affiche du JSON brut à l'utilisateur, soit on repaie le coût d'un appel LLM inutile
│
├── Fonction: extractFunctionCall(text)
│   ├── Rôle : extrait et valide un bloc ```json depuis une réponse LLM brute
│   ├── Appelée par : le flux principal (1er essai) ET le tier 2 (retry)
│   ├── Appelle : JSON.parse, functionHandler.FUNCTION_MAP (vérifie que le nom existe)
│   ├── Lignes clés : const match = text.match(/```json\s*([\s\S]*?)(?:```|$)/i); ... if (parsed.function && FUNCTION_MAP[parsed.function]) return parsed;
│   └── Pourquoi important : c'est LE point de passage obligé entre "texte du LLM" et "appel de fonction exécutable" — sans validation ici, un JSON malformé planterait executeFunction ou exécuterait une fonction inexistante
│
├── Fonction: looksLikeActionRequest(query)
│   ├── Rôle : heuristique large — la question ressemble-t-elle à une demande d'action ?
│   ├── Appelée par : décide si on déclenche le tier 2 (retry sans historique)
│   ├── Appelle : ACTION_INTENT_PATTERN.test(query) (regex)
│   ├── Lignes clés : /\b(crée|ajoute|soumet|liste|montre|combien|quels?)\b.{0,40}\b(ticket|congé|employé...)\b/i
│   └── Pourquoi important : sans elle, le tier 2 se déclencherait sur TOUT échec (même "quel temps fait-il ?"), gaspillant un appel LLM de 300s pour rien
│
├── Fonction: isFunctionCoherentWithQuery(functionCall, query)
│   ├── Rôle : détecte une incohérence entre le verbe de la question et le type de fonction choisie par le LLM
│   ├── Appelée par : juste après extractFunctionCall, sur le 1er essai ET sur le retry
│   ├── Appelle : CONSULTATION_VERB_PATTERN.test, CREATION_VERB_PATTERN.test
│   ├── Lignes clés : if (queryLooksConsultation && isCreationFunction) return false;
│   └── Pourquoi important : SANS elle, "Liste les employés" qui déclenche par erreur create_ticket serait exécuté tel quel — un vrai ticket serait créé pour une simple question de consultation. Bug réel observé et corrigé pendant le développement.
│
├── Fonction: detectConsultationFallback(query)
│   ├── Rôle : tier 3 — construit un appel de fonction SANS LLM, uniquement pour les consultations
│   ├── Appelée par : le handler /chat, en tout dernier recours (après échec tier 1 ET tier 2)
│   ├── Appelle : CONSULTATION_ENTITY_MAP.find, CREATION_VERB_PATTERN.test (garde-fou)
│   ├── Lignes clés : if (CREATION_VERB_PATTERN.test(query)) return null; const match = CONSULTATION_ENTITY_MAP.find(...)
│   └── Pourquoi important : filet de sécurité final — garantit qu'une question de consultation simple ("montre mes tickets") ne renvoie JAMAIS un échec pur, même si le LLM a totalement raté les deux premiers essais
│
└── Variables/constantes critiques :
    ├── ACTION_INTENT_PATTERN — regex large (verbes + entités), déclenche le tier 2
    ├── CREATION_VERB_PATTERN / CONSULTATION_VERB_PATTERN — sous-ensembles isolés, utilisés pour la cohérence
    ├── CONSULTATION_ENTITY_MAP — tableau [{pattern, function}] pour le tier 3
    └── API_GATEWAY_URL — cible de tous les appels functionHandler.executeFunction
```

## 📄 chatbot-service/ollama.js

```
├── Fonction: chat(prompt, options)
│   ├── Rôle : construit le prompt final et appelle l'API Ollama /api/generate
│   ├── Appelée par : server.js (1er essai ET retry, avec des `prompt` différents)
│   ├── Appelle : axios.post vers Ollama, isSmallTalk
│   ├── Lignes clés : const instructions = smallTalk ? SMALL_TALK_INSTRUCTIONS : FUNCTION_CALLING_INSTRUCTIONS; ... temperature: options.temperature || 0.2, num_ctx: options.num_ctx || 4096
│   └── Pourquoi important : point de passage unique vers le LLM — toute la logique de format de prompt, température, taille de contexte est centralisée ici
│
├── Fonction: isSmallTalk(query)
│   ├── Rôle : détecte si la question est une pure formule de politesse
│   ├── Appelée par : chat(), pour choisir quelles instructions injecter
│   ├── Appelle : SMALL_TALK_PATTERN.test
│   ├── Lignes clés : /^(bonjour|salut|merci|ok|d'accord)[\s!.,?]*$/i (liste FERMÉE, pas de mots-clés ouverts)
│   └── Pourquoi important : sans elle, chaque "bonjour" injecterait ~1000 tokens d'instructions function-calling inutiles → prompt plus long, réponse plus lente, risque accru de confusion du modèle
│
└── Variables/constantes critiques :
    ├── FUNCTION_CALLING_INSTRUCTIONS — le prompt système complet (voir Étape 6), généré en partie dynamiquement depuis FUNCTION_MAP
    ├── SMALL_TALK_PATTERN — regex deny-list, volontairement fermée (faux négatif = coût léger, faux positif = risque de rater une vraie action)
    ├── FUNCTION_PARAM_DOCS — dictionnaire nom de fonction → description des paramètres attendus, injecté dans les instructions
    └── temperature: 0.2, num_ctx: 4096, timeout: 300000 — les 3 réglages issus directement du travail de fiabilisation
```

## 📄 chatbot-service/functions.js

```
├── Fonction: resolveEmployeeId(userEmail, userToken, apiGatewayUrl)
│   ├── Rôle : trouve l'UUID employee_id correspondant à l'email de l'utilisateur connecté
│   ├── Appelée par : executeFunction, uniquement pour submit_leave_request
│   ├── Appelle : axios.get(`${apiGatewayUrl}/api/hr/employees`, { params: { search: userEmail } })
│   ├── Lignes clés : const match = employees.find(e => e.email === userEmail); return match?.employee_id || null;
│   └── Pourquoi important : le LLM ne peut PAS connaître cet ID (différent du user_id du JWT) — sans cette résolution serveur, il faudrait faire confiance à un ID halluciné par le modèle, risque de sécurité/intégrité direct
│
├── Fonction: executeFunction(functionCall, userToken, apiGatewayUrl, userContext)
│   ├── Rôle : transforme un {function, parameters} en vrai appel HTTP vers l'API Gateway
│   ├── Appelée par : server.js, Étape 6 du pipeline /chat
│   ├── Appelle : resolveEmployeeId (conditionnellement), axios(config)
│   ├── Lignes clés : const { method, path } = FUNCTION_MAP[functionName]; ... url: `${apiGatewayUrl}${path}`, headers: { Authorization: `Bearer ${userToken}` }
│   └── Pourquoi important : c'est le SEUL endroit où le chatbot touche réellement le système — utilise le token de l'utilisateur (pas un token admin), donc hérite du RBAC existant automatiquement
│
└── Variables/constantes critiques :
    ├── FUNCTION_MAP — dictionnaire nom → {method, path}, la SOURCE DE VÉRITÉ de ce que le chatbot peut faire (15 entrées)
    └── FUNCTIONS_REQUIRING_EMPLOYEE_ID — Set contenant juste 'submit_leave_request', déclenche resolveEmployeeId
```

## 📄 chatbot-service/rag.js

```
├── Fonction: searchRelevantDocs(query, nResults)
│   ├── Rôle : recherche sémantique dans la documentation ERP indexée
│   ├── Appelée par : server.js, Étape 1 du pipeline /chat
│   ├── Appelle : collection.query (ChromaDB), initialize() si pas encore connecté
│   ├── Lignes clés : const filteredDocs = docs.filter(d => !EXCLUDED_CATEGORIES.includes(d.category)).filter(d => d.distance <= MAX_DISTANCE).slice(0, nResults);
│   └── Pourquoi important : sans le filtre de distance, TOUTE question (même "bonjour") recevrait 3 documents ERP injectés dans le prompt — gaspillage de tokens et confusion du modèle (observé et corrigé pendant le développement)
│
└── Variables/constantes critiques :
    ├── MAX_DISTANCE = 1.1 — seuil calibré empiriquement (pertinent ≈0.9-1.0, hors-sujet ≥1.6)
    ├── EXCLUDED_CATEGORIES — catégories "meta" (chatbot/devops/docker/monitoring/infrastructure/api) toujours exclues
    └── collection — instance ChromaDB, initialisée avec embeddingFunction: new DefaultEmbeddingFunction() (sans ça, .query() plante — bug corrigé pendant le développement)
```

## 📄 services/auth/auth/server.js

```
├── Route: POST /login
│   ├── Rôle : vérifie email+password, renvoie un JWT
│   ├── Appelée par : le frontend (LoginPage), en tout premier point d'entrée du système
│   ├── Appelle : loginLimiter (middleware), bcrypt.compare, jwt.sign
│   ├── Lignes clés : const dummyHash = '$2b$12$invalid...'; const valid = await bcrypt.compare(data.password, storedHash);
│   └── Pourquoi important : sans la comparaison au hash factice même quand l'utilisateur n'existe pas, le temps de réponse trahirait l'existence d'un compte (faille de sécurité classique)
│
├── Route: POST /register
│   ├── Rôle : crée un compte + connecte immédiatement
│   ├── Appelle : bcrypt.hash(password, 12), jwt.sign
│   ├── Lignes clés : role: z.enum(['admin','manager','employee']).default('employee')
│   └── Pourquoi important : seul point de création de compte "self-service" (les autres passent par /admin/create)
│
├── Route: GET /verify
│   ├── Rôle : valide un token et renvoie son contenu décodé
│   ├── Appelée par : en théorie la gateway (en pratique, la gateway a sa propre logique via shared/middleware/auth.js — cette route sert plutôt pour du debug/intégrations externes)
│   └── Pourquoi important : point d'entrée externe pour vérifier un token sans dupliquer la logique JWT
│
├── Route: POST /change-password
│   ├── Rôle : change le mot de passe d'un utilisateur déjà connecté
│   ├── Appelle : jwt.verify (inline, pas le middleware partagé !), bcrypt.compare, bcrypt.hash
│   └── Pourquoi important : exige l'ancien mot de passe — évite qu'un attaquant avec juste un token volé (session ouverte) puisse changer le mot de passe sans le connaître
│
├── Route: POST /forgot-password
│   ├── Rôle : initie une réinitialisation par email
│   ├── Appelle : crypto.randomBytes(32), transporter.sendMail (nodemailer/Gmail)
│   ├── Lignes clés : res.json({ success: true, message: '...' }); if (!r.rows.length ...) return; (répond AVANT de savoir si l'email existe)
│   └── Pourquoi important : répondre après aurait permis de déduire l'existence d'un compte via le temps de réponse ou le contenu — anti-énumération
│
└── Route: POST /reset-password
    ├── Rôle : finalise la réinitialisation avec le token reçu par email
    ├── Appelle : bcrypt.hash
    ├── Lignes clés : WHERE reset_token = $1 AND reset_token_expires > NOW()
    └── Pourquoi important : le token expire après 1h — sans cette contrainte, un token intercepté resterait valide indéfiniment
```

## 📄 shared/middleware/auth.js

```
├── Fonction: verifyToken(req, res, next)
│   ├── Rôle : authentifie la requête (2 modes : X-User-Context ou Authorization Bearer)
│   ├── Appelée par : quasiment toutes les routes de tous les microservices (as middleware)
│   ├── Appelle : JSON.parse (mode 1) ou jwt.verify (mode 2)
│   ├── Lignes clés : if (userContext) { req.user = JSON.parse(userContext); return next(); }
│   └── Pourquoi important : c'est LE gardien d'entrée — sans lui, n'importe qui pourrait appeler n'importe quelle route sans authentification
│
├── Fonction: requireDeptOrAdmin(...depts)
│   ├── Rôle : factory de middleware — autorise un département donné + les admins
│   ├── Appelée par : la plupart des routes de mutation (POST/PATCH/DELETE) des microservices
│   ├── Appelle : requireDepartment (alias direct)
│   ├── Lignes clés : if (req.user.role === 'admin' || depts.includes(req.user.department)) return next();
│   └── Pourquoi important : LE mécanisme RBAC principal du projet — sans lui, un employé IT pourrait modifier des budgets Finance
│
└── Variables/constantes critiques :
    ├── _SECRET — le secret JWT, avec fallback codé en dur 'dev_secret_only_never_in_prod' (protégé seulement par un check NODE_ENV === 'production')
    └── requireRole — existe mais N'EST UTILISÉ NULLE PART dans le projet (code mort, à savoir si on te le demande)
```

## 📄 services/api-gateway/server.js

```
├── Fonction: addUserContext(proxyReqOpts, srcReq)
│   ├── Rôle : décorateur de proxy — transforme le JWT vérifié en header interne de confiance
│   ├── Appelée par : express-http-proxy, automatiquement, sur CHAQUE requête proxifiée vers un microservice
│   ├── Appelle : JSON.stringify(srcReq.user)
│   ├── Lignes clés : proxyReqOpts.headers['X-User-Context'] = JSON.stringify(srcReq.user); delete proxyReqOpts.headers['authorization'];
│   └── Pourquoi important : sans lui, soit le JWT brut circulerait en interne (risque si un microservice est compromis, il pourrait le réutiliser ailleurs), soit les microservices ne sauraient pas qui fait la requête
│
├── Route: POST /api/chatbot/chat (handler custom, pas le proxy générique)
│   ├── Rôle : relaie la requête chatbot avec un timeout spécial
│   ├── Appelle : axios.post vers chatbot-service, timeout: 660000
│   └── Pourquoi important : le proxy générique (timeout 5000ms) tuerait systématiquement une requête chatbot avant que le LLM ait fini — obligé de sortir du système de proxy générique pour ce cas précis
│
└── Variables/constantes critiques :
    ├── services — objet {path: url} pour les 20 microservices, bouclé pour enregistrer les proxies automatiquement
    ├── allowedOrigins — liste blanche CORS, comparaison EXACTE (contrairement à auth-service qui fait un .includes())
    └── CHATBOT_SERVICE_URL — cible des 5 routes chatbot custom
```

## 📄 services/it/helpdesk/server.js (modèle type)

```
├── Fonction: rbacScope(user, conds, params, {managerFilter, employeeFilter})
│   ├── Rôle : ajoute une condition SQL de scoping selon le rôle de l'utilisateur
│   ├── Appelée par : GET /stats uniquement dans ce fichier (dupliquée dans d'autres services)
│   ├── Lignes clés : if (user.role === 'admin') return; const filter = user.role === 'manager' ? managerFilter : employeeFilter;
│   └── Pourquoi important : permet de restreindre les données visibles SANS dupliquer toute la requête SQL pour chaque rôle
│
├── Route: POST / (création de ticket)
│   ├── Rôle : n'importe quel utilisateur authentifié crée un ticket
│   ├── Appelle : ticketSchema.parse (Zod)
│   ├── Lignes clés : const ticketNumber = `HELP-${Date.now()}`; ... status='open', created_by=req.user.id
│   └── Pourquoi important : c'est la route appelée par le chatbot pour create_ticket — génère le numéro de ticket côté serveur, jamais confié au client (ni au LLM)
│
└── Variables/constantes critiques :
    ├── ticketSchema/assignSchema/resolveSchema — 3 schémas Zod distincts pour 3 opérations différentes
    └── Object.keys(FUNCTION_MAP) côté chatbot pointe vers /api/it/helpdesk (création) et /api/it/helpdesk/my-tickets (liste) — PAS /api/it/helpdesk (GET /) qui est réservé IT/admin
```

## Autres microservices — uniquement ce qui diffère

- **`hr-leave-requests`** : fonction de détection de chevauchement de dates (comparaison de plages `start_date`/`end_date` contre les demandes existantes non rejetées/annulées) — absente partout ailleurs.
- **`hr-recruitment`** : `VALID_TRANSITIONS` — objet de state machine (`{new: ['screening','rejected'], screening: [...], ...}`) vérifié à chaque `PATCH /:id/status` — seul service avec ce pattern.
- **`ops-inventory`** : `POST /:id/movement` utilise un vrai `BEGIN/COMMIT/ROLLBACK` — seul endroit du projet avec une transaction SQL explicite.
- **`ops-workflows`** : calcul de la prochaine étape par `MIN(order)` parmi les steps restants du workflow — logique de machine à états générique (pas liée à une entité métier précise, contrairement à recruitment).
- **`finance-invoices`** : calcul serveur de `tax_amount = amount * tax_rate` et `total_amount = amount + tax_amount` — jamais confié au client.
- **`finance-reports`** : agrégation multi-tables en lecture seule (`Promise.all` de requêtes indépendantes sur budgets/expenses/payments/invoices) pour construire un dashboard — le seul endroit qui "lit" plusieurs domaines à la fois côté SQL direct.
- **`hr-employees`** : masquage conditionnel de la colonne `salary` directement dans le `SELECT` (pas en post-traitement) selon le rôle de l'appelant.

---

# PARTIE 4 — QUESTIONS DE SOUTENANCE PROBABLES

## Architecture et sécurité (10)

**1. Pourquoi une architecture microservices plutôt qu'un monolithe pour ce projet ?**
Isolation par domaine métier, déploiement/scaling indépendants en théorie, et démonstration de compétence sur une architecture distribuée. Contrepartie assumée : complexité opérationnelle (36 conteneurs), pas d'appel inter-services (chaque service est isolé), donc la composition cross-domaine se fait à la gateway ou par accès direct base de données.

**2. Comment un microservice sait-il qui fait la requête, sans revérifier le JWT à chaque fois ?**
Via le header `X-User-Context`, posé par la gateway après vérification du JWT une seule fois. Le microservice fait confiance à ce header parce qu'il n'est jamais exposé publiquement — seule la gateway peut l'atteindre en interne.

**3. Que se passe-t-il si un microservice est compromis — peut-il usurper l'identité de n'importe quel utilisateur ?**
Oui, en théorie — s'il peut injecter son propre `X-User-Context`, ce header n'est pas signé, juste un JSON parsé sans vérification cryptographique. La sécurité repose sur l'isolation réseau (services non exposés) plutôt que sur une preuve cryptographique du contenu du header. C'est une limite réelle à assumer.

**4. Pourquoi pas de refresh token ?**
Choix de simplicité pour ce projet — la session dure 8h puis expire, l'utilisateur se reconnecte. Un refresh token ajouterait une complexité (stockage, rotation, révocation) non implémentée ici. Limite connue.

**5. `requireDeptOrAdmin` distingue-t-il un manager d'un simple employé au sein du même département ?**
Non — le middleware partagé ne regarde que `role === 'admin'` OU `department` correspond. La distinction manager/employé, quand elle existe, est faite à la main dans chaque service (ex. `hr-employees` a 3 niveaux de scoping en handler).

**6. Comment sont protégés les mots de passe ?**
bcrypt avec 12 rounds de salage, comparaison protégée contre les attaques temporelles (hash factice comparé même si l'utilisateur n'existe pas).

**7. Le secret JWT a un fallback codé en dur dans le code — n'est-ce pas une faille ?**
Oui potentiellement, mais protégé par un `process.exit(1)` si `NODE_ENV === 'production'` et que `JWT_SECRET` est absent — le fallback n'est atteignable qu'en développement. C'est une défense-en-profondeur qui dépend d'une bonne configuration au déploiement, pas une garantie absolue au niveau du code.

**8. Comment le CORS est-il configuré, et y a-t-il une incohérence ?**
La gateway et l'auth-service ont une liste blanche d'origines (exacte pour la gateway, par sous-chaîne pour auth-service — légère incohérence). Le chatbot-service, lui, a un CORS totalement ouvert (`cors()` sans configuration) — incohérence assumée, à corriger si on te la pointe.

**9. Où est faite la validation des données côté serveur ?**
Zod, dans 21 fichiers sur les 21 microservices métier + auth (chatbot exclu). Chaque service définit ses propres schémas et mappe les `ZodError` en HTTP 400 avec le détail des champs invalides.

**10. Qu'est-ce qui empêche un employé de voir le salaire d'un collègue ?**
La colonne `salary` est conditionnellement retirée du `SELECT` SQL lui-même dans `hr-employees`, selon le rôle de l'appelant — pas juste masquée côté frontend (qui serait contournable en appelant l'API directement).

## Chatbot / LLM / RAG (10)

**11. Pourquoi un modèle local (Ollama) plutôt qu'une API comme OpenAI ?**
Souveraineté des données sensibles (RH, Finance), coût nul par requête, indépendance vis-à-vis d'un fournisseur externe, et démonstration de compétence en fine-tuning. Contrepartie : lenteur (60-300s par réponse sur CPU) et fiabilité moindre qu'un gros modèle propriétaire.

**12. Comment fonctionne le RAG dans ce projet ?**
ChromaDB stocke 35 documents de documentation ERP, vectorisés avec un modèle d'embedding local (MiniLM-L6-v2 via `DefaultEmbeddingFunction`). À chaque question, on cherche les documents les plus proches sémantiquement (distance vectorielle), on filtre ceux en-dessous d'un seuil de pertinence (1.1), et on injecte les 3 meilleurs dans le prompt.

**13. Comment le seuil de distance 1.1 a-t-il été choisi ?**
Empiriquement, en observant les distances réelles retournées : les documents vraiment pertinents pour une question ERP tombent autour de 0.9-1.0, tandis qu'une question hors-sujet (comme "bonjour") ne descend jamais sous 1.6. 1.1 sépare proprement les deux.

**14. Comment le chatbot déclenche-t-il une action (function-calling) sans API function-calling native ?**
On demande au modèle, via le prompt système, de répondre par un bloc ```json contenant `{function, parameters}` quand la question est une demande d'action. Ce n'est pas le format natif de Mistral ([TOOL_CALLS]) — le modèle a été fine-tuné spécifiquement sur ce format custom.

**15. Le function-calling est-il fiable à 100% ?**
Non — le fine-tuning est léger (120 steps), donc le modèle rate parfois le format ou choisit la mauvaise fonction. D'où un mécanisme à 3 niveaux : validation de cohérence, retry sans historique, puis fallback déterministe pour les consultations simples.

**16. Qu'est-ce que la "contamination par l'historique" observée pendant le développement ?**
Quand un premier essai échoue dans une conversation (le modèle répond en prose au lieu de JSON), cet échec reste dans l'historique Redis. Le modèle, en voyant sa propre réponse précédente, a tendance à répéter ce même comportement sur les tours suivants — un effet d'ancrage. Le tier 2 (retry sans historique) casse ce cercle vicieux.

**17. Pourquoi la température est-elle à 0.2 et pas plus haute ?**
Pour une tâche à sortie structurée (générer exactement le bon format JSON), on veut que le modèle reproduise fidèlement le pattern appris, pas qu'il improvise. Une température basse favorise la reproduction fidèle plutôt que la créativité.

**18. Que se passe-t-il si le modèle choisit une fonction incohérente avec la question ?**
`isFunctionCoherentWithQuery` compare le verbe de la question (consultation vs création) au préfixe de la fonction choisie (`get_*` vs `create_*`/`submit_*`). En cas d'incohérence claire, l'appel est rejeté et on retombe sur le retry/fallback plutôt que d'exécuter une mauvaise action.

**19. Le chatbot peut-il contourner les droits d'accès (RBAC) d'un utilisateur ?**
Non — il utilise le JWT de l'utilisateur qui pose la question pour exécuter la fonction, via l'API Gateway normale. Il hérite donc automatiquement de toutes les restrictions RBAC déjà en place.

**20. Pourquoi num_ctx est passé à 4096 et pas plus (8192) ?**
4096 donne assez de marge pour le prompt le plus lourd observé (~1800 tokens) tout en laissant de la place pour la réponse, sans exploser la mémoire/le temps de traitement (le temps de lecture du prompt croît linéairement avec num_ctx utilisé).

## DevSecOps (5)

**21. Combien de jobs dans le pipeline CI/CD, et lesquels sont bloquants ?**
11 jobs. Bloquants : lint, SAST (Sonar+Snyk), dependency scan, tests auth/gateway, docker build, container scan (Hadolint+Trivy), staging deploy (Newman). Informatifs : tests chatbot (Ollama absent en CI), DAST (ZAP), présence du monitoring.

**22. Pourquoi le scan DAST (OWASP ZAP) n'est-il pas bloquant ?**
Un scan baseline sur une stack qui vient de démarrer avec des données de test n'est pas représentatif d'un vrai audit de sécurité — il sert d'alerte informative (rapport archivé), pas de gate qualité fiable à ce stade.

**23. Quels outils de sécurité sont intégrés dans le pipeline ?**
SonarCloud (SAST), Snyk (SCA/dépendances), npm audit, Hadolint (lint Dockerfile), Trivy (CVE image), OWASP ZAP (DAST). Absents : scanner de secrets (Gitleaks), scanner IaC (Checkov), génération de SBOM.

**24. Le job "production" fait-il un vrai déploiement ?**
Non, c'est un stub qui documente un pipeline Terraform/AWS/ECS prévu mais non implémenté — aucun secret AWS n'est configuré.

**25. Comment sont testées les interactions entre services en CI ?**
Le job `staging-deploy` lance un vrai `docker-compose up` puis exécute une collection Newman/Postman qui teste : login, puis 4 GET cross-domaine (IT, HR, Finance, Operations) — un test end-to-end sur la stack réelle, pas des mocks.

## Choix techniques et limites (5)

**26. Pourquoi pas de router React (`react-router-dom`) ?**
Choix pragmatique : ~12 vues gérées par un simple `switch` sur un état — pour ce volume, un router ajouterait une dépendance sans bénéfice réel (pas de deep-linking nécessaire pour un ERP interne). Contrepartie : pas d'URL partageable, retour à la vue par défaut au rafraîchissement.

**27. Quelle est la plus grande limite du projet actuellement ?**
Deux candidates fortes : (1) la fiabilité intrinsèque du function-calling du chatbot, qui dépend d'un fine-tuning léger dont le dataset n'est même plus disponible pour ré-entraîner/améliorer ; (2) l'absence totale de gestion de l'expiration de session côté frontend (401 non géré globalement).

**28. Si c'était à refaire, qu'est-ce qui changerait ?**
Centraliser la gestion d'authentification frontend (intercepteur HTTP unique au lieu de répéter le header partout), ajouter un refresh token, versionner le dataset de fine-tuning, ajouter des métriques métier custom en Prometheus.

**29. Pourquoi ChromaDB et pas une extension PostgreSQL comme pgvector, vu que Postgres est déjà utilisé ?**
ChromaDB offre une API de recherche vectorielle prête à l'emploi avec gestion d'embeddings intégrée, plus simple à mettre en place rapidement pour ce volume (35 documents) qu'une extension à configurer manuellement — un choix de vitesse de développement plutôt que d'optimisation d'infrastructure.

**30. Le projet est-il prêt pour la production telle quelle ?**
Non, et il faut le dire clairement : pas de gestion de session expirée côté frontend, healthchecks Docker quasi absents (1 seul sur 36), pas de dashboards Grafana réels malgré le provisioning, job de déploiement production non implémenté, secret JWT avec fallback dev. C'est un projet de démonstration technique complet et fonctionnel, pas un système prêt à héberger de vraies données d'entreprise sans travail additionnel.

---

# PARTIE 5 — GLOSSAIRE TECHNIQUE

- **Middleware** : fonction qui s'exécute entre la réception d'une requête HTTP et son traitement final, capable de la modifier, la bloquer, ou passer la main (`next()`). Exemple : `verifyToken`.
- **JWT (JSON Web Token)** : jeton signé cryptographiquement contenant des informations (ici : id, rôle, département, email), utilisé pour prouver l'identité sans repasser par la base à chaque requête.
- **bcrypt** : algorithme de hachage de mots de passe volontairement lent (paramétrable via "rounds"), conçu pour résister au brute-force même si la base de données fuite.
- **RBAC (Role-Based Access Control)** : contrôle d'accès basé sur le rôle (et ici, aussi le département) de l'utilisateur plutôt que sur des permissions individuelles.
- **QLoRA (Quantized Low-Rank Adaptation)** : technique de fine-tuning qui n'entraîne qu'une petite matrice additive (LoRA) sur un modèle chargé en mémoire réduite (quantifié 4-bit), au lieu de ré-entraîner tous les poids — beaucoup moins gourmand en ressources.
- **RAG (Retrieval-Augmented Generation)** : technique consistant à chercher des documents pertinents dans une base externe et à les injecter dans le prompt d'un LLM, pour qu'il réponde avec des informations à jour/spécifiques qu'il n'a pas apprises à l'entraînement.
- **Embeddings** : représentation numérique (vecteur) d'un texte, positionnée dans un espace où les textes de sens proche sont géométriquement proches — base de toute recherche sémantique.
- **ChromaDB** : base de données vectorielle, spécialisée dans le stockage et la recherche par similarité d'embeddings.
- **Function-calling** : capacité (ici simulée par prompt engineering, pas nativement supportée par le modèle fine-tuné) d'un LLM à indiquer qu'il faut exécuter une action précise avec des paramètres structurés, plutôt que de répondre en texte libre.
- **Fine-tuning** : ré-entraînement (partiel ou complet) d'un modèle pré-entraîné sur un jeu de données spécifique, pour le spécialiser sur une tâche/domaine.
- **GGUF** : format de fichier optimisé pour l'inférence de modèles de langage sur CPU/GPU, utilisé par llama.cpp/Ollama.
- **Quantification (4-bit, Q4_K_M)** : réduction de la précision numérique des poids d'un modèle (de 16/32 bits à 4 bits ici) pour diminuer sa taille et accélérer l'inférence, au prix d'une petite perte de qualité.
- **Healthcheck (Docker)** : commande périodique que Docker exécute dans un conteneur pour déterminer s'il est réellement fonctionnel (pas juste démarré) — permet à `depends_on: condition: service_healthy` d'attendre qu'un service soit VRAIMENT prêt.
- **Volume Docker** : espace de stockage persistant, externe au système de fichiers éphémère du conteneur — sans lui, toute donnée écrite disparaît au redémarrage du conteneur.
- **Schéma PostgreSQL** : espace de nommage à l'intérieur d'une même base de données, permettant de regrouper des tables logiquement (ici, un schéma par domaine métier) sans créer plusieurs bases séparées.
- **Reverse proxy** : serveur qui reçoit les requêtes externes et les redirige vers le bon service interne (ici nginx, qui redirige tout `/api/` vers la gateway).
- **CORS (Cross-Origin Resource Sharing)** : mécanisme de sécurité du navigateur qui bloque par défaut les requêtes JavaScript vers un domaine différent de celui de la page, sauf autorisation explicite du serveur cible.
- **Rate limiting** : limitation du nombre de requêtes qu'un client peut faire dans une fenêtre de temps donnée, pour se protéger du brute-force/abus.
- **SAST (Static Application Security Testing)** : analyse du code source (sans l'exécuter) pour détecter des vulnérabilités.
- **DAST (Dynamic Application Security Testing)** : analyse de sécurité sur une application en cours d'exécution, en lui envoyant de vraies requêtes.
- **SCA (Software Composition Analysis)** : analyse des dépendances tierces (librairies) pour détecter des vulnérabilités connues (CVE).
- **CVE (Common Vulnerabilities and Exposures)** : identifiant standardisé d'une vulnérabilité de sécurité connue et documentée publiquement.
- **Prometheus** : système de collecte de métriques par "scrape" (interrogation périodique d'un endpoint `/metrics`), stockées en série temporelle.
- **Grafana** : outil de visualisation de métriques (dashboards), généralement branché sur Prometheus.
- **ELK Stack (Elasticsearch, Logstash, Kibana)** : suite pour centraliser, traiter et visualiser des logs — Elasticsearch stocke/indexe, Logstash transforme, Kibana visualise.
- **Filebeat** : agent léger qui collecte des logs (ici, ceux de tous les conteneurs Docker) et les transmet à Logstash.
- **Zod** : librairie de validation de schémas TypeScript/JavaScript, utilisée ici pour valider le corps des requêtes HTTP.
- **API Gateway** : point d'entrée unique qui centralise l'authentification, le routage et parfois la limitation de débit avant de distribuer les requêtes vers les microservices internes.
- **Microservice** : service applicatif autonome, responsable d'un domaine fonctionnel limité, déployé et exécuté indépendamment des autres.
