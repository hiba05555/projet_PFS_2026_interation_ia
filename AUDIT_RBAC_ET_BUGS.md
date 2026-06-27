# Audit RBAC & Bugs — DataProtect ERP
**Date :** 2026-06-20  
**Périmètre :** Frontend (App.jsx, ChatWidget.jsx) + 22 services backend

---

## 1. BUGS CORRIGÉS DANS CES SESSIONS

### Session 1 — Données mockées & URLs absolues
| # | Fichier | Problème | Correction |
|---|---------|----------|-----------|
| 1 | `App.jsx` — FinanceModule | Données hardcodées (stats, graphiques) | Connecté à `/api/finance/reports/dashboard`, `/api/finance/expenses`, `/api/finance/budget` |
| 2 | `App.jsx` — OpsModule | Données hardcodées (projets, stats) | Connecté à `/api/ops/projects`, `/api/ops/projects/stats` |
| 3 | `App.jsx` (13 occurrences) | URLs absolues `http://localhost/api/...` | Remplacé par `/api/...` (relative) |
| 4 | `vite.config.js` | IP WSL2 hardcodée `172.22.160.1:3000` | Remplacé par `process.env.VITE_API_TARGET \|\| 'http://localhost:3000'` |

### Session 2 — RBAC self-service Finance (TÂCHE A)
| # | Fichier | Problème | Correction |
|---|---------|----------|-----------|
| 5 | `services/finance/expenses/server.js` — `POST /` | `requireDeptOrAdmin('Finance')` bloquait tous les non-Finance → aucun employé ne pouvait soumettre sa propre note de frais | Remplacé par `verifyToken` seul |
| 6 | `services/finance/expenses/server.js` — `GET /` | `requireDeptOrAdmin('Finance')` + `rbacScope` avec `managerFilter=null` (dead code : rôle 'manager' absent de l'enum) → non-Finance ne pouvaient pas lister leurs dépenses | Remplacé par filtre inline : admin ou département Finance → tout voir ; autres → `created_by = user.id` |
| 7 | `App.jsx` — MENU.employee | Aucune entrée pour les dépenses → les employés n'avaient aucun accès UI à leurs notes de frais | Ajouté `{ id:"expenses", label:"Mes dépenses", icon:"dollar" }` |
| 8 | `App.jsx` — FinanceModule | Pas de formulaire de saisie + pas de vue personnelle vs globale | Ajouté formulaire "Nouvelle note de frais" + logique `isFinance` (similaire à `isIT` dans ITModule) |

---

## 2. ANALYSE RBAC PAR SERVICE

### ✅ Cohérents (pas de correction nécessaire)

| Service | Routes self-service (verifyToken) | Routes management (requireDeptOrAdmin) | Frontend |
|---------|----------------------------------|----------------------------------------|---------|
| `hr/employees` | `GET /` avec RBAC inline (admin=tout, manager=dept, employee=son record) | `POST /`, `PATCH /:id`, `DELETE /:id` → HR | ✅ HRModule cohérent |
| `hr/leave-requests` | `POST /`, `GET /my-requests`, `DELETE /:id/cancel` | `GET /`, `PATCH /:id/approve/reject` → HR | ✅ LeaveModule cohérent |
| `it/helpdesk` | `POST /` (créer ticket), `GET /my-tickets` | `GET /` (liste), assign/resolve/close → IT | ✅ ITModule cohérent (`isIT` flag) |
| `ops/tasks` | `GET /`, `GET /my-tasks` (filtre auto), `POST /`, `PATCH /:id` | `DELETE /:id` → Operations | ⚠️ Pas d'UI (voir §3) |
| `ops/workflows` | `GET /definitions`, `GET /instances` (filtre auto), `POST /instances`, `PATCH /instances/:id/advance` | `POST /definitions` → Operations | ⚠️ Pas d'UI (voir §3) |
| `auth/auth` | Login, register, change-password, forgot/reset-password | `/users`, `/admin/create`, `/:id/activate`, `/:id/deactivate` → admin via `verifyAdmin` | ✅ UsersModule cohérent |

### ⚠️ Anomalies identifiées (dead code)

| Service | Route | Problème | Impact |
|---------|-------|----------|--------|
| `finance/expenses` | `rbacScope()` avec `user.role === 'manager'` | Le rôle 'manager' n'existe pas dans l'enum (`admin,it,hr,finance,operations,employee`) → branche manager jamais exécutée | Corrigé en Session 2 (nouveau filtre inline) |
| `it/equipment` | `GET /` avec `rbacScope` `employeeFilter: assigned_to = user.id` | Bloqué en amont par `requireDeptOrAdmin('IT')` → le `rbacScope` ne s'exécute jamais pour les non-IT | Décision métier à prendre (§3) |
| `it/helpdesk` | `GET /` avec `rbacScope` `employeeFilter: created_by OR assigned_to` | Même bug 'manager' : les agents IT (role='it') voient uniquement leurs propres tickets, pas tous | Décision métier à prendre (§3) |

---

## 3. DÉCISIONS MÉTIER — ÉTAT

### ✅ D1 — Approbation des congés (HR) — CORRIGÉ
HRModule reçoit maintenant `user` prop. Quand `isHRAdmin=true`, un bouton bascule "Congés en attente" apparaît avec le compteur. En cliquant, un panneau liste les demandes avec boutons Approuver / Rejeter qui appellent `PATCH /api/hr/leave/:id/approve` et `PATCH /api/hr/leave/:id/reject`.

### ✅ D2 — Vue complète tickets IT — CORRIGÉ
`services/it/helpdesk/server.js` `GET /` : suppression de `rbacScope()` dont la branche `role='manager'` était dead code. Les agents IT (`role='it'`, `department='IT'`) qui passent `requireDeptOrAdmin('IT')` voient désormais TOUS les tickets, cohérent avec le frontend (`isIT=true`).

### ❓ D3 — Équipement IT self-service — EN ATTENTE
`GET /api/it/equipment` reste bloqué par `requireDeptOrAdmin('IT')`. Ouvrir aux employés pour voir leur matériel assigné = décision métier.

### ✅ D4 — Bulletins de paie — CORRIGÉ
`ProfileModule` reçoit maintenant `token` prop. Fetche `GET /api/hr/payroll/my-payslips?limit=6` et affiche un tableau "Mes bulletins de paie" (période, montant net, statut) à droite des infos de profil.

### ❓ D5 — Tâches dans OpsModule — EN ATTENTE
Routes Ops tasks existent et filtrent auto. Intégration UI = décision produit.

### ✅ D6 — Dépenses managers non-Finance — CORRIGÉ
`getManagerMenu` génère maintenant `{ id:"expenses", label:"Mes dépenses", icon:"dollar" }` pour tous les managers dont le département n'est pas Finance (Finance managers ont déjà leur module complet).

### ✅ D7 — Dashboard admin avec données réelles — CORRIGÉ
`AdminDashboard` reçoit `token` prop. Les 4 KPIs sont désormais fetched via `Promise.allSettled` (dégradation gracieuse si un service est indisponible) :
- Employés actifs → `GET /api/hr/employees?status=active&limit=1` → `pagination.total`
- Tickets ouverts → `GET /api/it/helpdesk?status=open&limit=1` → `pagination.total`
- Budget actif (k MAD) → `GET /api/finance/reports/dashboard` → `data.active_budgets.total / 1000`
- Projets actifs → `GET /api/ops/projects/stats` → `data.active`
Affiche "—" si l'API retourne 403 (manager non-admin avec accès partiel).

---

## 4. ROUTES BACKEND SANS UI (INTENTIONNEL OU OUBLI)

### HR
| Route | Endpoint | RBAC | Status UI |
|-------|----------|------|-----------|
| Recrutement | `/api/hr/recruitment` | HR only | ❌ Aucune UI |
| Évaluations | `/api/hr/performance` | HR only | ❌ Aucune UI |
| Bulletins de paie | `/api/hr/payroll/my-payslips` | verifyToken (self-service) | ❌ **Décision D4** |

### Finance
| Route | Endpoint | RBAC | Status UI |
|-------|----------|------|-----------|
| Factures | `/api/finance/invoices` | Finance only | ❌ Aucune UI |
| Paiements | `/api/finance/payments` | Finance only | ❌ Aucune UI |

### IT
| Route | Endpoint | RBAC | Status UI |
|-------|----------|------|-----------|
| Équipements | `/api/it/equipment` | IT only | ❌ **Décision D3** |
| Licences | `/api/it/licenses` | IT only | ❌ Aucune UI |
| Monitoring | `/api/it/monitoring` | IT only | ❌ Aucune UI |
| Comptes IT | `/api/it/user-accounts` | IT only | ❌ Aucune UI (service distinct de /api/auth/users) |
| Stats helpdesk | `/api/it/helpdesk/stats` | IT only | ❌ Pas de dashboard IT |
| Actions ticket (assign/resolve/close) | `/api/it/helpdesk/:id/...` | IT only | ❌ **Décision D2** |

### Operations
| Route | Endpoint | RBAC | Status UI |
|-------|----------|------|-----------|
| Tâches | `/api/ops/tasks` | auto-filtré | ❌ **Décision D5** |
| Mes tâches | `/api/ops/tasks/my-tasks` | verifyToken | ❌ **Décision D5** |
| Fournisseurs | `/api/ops/suppliers` | Operations only | ❌ Aucune UI |
| Inventaire | `/api/ops/inventory` | Operations only | ❌ Aucune UI |
| Workflows | `/api/ops/workflows/definitions` | verifyToken (lecture) | ❌ Aucune UI |
| Instances workflow | `/api/ops/workflows/instances` | verifyToken (auto-filtré) | ❌ Aucune UI |

---

## 5. CHATBOT — AUDIT SÉCURITÉ

**ChatWidget.jsx :**
- `API_URL = ''` → appels relatifs `/api/chatbot/chat` ✅
- Envoie `Authorization: Bearer ${token}` ✅
- Token récupéré depuis `localStorage` ✅

**Gateway (`api-gateway/server.js`) :**
- `app.post('/api/chatbot/chat', ...)` est déclaré **après** `app.use('/api', verifyToken)` → le middleware `verifyToken` s'applique à toutes les routes `/api/*` y compris chatbot ✅
- La gateway forward le token au service chatbot via header `Authorization` ✅
- `/api/chatbot/reset` : protégé par verifyToken (déclaré après le middleware global) mais pas de validation user côté handler gateway — le service chatbot doit gérer l'authentification lui-même ⚠️ (service externe non audité)
- `/api/chatbot/health` : accessible sans token (déclaré après verifyToken, mais les health checks ne nécessitent pas d'auth) — risque faible

**Verdict chatbot :** Sécurisé au niveau gateway. Le service interne `chatbot-service:3500` n'est pas dans ce dépôt et n'a pas pu être audité.

---

## 6. RÉSUMÉ EXÉCUTIF

| Catégorie | Nombre | Action |
|-----------|--------|--------|
| Bugs corrigés (sessions 1+2) | 8 | ✅ Fait |
| Décisions métier en attente | 7 (D1–D7) | ❓ Validation requise |
| Routes backend sans UI | 15 | 📋 Backlog produit |
| Services non audités | 1 (chatbot externe) | ⚠️ Audit séparé |
