# DataProtect ERP — Rapport d'architecture technique

Document de référence factuel pour la rédaction du Chapitre 5 (Réalisation et Résultats). Généré par analyse directe du code source du dépôt à la date du rapport. Chaque section correspond à une partie du système ; les extraits de code sont volontairement courts (signatures, extraits clés), pas des copies intégrales de fichiers.

---

## Sommaire

1. Cartographie des microservices
2. Architecture frontend
3. Infrastructure Docker
4. Sécurité implémentée
5. Assistant conversationnel (chatbot-service)
6. Fine-tuning du modèle LLM
7. Pipeline DevSecOps
8. Monitoring & observabilité
9. Base de données PostgreSQL
10. Problèmes résolus durant le développement

---

## 1. Cartographie des microservices

Les 20 microservices métier partagent le même squelette architectural :
- Express + `helmet()` + `express.json({ limit: '10kb' })`
- Middlewares partagés (`shared/middleware/`) : `db.js` (pool `pg` unique), `auth.js` (`verifyToken`, `requireRole`, `requireDepartment`/`requireDeptOrAdmin`, `asyncHandler`, `errorHandler`), `metrics.js` (`metricsHandler` Prometheus, monté sur `GET /metrics` **sans** authentification)
- `GET /health` non authentifié sur chacun
- Validation **Zod** sur les endpoints de mutation (POST/PATCH sensibles)
- **Aucun appel HTTP inter-services** trouvé dans les 20 `server.js` (confirmé par grep global `axios|fetch(|http.request`) — chaque service est un propriétaire de données isolé ; toute composition inter-domaines passe soit par l'API Gateway (URLs des 20 services en variables d'environnement), soit par des `JOIN` SQL directs quand les tables partagent la même base Postgres (ex. HR services joints à `hr_schema.employees`)

### 1.1 IT (5 services)

| Service | Port | Endpoints clés | Tables | Zod |
|---|---|---|---|---|
| **it-helpdesk** | 3101 | `GET /`, `/stats`, `/my-tickets`, `/:id` ; `POST /`, `/:id/assign`, `/:id/resolve`, `/:id/close` ; `PATCH /:id` | `it_schema.helpdesk_tickets` | `ticketSchema`, `assignSchema`, `resolveSchema` |
| **it-user-accounts** | 3102 | `GET /`, `/:id` ; `POST /`, `/:id/reset-password` ; `PATCH /:id` ; `POST /:id/activate`, `/:id/deactivate` | `it_schema.user_accounts` | `userSchema`, `passwordSchema` |
| **it-equipment** | 3103 | `GET /`, `/:id`, `/warranty-expiring` ; `POST /` ; `PATCH /:id`, `/:id/assign`, `/:id/unassign` ; `DELETE /:id` | `it_schema.equipment` | `equipmentSchema` |
| **it-monitoring** | 3104 | `GET /dashboard`, `/monitoring/status`, `/alerts` ; `POST /monitoring/status`, `/alerts` ; `PATCH /alerts/:id/acknowledge`, `/resolve` | `it_schema.monitoring_metrics`, `it_schema.monitoring_alerts` | `metricSchema`, `alertSchema` |
| **it-licenses** | 3105 | `GET /`, `/:id`, `/expiring-soon`, `/expired` ; `POST /` ; `PATCH /:id`, `/:id/renew` ; `DELETE /:id` | `it_schema.software_licenses` | `licenseSchema` |

Détails notables :
- `it-helpdesk` : tri par priorité, restriction "mes tickets" pour les non-IT sur `GET /:id`.
- `it-user-accounts` : bcrypt (12 salt rounds) pour `password_hash`, blocage de l'auto-désactivation.
- `it-equipment` : RBAC data-scoping en handler — un employé ne voit que le matériel qui lui est assigné (`assigned_to = self`) sur `GET /`.
- `it-monitoring` : `POST /monitoring/status` calcule automatiquement `alert_level` selon les seuils et insère une alerte si dépassement.
- `it-licenses` : endpoints dédiés `expiring-soon`/`expired` pour le suivi de renouvellement.

### 1.2 HR (5 services)

| Service | Port | Endpoints clés | Tables | Zod |
|---|---|---|---|---|
| **hr-employees** | 3201 | `GET /`, `/:id` ; `POST /` ; `PATCH /:id` ; `DELETE /:id` (soft) | `hr_schema.employees` | `employeeSchema`, `employeeUpdateSchema` |
| **hr-leave-requests** | 3202 | `GET /`, `/my-requests`, `/:id` ; `POST /` ; `PATCH /:id/approve`, `/reject`, `/cancel` | `hr_schema.leave_requests` ⋈ `employees` | `leaveSchema` |
| **hr-recruitment** | 3203 | `GET /`, `/:id` ; `POST /`, `/:id/interviews` ; `PATCH /:id/status` ; `DELETE /:id` | `hr_schema.recruitment_candidates`, `candidate_interviews` | `candidateSchema`, `interviewSchema` |
| **hr-payroll** | 3204 | `GET /`, `/my-payslips`, `/summary`, `/:id` ; `POST /` ; `PATCH /:id/approve`, `/cancel` | `hr_schema.payroll_records` ⋈ `employees` | `payrollSchema` |
| **hr-performance** | 3205 | `GET /`, `/stats`, `/:id` ; `POST /` ; `PATCH /:id/complete`, `/:id` | `hr_schema.performance_reviews` ⋈ `employees` | `reviewSchema` |

Détails notables :
- `hr-employees` : RBAC en handler (admin/RH voient tout, manager restreint à son département, employé restreint à sa propre fiche) ; colonne `salary` masquée hors RH/admin.
- `hr-leave-requests` : validation métier (`end_date >= start_date`, calcul `total_days`, détection de chevauchement de dates avec les demandes existantes).
- `hr-recruitment` : machine à états `VALID_TRANSITIONS` (`new→screening/rejected`, `screening→interview/rejected`, `interview→offer/rejected`, `offer→hired/rejected/withdrawn`).
- `hr-payroll` : `GET /summary` agrège le coût par département/devise ; empêche les doublons de période pour un même employé.
- `hr-performance` : empêche les doublons de revue pour un même employé/période ; modifications bloquées une fois la revue `completed`.

### 1.3 Finance (5 services)

| Service | Port | Endpoints clés | Tables | Zod |
|---|---|---|---|---|
| **finance-budget** | 3301 | `GET /`, `/:id` ; `POST /` ; `PATCH /:id` ; `DELETE /:id` (soft) | `finance_schema.budgets` | `budgetSchema`, `budgetUpdateSchema` |
| **finance-reports** | 3302 | `GET /dashboard`, `/expenses-by-category`, `/`, `/:id` ; `POST /` ; `PATCH /:id/publish` ; `DELETE /:id` | `finance_schema.financial_reports` (+ lecture budgets/expenses/payments/invoices) | `reportSchema` |
| **finance-payments** | 3303 | `GET /`, `/summary`, `/:id` ; `POST /` ; `PATCH /:id/confirm`, `/cancel` | `finance_schema.payments` | `paymentSchema` |
| **finance-expenses** | 3304 | `GET /`, `/:id` ; `POST /` ; `PATCH /:id`, `/:id/approve`, `/reject` ; `DELETE /:id` | `finance_schema.expenses` | `expenseSchema` |
| **finance-invoices** | 3305 | `GET /`, `/overdue`, `/:id` ; `POST /` ; `PATCH /:id/send`, `/mark-paid`, `/cancel` | `finance_schema.invoices` | `invoiceSchema` |

Détails notables :
- `finance-reports` : `GET /dashboard` agrège en lecture seule budgets/dépenses/paiements/factures sans passer par les autres services (accès direct Postgres cross-schéma).
- `finance-payments` : `invoice_id` stocké comme référence mais non validé auprès du service factures.
- `finance-expenses` : seul service Finance où `GET /`/`POST /` n'exige que `verifyToken` (self-service), avec scoping RBAC en clause `WHERE` (`created_by = self` pour les non-Finance/admin).
- `finance-invoices` : calcul serveur de `invoice_number`, `tax_amount`, `total_amount` ; cycle de vie `draft → sent → paid/cancelled`.

### 1.4 Operations (5 services)

| Service | Port | Endpoints clés | Tables | Zod |
|---|---|---|---|---|
| **ops-tasks** | 3401 | `GET /my-tasks`, `/overdue`, `/`, `/:id` ; `POST /` ; `PATCH /:id` ; `DELETE /:id` (soft) | `ops_schema.tasks` | `taskSchema`, `taskUpdateSchema` |
| **ops-workflows** | 3402 | `GET /definitions`, `/instances` ; `POST /definitions`, `/instances` ; `PATCH /instances/:id/advance` | `workflow_definitions`, `workflow_instances`, `workflow_step_logs` | `workflowSchema`, `instanceSchema`, schéma inline |
| **ops-suppliers** | 3403 | `GET /`, `/:id` ; `POST /` ; `PATCH /:id`, `/:id/rate` ; `DELETE /:id` | `ops_schema.suppliers` | `supplierSchema`, schéma inline |
| **ops-projects** | 3404 | `GET /stats`, `/`, `/:id` ; `POST /`, `/:id/members` ; `PATCH /:id` ; `DELETE /:id`, `/:id/members/:userId` | `projects`, `project_members` | `projectSchema`, `projectUpdateSchema`, `memberSchema` |
| **ops-inventory** | 3405 | `GET /low-stock`, `/`, `/:id`, `/:id/movements` ; `POST /`, `/:id/movement` ; `PATCH /:id` ; `DELETE /:id` | `inventory`, `inventory_movements` (+ lecture `auth_schema.users`) | `itemSchema`, `movementSchema` |

Détails notables :
- `ops-workflows` : moteur de workflow générique à étapes configurables (`steps[]` JSONB), machine à états `active|rejected|completed`, journal d'exécution (`workflow_step_logs`).
- `ops-projects` : agrégation `json_agg` des membres par projet ; scoping RBAC via sous-requête sur `project_members` pour les non-admin/Operations.
- `ops-inventory` : **seul endpoint de tout le système utilisant une transaction SQL explicite** (`BEGIN/COMMIT/ROLLBACK` sur `POST /:id/movement`, qui met à jour le stock ET journalise le mouvement de façon atomique).

### 1.5 Constat transversal sur les 20 microservices

- **Aucun appel HTTP inter-services** dans les 20 `server.js` métier (confirmé par grep global) — architecture "propriétaire de données isolé", toute composition cross-domaine se fait soit à l'API Gateway (routage), soit par accès direct Postgres cross-schéma en lecture (ex. `finance-reports`, `ops-inventory` → `auth_schema.users`).
- RBAC de scoping des données implémenté **ad hoc par service** (helper local `rbacScope()` dans budget/expenses, conditions inline dans tasks/workflows/projects) plutôt que via un middleware partagé unique.
- Validation Zod présente sur la quasi-totalité des endpoints de création ; certains `PATCH` (finance-expenses, ops-suppliers, ops-inventory) utilisent un filtrage manuel par liste blanche au lieu de Zod.

---

## 2. Architecture frontend

Application `dataprotect-frontend/` (React 18.2.0 + Vite 4.4.0). Un second dossier `dataprotect-frontend copy/` existe mais est une sauvegarde, non référencé dans `docker-compose.yml`.

### 2.1 Arborescence des sources

L'application est un **monolithe à 3 fichiers** — pas de découpage en `components/`, `pages/`, `hooks/` :

```
dataprotect-frontend/
├── .env                      (VITE_API_URL=http://172.22.160.1:3000)
├── index.html
├── package.json
├── vite.config.js            (proxy dev /api, timeout 720000ms)
└── src/
    ├── main.jsx               (9 lignes — montage racine React)
    ├── App.jsx                 (2041 lignes — application entière : thème, pages, routing, auth)
    └── ChatWidget.jsx          (widget chatbot, POST /api/chatbot/chat)
```

### 2.2 Routing

**Aucune librairie de routing** (pas de `react-router-dom`). Navigation par état React pur :
- `const [active, setActive] = useState(null)` — identifiant de vue (`"dashboard"`, `"hr"`, `"it"`, `"finance"`, `"operations"`, `"users"`, `"home"`, `"tickets"`, `"leave"`, `"profile"`, `"expenses"`, `"chat-history"`)
- `renderContent()` : `switch(active)` qui retourne le composant module correspondant
- Pas d'intégration URL/historique — un rafraîchissement page revient toujours à la vue par défaut du rôle (aucun deep-linking)

### 2.3 Authentification côté client

- **Stockage** : JWT dans `localStorage` (clé `"token"`), pas de cookie
- **Login** : `LoginPage` → `fetch POST /api/auth/login` → stocke `token`, `user` (JSON), `mustChangePw`
- **Attache du token** : manuelle, par requête (`headers: { Authorization: Bearer ${token} }`), répétée dans chaque module — pas de client HTTP centralisé ni d'intercepteur
- **Expiration/401** : **aucune gestion trouvée** — pas de wrapper fetch global, pas d'intercepteur axios ; un token expiré produit des pages vides silencieuses (`catch {}` vides) plutôt qu'une redirection login
- **Changement de mot de passe forcé** : si `mustChangePassword` renvoyé au login → `ChangePasswordScreen` affiché avant tout accès

### 2.4 Adaptation par rôle

Deux axes combinés : `role` (`admin`/`manager`/`employee`) × `department` (`IT`/`HR`/`Finance`/`Operations`).

```js
const canAccess = (module) => {
  if (isAdmin) return true;
  if (isManager) {
    const deptModule = DEPT_MODULE[userDept];
    return deptModule === module || module === "dashboard";
  }
  return false;
};
```
- `admin` : menu complet (Dashboard, HR, IT, Finance, Operations, Utilisateurs)
- `manager` : menu dynamique limité au département (`DEPT_MODULE`) + items communs (tickets, congés, dépenses, profil)
- `employee` : menu fixe restreint (Accueil, Mes tickets, Congés, Mes dépenses, Mon profil)
- Contrôles secondaires par module (ex. `HRModule` : `isHRAdmin = user.department === "HR" || user.role === "admin"` pour le panneau d'approbation congés)

### 2.5 Composants partagés

| Composant | Rôle |
|---|---|
| `Sidebar` | Navigation gauche, menu selon rôle/département |
| `Topbar` | En-tête, notifications, avatar |
| `StatCard` | Tuile KPI animée |
| `CursorCard` | Carte glassmorphism avec effet curseur |
| `StardustButton` | CTA principal rouge animé |
| `AnimatedBarChart` | Graphique barres CSS (pas de lib de charting) |
| `ChatWidget` | Widget chatbot flottant |
| `GlobalStyle`, `AuroraBackground`, `GooeyText`, `AnimatedTextCycle`, `Icon`, `AnimCounter`, `ModulePage`, `StableInput` | Éléments visuels/utilitaires partagés |

Pages métier : `LoginPage`, `AdminDashboard`, `HRModule`, `ITModule`, `FinanceModule`, `OpsModule`, `UsersModule`, `EmployeeHome`, `LeaveModule`, `ProfileModule`, `ChangePasswordScreen`, `ChatHistoryModule`.

### 2.6 Gestion d'état

`useState`/`useEffect` uniquement — pas de Context API, pas de Redux/Zustand, pas de React Query. État d'authentification et de navigation au niveau `App`, transmis en props (une seule couche de prop-drilling). Chaque module refait ses propres appels réseau à chaque montage (pas de cache partagé).

### 2.7 Dépendances clés

- `react`/`react-dom` 18.2.0, `axios` 1.16.1 (utilisé seulement dans `ChatWidget.jsx`, le reste utilise `fetch` natif)
- `framer-motion` et `lucide-react` installés mais **non utilisés** (animations en CSS `@keyframes` manuel, icônes en SVG inline custom)
- Aucun router, aucun UI kit, aucune lib de state, aucun framework de test

---

## 3. Infrastructure Docker

`docker-compose.yml` définit **36 conteneurs** (`container_name:` × 36).

### 3.1 Réseaux
- `erp-front-tier` (bridge) — exposition publique (nginx, gateway, monitoring UI)
- `erp-back-tier` (bridge, `internal: false`) — communication inter-services

### 3.2 Inventaire par couche

**Infrastructure de données**
| Service | Image | Ports | Volumes |
|---|---|---|---|
| postgres | postgres:15-alpine | — | postgres_data, init.sql |
| redis | redis:7-alpine | — | — |
| rabbitmq | rabbitmq:3-management-alpine | — | — (provisionné, non utilisé par le code) |

**Edge**
| nginx | nginx:alpine | 80:80 | nginx.conf (ro) |
| api-gateway | build local | 3000:3000 | — |

**20 microservices métier** (IT ×5, HR ×5, Finance ×5, Operations ×5) — chacun build local depuis son `services/<domaine>/<service>/Dockerfile`, un port interne dédié (3101-3105 IT, 3201-3205 HR, 3301-3305 Finance, 3401-3405 Operations), pas de port publié sur l'hôte.

**IA / Chatbot**
| chromadb | chromadb/chroma:1.0.20 | 8000:8000 | chromadb_data |
| ollama | build local (chatbot-finetuning/Dockerfile) | — | ollama_data |
| chatbot-service | build local | — | — |

**Monitoring / Observabilité**
| prometheus | prom/prometheus:latest | 9090:9090 | prometheus.yml, prometheus_data |
| grafana | grafana/grafana:latest | 3100:3000 | grafana_data, provisioning |
| cadvisor | gcr.io/cadvisor/cadvisor:latest | — | privileged, mounts docker/cgroups |
| elasticsearch | elastic:8.11.0 | 9200:9200 | elasticsearch_data |
| logstash | elastic:8.11.0 | 5044, 5000 | logstash.conf |
| kibana | elastic:8.11.0 | 5601:5601 | — |
| filebeat | elastic:8.11.0 | — | filebeat.yml, docker socket + logs |

### 3.3 Healthchecks
Seul `postgres` a un `healthcheck:` explicite (`pg_isready`, interval 10s, timeout 5s, retries 5) ; les 35 autres conteneurs s'appuient sur `depends_on` sans condition de santé (sauf dépendance à `postgres: condition: service_healthy` pour les services qui en ont besoin).

### 3.4 Volumes nommés
`postgres_data`, `grafana_data`, `chromadb_data`, `ollama_data`, `prometheus_data`, `elasticsearch_data`.

---

## 4. Sécurité implémentée

### 4.1 Flux JWT complet

**Génération** (`services/auth/auth/server.js`, `POST /login` et `POST /register`) :
```js
const token = jwt.sign(
  { id: user.user_id, role: user.role, department: user.department, email: user.email },
  _SECRET,
  { expiresIn: '8h' }
);
```
- Algorithme par défaut de `jsonwebtoken` : HS256
- Expiration : 8h, pas de claims custom au-delà de `id`/`role`/`department`/`email` (+ `iat` auto)
- **Aucun mécanisme de refresh token** — la seule façon de renouveler la session est une reconnexion complète

**Vérification** (`GET /verify`, utilisé par la gateway) :
```js
const decoded = jwt.verify(token, _SECRET);
```

**Hachage bcrypt** : `bcrypt.hash(password, 12)` (12 rounds), utilisé de façon cohérente sur register, change-password, reset admin/self-service. Protection anti-timing-attack au login : un hash factice est comparé même si l'utilisateur n'existe pas, pour que le temps de réponse ne révèle pas l'existence d'un compte :
```js
const dummyHash = '$2b$12$invalidhashtopreventtimingattacks000000000000000000000';
const storedHash = r.rows[0]?.password_hash || dummyHash;
const valid = await bcrypt.compare(data.password, storedHash);
```

**Réinitialisation de mot de passe** : flux à deux étapes par email (Gmail via `nodemailer`), `POST /forgot-password` (rate-limité, retourne toujours 200 pour éviter l'énumération de comptes) → token aléatoire (`crypto.randomBytes(32)`, expiration 1h) → `POST /reset-password`. Existe aussi un flux admin (mot de passe temporaire généré, `must_change_password = true`) et un self-service `POST /change-password`.

**Vérification côté microservices** (`shared/middleware/auth.js`, `verifyToken`) — double mode :
```js
const verifyToken = (req, res, next) => {
  const userContext = req.headers['x-user-context'];
  if (userContext) {
    req.user = JSON.parse(userContext);   // fait confiance à la gateway, pas de re-vérification signature
    return next();
  }
  // sinon, vérifie directement un Authorization: Bearer <JWT>
  const decoded = jwt.verify(token, _SECRET);
  req.user = { id: decoded.id, role: decoded.role, department: decoded.department, email: decoded.email };
  next();
};
```
Le mode `X-User-Context` fait confiance au header **sans revalidation de signature** — la frontière de sécurité repose sur le fait que seule la gateway est censée poser ce header (elle retire tout `Authorization` client avant de proxifier).

### 4.2 Matrice RBAC

Rôles réels dans le schéma : `admin`, `manager`, `employee` (enum Zod `registerSchema`). **IT/HR/Finance/Operations ne sont pas des rôles mais des valeurs de `department`** — l'accès dépend de la combinaison `(role, department)`.

```js
const requireDeptOrAdmin = (...depts) => requireDepartment(...depts);
const requireDepartment = (...depts) => (req, res, next) => {
  if (req.user.role === 'admin' || depts.includes(req.user.department)) return next();
  return res.status(403).json({ ... });
};
```
`requireDeptOrAdmin('Finance')` ne distingue **pas** manager vs employee au sein du département — un simple employé du département Finance a le même accès qu'un manager Finance sur les routes gérées par ce middleware.

| Rôle × Département | Domaine IT | Domaine HR | Domaine Finance | Domaine Operations |
|---|---|---|---|---|
| `admin` (tout département) | Total | Total | Total | Total |
| `manager`/`employee`, département correspondant | Total | Total (avec scoping additionnel sur `hr/employees`/`leave-requests`, voir 4.1) | Total | Total |
| `manager`/`employee`, département différent | Aucun accès, sauf endpoints self-service ("mes tickets", "mes tâches"...) | Aucun accès, sauf "mes congés"/"ma fiche" | Aucun accès, sauf "mes notes de frais" | Aucun accès, sauf "mes tâches" |

Scoping additionnel en base de code (au-delà du middleware partagé) :
- `hr/employees` : admin/RH voient tout (incl. `salary`) ; manager restreint à son département ; employé restreint à sa propre fiche (par email), `salary` masquée
- `hr/leave-requests` : employé restreint à ses propres demandes ; RH/admin voient tout et approuvent/rejettent
- `it/helpdesk` : création de ticket ouverte à tout utilisateur authentifié ; listing/assignation/résolution réservés à `requireDeptOrAdmin('IT')`
- Helper dupliqué par service (`it/helpdesk`, `it/equipment`, `finance/budget`, `finance/expenses`) : `rbacScope(user, conds, params, {managerFilter, employeeFilter})`, filtrage SQL additionnel selon le rôle
- `requireRole` existe dans le middleware partagé mais n'est utilisé nulle part dans les routes grep-ées — tout le gating passe par `requireDeptOrAdmin` ou des vérifications inline

### 4.3 CORS

**API Gateway** (`services/api-gateway/server.js`) — correspondance exacte :
```js
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
  'http://localhost:5176', 'http://localhost'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origine CORS non autorisée : ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

**Auth service** : configuration similaire mais avec `origin.includes(o)` (correspondance par sous-chaîne, plus permissive que le match exact de la gateway).

**chatbot-service** : `app.use(cors())` sans restriction — CORS totalement ouvert, incohérent avec les deux configurations ci-dessus (point à noter pour la section sécurité du rapport).

### 4.4 Validation Zod

Utilisée dans **21 fichiers** (les 20 microservices métier + le service auth) ; `chatbot-service` n'utilise pas Zod. Exemple complet (`services/it/helpdesk/server.js`) :
```js
const ticketSchema = z.object({
  title:       z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  priority:    z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  category:    z.enum(['hardware', 'software', 'network', 'access', 'email', 'general']).default('general'),
});
```
Chaque service mappe les erreurs `ZodError` en HTTP 400 via un `errorHandler` de forme identique (dupliqué par service, pas un module partagé unique) :
```js
if (err.name === 'ZodError') {
  return res.status(400).json({ success: false, message: 'Données invalides',
    errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })) });
}
```
Certains `PATCH` (ex. `finance/expenses`, `ops/suppliers`, `ops/inventory`) utilisent un filtrage manuel par liste blanche plutôt que Zod.

### 4.5 JWT_SECRET

Variable d'environnement `JWT_SECRET`, référencée dans `services/auth/auth/server.js` et `shared/middleware/auth.js` (importé par les 20 autres services). Garde-fou identique dans les deux fichiers :
```js
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') { console.error('FATAL...'); process.exit(1); }
  else console.warn('⚠️ JWT_SECRET absent — fallback dev uniquement');
}
const _SECRET = JWT_SECRET || 'dev_secret_only_never_in_prod';
```
**Valeur de repli codée en dur** (`'dev_secret_only_never_in_prod'`) présente dans les deux fichiers — protégée uniquement par la vérification `NODE_ENV === 'production'`, pas par l'absence de la chaîne elle-même dans le code.

---

## 5. Assistant conversationnel (chatbot-service)

### 5.1 Architecture des fichiers

```
chatbot-service/
├── server.js       # Endpoint Express /chat, orchestration du pipeline, tiers de fallback
├── ollama.js        # Client HTTP vers Ollama, construction du prompt, instructions LLM
├── functions.js     # FUNCTION_MAP + exécution des appels de fonction vers l'API Gateway
├── rag.js           # Client ChromaDB, recherche sémantique, filtrage par distance
├── context.js        # Historique conversationnel court terme (Redis)
├── db.js             # Historique conversationnel permanent (PostgreSQL)
├── Dockerfile        # node:18-slim (glibc requis par onnxruntime-node/chromadb-default-embed)
└── package.json
```

Pipeline `/chat` (server.js), dans l'ordre :
1. RAG (rag.js) → documents pertinents
2. Contexte conversationnel (context.js, Redis)
3. Construction du prompt complet (historique + docs + question)
4. Inférence LLM (ollama.js → Ollama)
5. Détection function-calling + validation de cohérence + tiers de secours
6. Exécution de la fonction si détectée (functions.js → API Gateway → microservice)
7. Sauvegarde du contexte (Redis + PostgreSQL)

### 5.2 Prompt système envoyé au modèle (FUNCTION_CALLING_INSTRUCTIONS)

Contenu intégral actuel (`chatbot-service/ollama.js`) :

```
Tu es l'assistant IA de l'ERP DataProtect.
Si l'utilisateur demande explicitement d'effectuer une action métier (créer un ticket, poser un congé, soumettre une note de frais, créer une tâche, etc.), tu dois répondre UNIQUEMENT avec un appel de fonction, encadré exactement par un bloc ```json comme ceci :
```json
{"function": "nom_de_la_fonction", "parameters": {...}}
```
N'ajoute aucun texte avant ou après ce bloc dans ce cas.
Si la demande de l'utilisateur n'est pas une action mais une simple question ou une demande d'information, réponds normalement en langage naturel, sans bloc ```json.

Fonctions disponibles :
[liste générée dynamiquement depuis FUNCTION_MAP — voir 5.3]

Exemples :
Question: Crée-moi un ticket pour un problème réseau
Réponse:
```json
{"function": "create_ticket", "parameters": {"title": "Problème réseau", "description": "L'utilisateur signale un problème de connexion réseau", "priority": "medium", "category": "network"}}
```

Question: Je veux poser un congé du 10 au 15 août pour des vacances
Réponse:
```json
{"function": "submit_leave_request", "parameters": {"leave_type": "annual", "start_date": "2026-08-10", "end_date": "2026-08-15", "reason": "vacances"}}
```

Question: Soumets une note de frais de 50 euros pour le transport
Réponse:
```json
{"function": "submit_expense", "parameters": {"title": "Frais de transport", "amount": 50, "currency": "EUR", "category": "travel", "expense_date": "2026-08-10"}}
```
Attention : "category" doit toujours être une des valeurs autorisées (...), jamais un mot recopié tel quel depuis la question de l'utilisateur.

Question: Liste les employés du département RH
Réponse:
```json
{"function": "get_employees", "parameters": {"department": "HR"}}
```
Attention : les appels de consultation (fonctions commençant par "get_") suivent exactement le même format que les appels de création ci-dessus.

Ne confonds jamais consultation et création, même si les deux portent sur la même entité — compare :
Question: Liste les employés du département RH → verbe "liste" = CONSULTATION → get_employees
Question: Crée un ticket réseau pour le département IT → verbe "crée" = CRÉATION → create_ticket
Une question de consultation ("liste", "montre", "affiche", "combien", "quels") n'appelle JAMAIS une fonction "create_*" ou "submit_*". Une question de création ("crée", "ajoute", "soumets", "pose") n'appelle JAMAIS une fonction "get_*".

Question: Quels sont les horaires du support IT ?
Réponse: Le support IT est disponible du lundi au vendredi de 8h à 18h.
```

Pour les messages de small-talk (voir 5.7), ce bloc est remplacé par des instructions courtes (`SMALL_TALK_INSTRUCTIONS`) pour économiser le budget de contexte.

Un **rappel** est en outre ajouté juste avant `### Response:` (technique de "sandwiching", voir 10.7) :
> "(Rappel : si la question ci-dessus est une demande d'action métier explicite, réponds UNIQUEMENT par le bloc ```json défini plus haut, sans aucun texte autour. Sinon, réponds normalement en langage naturel.)"

Format final du prompt envoyé à Ollama (`/api/generate`) — template Alpaca (voir 6.2) :
```
### Instruction:
{instructions}

{historique conversation}{documents RAG}Question: {query}{rappel}

### Input:


### Response:
```

### 5.3 FUNCTION_MAP (chatbot-service/functions.js)

| Fonction | Méthode | Endpoint API Gateway | Paramètres |
|---|---|---|---|
| `create_ticket` | POST | `/api/it/helpdesk` | title, description, priority, category |
| `get_tickets` | GET | `/api/it/helpdesk/my-tickets` | — |
| `get_ticket` | GET | `/api/it/helpdesk/:id` | id |
| `submit_leave_request` | POST | `/api/hr/leave` | leave_type, start_date, end_date, reason (employee_id résolu serveur) |
| `get_leave_requests` | GET | `/api/hr/leave/my-requests` | — |
| `get_employees` | GET | `/api/hr/employees` | department, status, employment_type, search (tous optionnels) |
| `submit_expense` | POST | `/api/finance/expenses` | title, description, amount, currency, category, expense_date, budget_id |
| `get_expenses` | GET | `/api/finance/expenses` | — |
| `get_budget_status` | GET | `/api/finance/budget/:id/status` | id |
| `get_budgets` | GET | `/api/finance/budget` | category, fiscal_year, currency (optionnels) |
| `get_invoices` | GET | `/api/finance/invoices` | status, client_name (optionnels) |
| `create_task` | POST | `/api/ops/tasks` | title, description, priority, due_date, project_id |
| `get_tasks` | GET | `/api/ops/tasks` | — |
| `get_project_progress` | GET | `/api/ops/projects/:id/progress` | id |
| `get_projects` | GET | `/api/ops/projects` | status, priority (optionnels) |

**13 fonctions** au total (4 créations, 9 consultations). `submit_leave_request` a un traitement spécial : `employee_id` (distinct du `user_id` du JWT) est résolu côté serveur via recherche par email (`resolveEmployeeId()`) plutôt que fourni par le LLM, pour éviter toute hallucination sur un identifiant sensible.

Gaps identifiés mais non comblés (couverture partielle des modules) : équipement IT, licences logicielles, comptes utilisateurs IT, paiements, fournisseurs, inventaire, paie, évaluations de performance, recrutement — chacun a un endpoint GET `/` disponible côté microservice mais aucune fonction chatbot correspondante.

### 5.4 Pipeline RAG (rag.js)

- Client : `chromadb` npm `^1.7.3` + `chromadb-default-embed` (embedding local `DefaultEmbeddingFunction`, même famille de modèle — MiniLM-L6-v2 — que le défaut du client Python utilisé pour l'indexation)
- Base : ChromaDB 1.0.20, collection `erp_dataprotect_docs`, **35 documents** indexés depuis `chatbot-rag/erp_documentation.json`
- Recherche : `nResults + 5` candidats récupérés, puis double filtrage :
  1. Exclusion des catégories "meta" (`chatbot`, `devops`, `docker`, `monitoring`, `infrastructure`, `api`)
  2. **Seuil de distance sémantique : `MAX_DISTANCE = 1.1`** — calibré empiriquement (docs pertinents ≈ 0.90-1.0 ; requête hors-sujet type "bonjour" ≥ 1.6)
  3. Troncature aux `nResults` (3) premiers résultats restants

### 5.5 Gestion du contexte conversationnel

Double persistance :
- **Redis** (`context.js`) — historique court terme utilisé pour construire le prompt LLM, clé `chat:context:{conversationId}`, `MAX_HISTORY_LENGTH = 10` messages, TTL 7 jours
- **PostgreSQL** (`db.js`) — historique permanent consultable via `/history/:userId`, tables `chat_conversations`/`chat_messages` (voir 9)

### 5.6 Mécanisme de retry à 3 niveaux (function-calling)

Motivé par la fiabilité limitée d'un fine-tuning léger (voir 6 et 10) :

| Tier | Déclencheur | Action | Coût |
|---|---|---|---|
| 1 | Réponse LLM initiale | `extractFunctionCall()` extrait le bloc ` ```json `, valide JSON + nom de fonction connu | 1 appel LLM |
| — | Fonction détectée mais incohérente avec l'intention de la question | `isFunctionCoherentWithQuery()` rejette (ex. "liste..." → `create_ticket`) | 0 (vérification locale) |
| 2 | Aucun appel valide/cohérent + `looksLikeActionRequest(query)` vrai | Réappel LLM avec un contexte **sans historique de conversation** (casse l'effet d'ancrage) | +1 appel LLM (jusqu'à 300s) |
| 3 | Tier 2 toujours sans résultat | `detectConsultationFallback()` — appel construit **déterministiquement** côté serveur, limité aux fonctions `get_*` sans paramètre requis, exclu si la requête contient un verbe de création | 0 (pas de LLM) |

### 5.7 Détection small-talk

```js
const SMALL_TALK_PATTERN = /^(bonjour|salut|bonsoir|bonne\s?nuit|coucou|hello|hi|hey|merci|...|ok|okay|d'accord)[\s!.,?]*$/i;
```
Liste fermée (deny-list) plutôt que détection ouverte : un faux négatif ne coûte qu'un prompt légèrement plus long, tandis qu'une détection trop large risquerait de supprimer les instructions function-calling sur une vraie demande d'action. Quand détecté, remplace `FUNCTION_CALLING_INSTRUCTIONS` (~1000+ tokens) par `SMALL_TALK_INSTRUCTIONS` (2 lignes), et le RAG retourne naturellement 0 document (distance toujours ≥1.6 pour ce type de requête).

### 5.8 Validation de cohérence intention/fonction

```js
function isFunctionCoherentWithQuery(functionCall, query) {
  const isConsultationFunction = functionCall.function.startsWith('get_');
  const isCreationFunction = functionCall.function.startsWith('create_') || functionCall.function.startsWith('submit_');
  const queryLooksConsultation = CONSULTATION_VERB_PATTERN.test(query) && !CREATION_VERB_PATTERN.test(query);
  if (queryLooksConsultation && isCreationFunction) return false;
  const queryLooksCreation = CREATION_VERB_PATTERN.test(query) && !CONSULTATION_VERB_PATTERN.test(query);
  if (queryLooksCreation && isConsultationFunction) return false;
  return true;
}
```
Corrige un mode d'échec où le modèle génère un JSON syntaxiquement valide et une fonction existante, mais **sémantiquement incorrecte** (ex. "Liste les employés" → `create_ticket`) — un cas que la validation de forme seule (JSON.parse + nom connu) ne peut pas détecter.

---

## 6. Fine-tuning du modèle LLM

### 6.1 Paramètres d'entraînement (`chatbot-finetuning/notebook_unsloth_simple.py`)

- Base : `unsloth/mistral-7b-instruct-v0.3-bnb-4bit` (Mistral 7B Instruct v0.3, quantifié 4-bit)
- Méthode : QLoRA via Unsloth
  - `r = 16`, `lora_alpha = 16`, `lora_dropout = 0`
  - `target_modules` : q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
  - **~58 millions de paramètres entraînables sur 7,25 milliards** (~0.8%)
- Entraînement (`TrainingArguments`) :
  - `max_steps = 120`, `per_device_train_batch_size = 2`, `gradient_accumulation_steps = 4` (batch effectif = 8)
  - `learning_rate = 2e-4`, `lr_scheduler_type = "linear"`, `warmup_steps = 5`
  - `optim = "adamw_8bit"`, `weight_decay = 0.01`
  - Précision : bf16 si supporté, sinon fp16
- **Métriques finales** : non capturées dans le repo — le script imprime `trainer_stats.training_loss` mais aucune sortie de run n'est archivée (notebook exporté en .py, cellules de sortie non conservées)
- **Dataset** : la variable `erp_data` (liste d'exemples instruction/input/output) est référencée mais **n'existe dans aucun fichier du dépôt** — elle était vraisemblablement définie dans une cellule Colab non exportée. Impossible de documenter précisément le nombre d'exemples ou leur contenu depuis le code disponible.
- Format d'entraînement (template Alpaca) :
```python
alpaca_prompt = """### Instruction:
{}

### Input:
{}

### Response:
{}"""
```

### 6.2 Modelfile (chatbot-finetuning/Modelfile)

```
FROM /models/mistral-7b-instruct-v0.3.Q4_K_M.gguf

TEMPLATE """{{ .Prompt }}"""

PARAMETER temperature 0.7
PARAMETER top_p 0.95
PARAMETER top_k 40
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx 4096

PARAMETER stop "### Instruction:"
PARAMETER stop "### Input:"
PARAMETER stop "</s>"

SYSTEM """Tu es l'assistant IA de l'ERP DataProtect. [...]"""
```
Points notables :
- `TEMPLATE = """{{ .Prompt }}"""` — passthrough brut, ce qui signifie que **le `SYSTEM` du Modelfile n'est jamais rendu par Ollama** ; c'est pourquoi `chatbot-service/ollama.js` reconstruit intégralement le prompt (instructions + format Alpaca) à chaque appel plutôt que de compter sur le Modelfile.
- `temperature: 0.7` au niveau Modelfile, mais **surchargée à 0.2 par requête** dans `ollama.js` (voir 10.6) — les paramètres passés dans `options` de l'appel `/api/generate` prévalent sur les valeurs par défaut du Modelfile.
- `num_ctx` de même : valeur par défaut 4096 dans le Modelfile (corrigée depuis 2048, voir 10.3), mais également passée explicitement par requête côté `ollama.js`.
- Format GGUF : Q4_K_M (quantification 4-bit), exécuté via Ollama dans le conteneur `ollama` (`chatbot-finetuning/Dockerfile` + `entrypoint.sh`, qui exécute `ollama create erp-dataprotect -f /models/Modelfile` au premier démarrage).

---

## 7. Pipeline DevSecOps

Un seul workflow : `.github/workflows/ci.yml` — *"ERP DataProtect — CI/CD Pipeline DevSecOps"*.

**Déclencheurs** : `push` sur `main`/`develop`, `pull_request` vers `main`.

### 7.1 Graphe de dépendances des 11 jobs

```
1 code-analysis
   ├─▶ 2 sast-scan
   ├─▶ 3 dependency-scan
   ├─▶ 4 unit-tests
   └─▶ 10 monitoring-check
2+3 ─▶ 5 docker-build ─▶ 6 container-scan
6 + 4 ─▶ 7 staging-deploy ─▶ 8 dast-scan
[1,2,3,4,5,6,7,8] ─▶ 9 production (stub)
[1..10] ─▶ 11 pipeline-summary (if: always())
```

### 7.2 Détail des jobs

| # | Job | Portée | Outils | Blocant ? |
|---|---|---|---|---|
| 1 | `code-analysis` | Matrice 24 cibles (23 services + frontend) | ESLint (si script `lint` déclaré) | Oui (par cible, `fail-fast: false`) |
| 2 | `sast-scan` | Repo entier | **SonarCloud** (`sonar-project.properties`), **Snyk** (`--severity-threshold=critical --all-projects`) | Oui — échoue si `SONAR_TOKEN`/`SNYK_TOKEN` absents, ou CVE critique |
| 3 | `dependency-scan` | Matrice 24 cibles | `npm audit --audit-level=critical` | Oui |
| 4 | `unit-tests` | chatbot-service, auth, api-gateway | Jest (chatbot, auth), `node --check` (gateway) | Mixte : chatbot en `continue-on-error` (Ollama/ChromaDB absents en CI), auth et gateway bloquants |
| 5 | `docker-build` | Matrice 23 services backend | `docker build` | Oui (échoue si Dockerfile manquant) |
| 6 | `container-scan` | Matrice 23 services (rebuild indépendant) | **Hadolint** (lint Dockerfile), **Trivy** (CVE CRITICAL/HIGH, `exit-code: 1` sur CRITICAL) | Oui |
| 7 | `staging-deploy` | Stack complète | `docker-compose up`, health-poll gateway, **Newman/Postman** (login + 4 GET cross-domaine) | Oui |
| 8 | `dast-scan` | Gateway en cours d'exécution | **OWASP ZAP** (baseline scan) | Non (`continue-on-error: true`, rapport HTML archivé) |
| 9 | `production` | — | Stub (echo d'un pipeline Terraform/AWS/ECS prévu, aucun secret AWS configuré) | — |
| 10 | `monitoring-check` | Config Compose | `docker-compose config --quiet` (syntaxe), détection présence prometheus/grafana/kibana | Syntaxe bloquante, présence des services informative |
| 11 | `pipeline-summary` | Tous les jobs | Résumé consolidé (`artifacts/pipeline-summary.md`) | `if: always()` |

### 7.3 Synthèse des outils intégrés

| Outil | Job | Vérifie | Application |
|---|---|---|---|
| ESLint | 1 | Règles de lint JS par service | Bloquant |
| SonarCloud | 2 | Analyse statique / SAST | Bloquant |
| Snyk | 2 | CVE dépendances (SCA) | Bloquant sur sévérité critique |
| npm audit | 3 | CVE dépendances npm | Bloquant (seuil critique) |
| Jest | 4 | Tests unitaires (auth : schémas Zod ; chatbot : tests existants) | Bloquant (auth) / informatif (chatbot) |
| Hadolint | 6 | Bonnes pratiques Dockerfile | Bloquant |
| Trivy | 6 | CVE image conteneur | Bloquant (CRITICAL) |
| Newman | 7 | Tests end-to-end sur stack live | Bloquant |
| OWASP ZAP | 8 | DAST (scan passif) | Informatif |

**Absences notables** : pas d'outil SBOM (Syft/CycloneDX), pas de scan de secrets (Gitleaks/TruffleHog), pas de scanner IaC (Checkov/tfsec) — le déploiement production (Terraform/AWS) reste un stub sans exécution réelle.

---

## 8. Monitoring & observabilité

### 8.1 Prometheus (`monitoring/prometheus.yml`)

`scrape_interval: 15s`, `evaluation_interval: 15s`, 9 jobs en `static_configs` (pas de service discovery) : `cadvisor`, `api-gateway`, `auth-service`, `it-services` (5 cibles), `hr-services` (5 cibles), `finance-services` (5 cibles), `operations-services` (5 cibles), `chatbot-service`, `rabbitmq` (port 15692, plugin Prometheus RabbitMQ). Soit les 23 microservices + gateway + auth + chatbot + cAdvisor + RabbitMQ scrapés.

### 8.2 Filebeat (`monitoring/filebeat/filebeat.yml`)

```yaml
filebeat.inputs:
  - type: container
    paths: ['/var/lib/docker/containers/*/*.log']
    processors:
      - add_docker_metadata: { host: "unix:///var/run/docker.sock" }
processors:
  - add_fields: { target: '', fields: { application: erp-dataprotect } }
output.logstash:
  hosts: ["logstash:5044"]
```
Collecte stdout/stderr de tous les conteneurs Docker de l'hôte, tague chaque événement `application: erp-dataprotect`, envoie à Logstash (protocole Beats, port 5044).

### 8.3 Logstash (`monitoring/logstash/logstash.conf`)

- **Input** : Beats (5044) + TCP JSON brut (5000, disponible pour du logging applicatif direct)
- **Filter** : ajout de `application` si champ `service` présent, normalisation `@timestamp` depuis un champ `timestamp` ISO8601
- **Output** : Elasticsearch, index journalier `erp-logs-YYYY.MM.dd`

### 8.4 Grafana (`monitoring/grafana/provisioning/`)

- Datasource unique : Prometheus (`http://prometheus:9090`, proxy, par défaut)
- Provider de dashboards : dossier `"ERP DataProtect"`, lecture de fichiers JSON dans `/var/lib/grafana/dashboards` (rechargement 30s)
- **Aucun fichier JSON de dashboard n'existe dans le repo** — le provisioning est en place mais aucun dashboard préconstruit n'est fourni.

### 8.5 Métriques custom (prom-client)

**Aucune métrique métier custom** (`Counter`/`Histogram`/`Gauge`) trouvée dans tout le code — grep sur `services/` et `chatbot-service/` retourne zéro résultat. Chaque service (21 au total, y compris api-gateway/auth) utilise le même middleware partagé minimal :

```js
// shared/middleware/metrics.js
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // métriques process/Node.js par défaut uniquement
```
`chatbot-service/server.js` duplique ce pattern indépendamment (copie inline, ne réutilise pas le middleware partagé). Seules les métriques par défaut de `prom-client` sont exposées (CPU/mémoire process, latence event-loop, durée GC) — aucun compteur de requêtes HTTP, aucune métrique métier par route.

### 8.6 Healthchecks Docker Compose

**Un seul service sur 37** définit un `healthcheck:` explicite : `postgres` (`pg_isready`, interval 10s, timeout 5s, retries 5). Tous les autres (36 services/conteneurs, y compris toute la stack monitoring) n'en ont pas — le job CI `staging-deploy` compense en sondant directement `GET /health` sur l'API Gateway via `curl` plutôt que de s'appuyer sur l'état de santé Compose.

---

## 9. Base de données PostgreSQL

Fichier unique `database/init.sql`, exécuté au premier démarrage du conteneur `postgres` (monté dans `/docker-entrypoint-initdb.d/`). Extension `pgcrypto` activée pour `gen_random_uuid()`.

### 9.1 Séparation par schéma

| Schéma | Domaine | Tables |
|---|---|---|
| `auth_schema` | Authentification | `users` |
| `it_schema` | IT | `user_accounts`, `helpdesk_tickets`, `equipment`, `monitoring_metrics`, `monitoring_alerts`, `software_licenses` |
| `hr_schema` | RH | `employees`, `leave_requests`, `recruitment_candidates`, `candidate_interviews`, `payroll_records`, `performance_reviews` |
| `finance_schema` | Finance | `budgets`, `financial_reports`, `payments`, `expenses`, `invoices` |
| `ops_schema` | Opérations | `tasks`, `workflow_definitions`, `workflow_instances`, `workflow_step_logs`, `suppliers`, `projects`, `project_members`, `inventory`, `inventory_movements` |
| `public` | Chatbot (transverse) | `chat_conversations`, `chat_messages` |

**28 tables** au total (26 métier + 2 chatbot, ajoutées durant le développement — voir 10.10).

### 9.2 Convention de clés

- Toutes les tables métier utilisent `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, sauf `auth_schema.users` (`user_id SERIAL`) et `it_schema.user_accounts` (`account_id SERIAL`).
- `created_by`/`assigned_to`/`approved_by`/etc. sont des `INTEGER` non contraints par FK (référencent l'`user_id` de `auth_schema.users`, mais sans contrainte cross-schéma déclarée dans le code).

### 9.3 Relations (FK) principales

- `hr_schema.leave_requests.employee_id` → `hr_schema.employees.employee_id`
- `hr_schema.payroll_records.employee_id` → `hr_schema.employees.employee_id`
- `hr_schema.performance_reviews.employee_id` → `hr_schema.employees.employee_id`
- `hr_schema.employees.manager_id` → `hr_schema.employees.employee_id` (auto-référence)
- `hr_schema.candidate_interviews.candidate_id` → `hr_schema.recruitment_candidates.candidate_id`
- `ops_schema.workflow_instances.workflow_id` → `ops_schema.workflow_definitions.definition_id`
- `ops_schema.workflow_step_logs.instance_id` → `ops_schema.workflow_instances.instance_id`
- `ops_schema.project_members.project_id` → `ops_schema.projects.project_id` (ON DELETE CASCADE, clé composite avec `user_id`)
- `ops_schema.inventory.supplier_id` → `ops_schema.suppliers.supplier_id`
- `ops_schema.inventory_movements.item_id` → `ops_schema.inventory.item_id`
- `chat_messages.conversation_id` → `chat_conversations.id` (ON DELETE CASCADE)

### 9.4 Champs JSONB notables
`ops_schema.workflow_definitions.steps`, `ops_schema.workflow_instances.context`, `finance_schema.financial_reports.data`, `finance_schema.invoices.line_items`, `it_schema.monitoring_metrics.tags`, `ops_schema.tasks.tags`, `ops_schema.projects.tags` — utilisés pour des structures semi-flexibles plutôt que des tables normalisées additionnelles.

### 9.5 Index
19 index `CREATE INDEX IF NOT EXISTS` sur les colonnes de filtrage fréquent (`status`, `created_by`, `assigned_to`, `department`, `employee_id`, `category`, etc.) répartis sur les 4 schémas métier, + 2 index ajoutés pour le chatbot (`chat_conversations.user_id`, `chat_messages.conversation_id`).

---

## 10. Problèmes résolus durant le développement

Chronologie des diagnostics et corrections effectués sur ce projet, du symptôme initial ("erreur réseau" sur le chatbot) jusqu'à la fiabilisation du function-calling. Section utile pour un chapitre "Difficultés rencontrées".

### 10.1 Course de timeouts (cause initiale de l'erreur réseau)
**Symptôme** : le chatbot ne répondait jamais, erreur réseau côté frontend.
**Cause** : nginx, l'API Gateway, le proxy dev Vite et le client Ollama étaient tous réglés au **même** timeout (120s), sans marge pour le RAG/contexte/sauvegarde qui s'exécutent en plus de l'inférence LLM elle-même — la couche externe expirait systématiquement avant la couche interne.
**Correction** : échelonnement strict (chaque couche externe > couche interne, avec marge) : Ollama 300s → API Gateway 660s → nginx/Vite/frontend 720s (valeurs finales, après plusieurs itérations liées à la variance réelle de l'inférence CPU).

### 10.2 Mémoire Docker Desktop/WSL2 insuffisante
**Symptôme** : redémarrages aléatoires des conteneurs pendant l'inférence LLM, reproduits 3 fois consécutives.
**Cause** : VM WSL2 plafonnée par défaut à 50% de la RAM hôte (~7,47 Go sur une machine à 15,4 Go), insuffisant pour Ollama (modèle 7B) + ChromaDB + 20 microservices + stack ELK/monitoring simultanément.
**Correction** : `C:\Users\hiba\.wslconfig` → ajout de `memory=12GB`, puis `wsl --shutdown` + redémarrage complet de la stack.

### 10.3 ChromaDB en crash-loop (RAG mort)
**Cause** : image `chromadb/chroma:0.4.22` incompatible avec NumPy 2.0 (`np.float_` supprimé) ; le script de démarrage de l'image réinstallait NumPy à chaque redémarrage, aggravant la boucle de crash.
**Correction** : image relevée à `chromadb/chroma:1.0.20` (compatible avec les clients modernes déjà utilisés : npm `chromadb@^1.7.3`, script Python `vectorize_docs.py`), documentation ré-indexée (35 documents).

### 10.4 Client RAG Node cassé (embeddingFunction manquant)
**Cause** : le client npm `chromadb` v1.x exige un `embeddingFunction` explicite pour vectoriser les requêtes texte côté client ; sans lui, `collection.query()` levait une exception silencieusement absorbée, renvoyant toujours 0 documents.
**Correction** : ajout de `chromadb-default-embed` + `DefaultEmbeddingFunction`, et changement de la base Docker `node:18-alpine` → `node:18-slim` (le paquet embarque `onnxruntime-node`, binaire natif nécessitant glibc, absent d'Alpine/musl).

### 10.5 num_ctx 2048 → 4096
**Cause** : le prompt (documents RAG + instructions function-calling) atteignait jusqu'à ~1800 tokens à lui seul, laissant trop peu de marge dans une fenêtre de 2048 tokens pour que le modèle génère une réponse complète — provoquait des générations tronquées/incohérentes, y compris de faux blocs JSON invalides.
**Correction** : `num_ctx: 4096` passé explicitement par requête dans `ollama.js` (le Modelfile seul ne suffit pas : Ollama l'ignore pour `/api/generate` si non fourni dans `options`).

### 10.6 Fiabilité du function-calling (température, sandwiching, retry, fallback, cohérence)
Chaîne de corrections successives sur un même problème de fond — fine-tuning très léger (120 steps QLoRA) généralisant mal :
- **Filtre RAG par distance sémantique** (seuil `1.1`) — évite d'injecter des documents non pertinents qui gonflent le prompt inutilement.
- **Détection small-talk** — évite d'injecter les instructions function-calling (~1000+ tokens) sur de simples salutations.
- **Température 0.7 → 0.2** — privilégie la reproduction fidèle du format appris à la créativité, pour une tâche à sortie structurée.
- **Rappel "sandwich"** — répétition de la consigne juste avant `### Response:`, car l'historique de conversation intercalé dilue le poids des instructions générales en tête de prompt.
- **Retry sans historique (tier 2)** — un échec précédent dans l'historique de conversation "contamine" les tentatives suivantes (le modèle imite son propre refus passé) ; un second appel LLM sans historique casse ce biais d'ancrage.
- **Fallback déterministe (tier 3)** — pour les fonctions `get_*` sans paramètre requis, construction directe de l'appel côté serveur (sans LLM) si même le retry échoue, via une correspondance entité→fonction.
- **Validation de cohérence intention/fonction** (`isFunctionCoherentWithQuery`) — un JSON syntaxiquement valide peut désigner la mauvaise fonction (ex. "Liste les employés" → `create_ticket`) ; comparaison entre les verbes de la question (consultation vs création) et le préfixe de la fonction choisie, avec rejet et retombée sur les tiers 2/3 en cas d'incohérence.

### 10.7 Fonctions de consultation manquantes dans FUNCTION_MAP
**Cause** : `FUNCTION_MAP` ne couvrait que la création + quelques listings ; aucune fonction pour lister les employés, factures, budgets ou projets n'existait (alors que `get_budget_status`/`get_project_progress` existaient déjà en lookup par ID, sans aucun moyen de découvrir ces ID).
**Correction** : ajout de `get_employees`, `get_invoices`, `get_budgets`, `get_projects` + premier exemple few-shot de consultation (jusque-là, tous les exemples ne montraient que des créations).

### 10.8 Tables PostgreSQL manquantes (chat_conversations)
**Symptôme** : `DB getOrCreate error: relation "chat_conversations" does not exist` dans les logs, en continu.
**Cause** : la fonctionnalité chatbot a été ajoutée après le schéma ERP initial ; `chatbot-service/db.js` référence `chat_conversations`/`chat_messages`, jamais définies dans `database/init.sql`.
**Correction** : tables ajoutées à `init.sql` (pour les futurs déploiements) + migration appliquée directement sur la base déjà existante (le volume Postgres en cours d'exécution ne rejoue pas `init.sql`).

### 10.9 Correctifs mineurs associés
- Timeout par appel Ollama ajusté de 120s → 180s → 300s au fil des mesures réelles de variance CPU.
- Parsing JSON du function-calling rendu robuste : un bloc ` ```json ` invalide ou une fonction inconnue retombe désormais sur le texte brut du modèle plutôt que sur un message d'erreur technique affiché à l'utilisateur.
