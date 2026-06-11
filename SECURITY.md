# 🔐 Rapport de sécurité & Changelog des corrections

## Bugs critiques corrigés

### 1. 🔴 Bug JWT fatal — `shared/middleware/auth.js`
**Avant :** `const token = authHeader.split(' ')` → retournait un **tableau**, pas une chaîne.  
`jwt.verify(token, JWT_SECRET)` recevait `['Bearer', 'xxx']` → vérification impossible.

**Après :** `const token = authHeader.split(' ')[1]` → extrait correctement le token.

---

### 2. 🔴 Credentials en clair dans le dépôt — `.env`
**Avant :** Mot de passe Gmail réel, JWT secret faible, mots de passe `admin`/`postgres` committé en clair.

**Après :**
- Le fichier `.env` est ajouté à `.gitignore`
- Un fichier `.env.example` (sans valeurs réelles) sert de référence
- Instructions pour générer un JWT secret fort

---

### 3. 🔴 JWT secret incohérent entre services
**Avant :** Les microservices utilisaient `'your_super_secret_jwt_key_change_in_production'` comme fallback, différent du secret de la gateway → tokens inter-services invalides.

**Après :** Tous les services utilisent `process.env.JWT_SECRET` via le middleware centralisé `shared/middleware/auth.js`. Un seul fallback dev unifié.

---

### 4. 🔴 Fuites d'erreurs PostgreSQL au client
**Avant :** `res.status(500).json({ error: e.message })` → expose les noms de tables, requêtes SQL, etc.

**Après :** `errorHandler` centralisé dans `shared/middleware/auth.js` — message générique en production, détails uniquement en développement.

---

### 5. 🟡 Pas de validation des entrées
**Avant :** La majorité des services acceptaient n'importe quelle donnée sans validation (injections, types incorrects, champs manquants).

**Après :** Zod est utilisé dans tous les services pour valider et typer les entrées. Les erreurs de validation retournent un détail structuré (champ + message).

---

### 6. 🟡 Routes POST vides (données non persistées)
**Avant :** Les services Finance, HR Recruitment/Performance, IT Equipment/Licenses/Monitoring, Ops répondaient `{ message: 'Created', data: req.body }` sans rien insérer en base.

**Après :** Toutes les routes POST effectuent de vraies requêtes `INSERT` paramétrées.

---

### 7. 🟡 Routes PATCH sans mise à jour réelle
**Avant :** Les PATCH faisaient un `SELECT` puis retournaient juste `{ message: 'Updated' }` sans modifier la base.

**Après :** Chaque PATCH effectue un `UPDATE` réel avec les champs autorisés uniquement (whitelist explicite).

---

### 8. 🟡 API Gateway — routing incomplet
**Avant :** Seuls `hr/payroll` et `finance/budget` étaient routés. Les 18 autres services étaient inaccessibles via la gateway.

**Après :** Les 20 services sont enregistrés dynamiquement avec leur URL configurée via variables d'environnement.

---

## Améliorations fonctionnelles ajoutées

| Service | Nouvelles fonctionnalités |
|---------|--------------------------|
| **Finance Budget** | Pagination, filtres catégorie/année, soft delete (archivage) |
| **Finance Expenses** | Workflow approbation (`approve`/`reject`), suppression seulement si `pending` |
| **Finance Invoices** | Workflow complet `draft→sent→paid/cancelled`, route `/overdue` |
| **Finance Payments** | Route `/summary`, workflow `pending→completed/cancelled` |
| **Finance Reports** | Route `/dashboard` (agrégats), `/expenses-by-category`, publication de rapports |
| **HR Employees** | Accès filtré par département pour non-HR, masquage salaire, recherche full-text |
| **HR Recruitment** | Workflow statuts avec transitions validées, planification d'entretiens |
| **HR Performance** | Stats globales, vérification unicité période/employé, workflow `draft→completed` |
| **IT Equipment** | Route `/warranty-expiring`, actions `assign`/`unassign`, soft delete |
| **IT Licenses** | Routes `/expiring-soon`, `/expired`, action `renew`, compteur `seats_used` |
| **IT Monitoring** | Dashboard temps réel, alertes auto sur seuils, actions `acknowledge`/`resolve` |
| **Ops Tasks** | Routes `/my-tasks`, `/overdue`, accès filtré, auto `completed_at` |
| **Ops Projects** | Stats, gestion membres (`add`/`remove`), compteur membres |
| **Ops Suppliers** | Recherche full-text, évaluation rating, détection doublons |
| **Ops Inventory** | Route `/low-stock`, mouvements de stock transactionnels, historique |
| **Ops Workflows** | Définitions de workflows, instances, avancement d'étapes avec logs |

---

## Recommandations supplémentaires

1. **Refresh tokens** : Implémenter des tokens courte durée (15min) avec refresh tokens pour réduire l'exposition JWT.
2. **Audit logs** : Logger toutes les actions sensibles (création/modification/suppression) dans une table dédiée.
3. **Tests automatisés** : Ajouter des tests d'intégration (Jest + supertest) pour les routes critiques.
4. **HTTPS** : Forcer HTTPS via Nginx en production et activer HSTS.
5. **Secrets manager** : En production, utiliser HashiCorp Vault ou AWS Secrets Manager au lieu des variables d'environnement.
6. **DB_PASSWORD** : Retirer les fallbacks en dur — le `shared/middleware/db.js` corrigé n'en a plus.
