-- ============================================================
-- ERP DATAPROTECT — SCHÉMA COMPLET (aligné sur les services)
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- AUTH SCHEMA
-- ==========================================
CREATE SCHEMA IF NOT EXISTS auth_schema;

CREATE TABLE IF NOT EXISTS auth_schema.users (
    user_id   SERIAL PRIMARY KEY,
    username  VARCHAR(100) UNIQUE NOT NULL,
    email     VARCHAR(255) UNIQUE NOT NULL,
    password_hash      VARCHAR(255) NOT NULL,
    role               VARCHAR(50)  DEFAULT 'employee',
    department         VARCHAR(100),
    job_title          VARCHAR(100),
    is_active          BOOLEAN      DEFAULT true,
    must_change_password BOOLEAN    DEFAULT false,
    reset_token        VARCHAR(255),
    reset_token_expires TIMESTAMP,
    last_login         TIMESTAMP,
    created_at         TIMESTAMP    DEFAULT NOW(),
    updated_at         TIMESTAMP    DEFAULT NOW()
);

-- Admin par défaut (mot de passe: admin123)
INSERT INTO auth_schema.users (username, email, password_hash, role, department, is_active)
VALUES ('admin', 'admin@erp.com', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'admin', 'IT', true)
ON CONFLICT (email) DO NOTHING;

-- ========== COMPTES DE TEST POUR RBAC ==========
-- Tous utilisent le mot de passe: admin123

INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES ('it_manager', 'it.manager@dataprotect.ma', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'manager', 'IT', 'Responsable Informatique', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES ('hr_manager', 'hr.manager@dataprotect.ma', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'manager', 'HR', 'Responsable Ressources Humaines', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES ('finance_manager', 'finance.manager@dataprotect.ma', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'manager', 'Finance', 'Responsable Financier', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES ('ops_manager', 'ops.manager@dataprotect.ma', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'manager', 'Operations', 'Responsable Opérations', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES ('employee_it', 'employee@dataprotect.ma', '$2b$10$SHVr/xTMAGViFVeXoSNsFOWybJCuMjgf.CcWlFmhDiVicVxbEB2DW', 'employee', 'IT', 'Technicien Support IT', true)
ON CONFLICT (email) DO NOTHING;


-- ==========================================
-- IT SCHEMA
-- ==========================================
CREATE SCHEMA IF NOT EXISTS it_schema;

-- IT User Accounts (service it/user-accounts — distinct de auth)
CREATE TABLE IF NOT EXISTS it_schema.user_accounts (
    account_id   SERIAL PRIMARY KEY,
    username     VARCHAR(100) UNIQUE NOT NULL,
    email        VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role         VARCHAR(50)  DEFAULT 'employee',
    department   VARCHAR(100),
    job_title    VARCHAR(100),
    is_active    BOOLEAN      DEFAULT true,
    created_by   INTEGER      REFERENCES it_schema.user_accounts(account_id),
    last_login   TIMESTAMP,
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- Helpdesk Tickets
CREATE TABLE IF NOT EXISTS it_schema.helpdesk_tickets (
    ticket_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number   VARCHAR(50) UNIQUE NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT         NOT NULL,
    priority        VARCHAR(20)  DEFAULT 'medium',
    category        VARCHAR(50)  DEFAULT 'general',
    status          VARCHAR(50)  DEFAULT 'open',
    created_by      INTEGER,
    assigned_to     INTEGER,
    resolution_notes TEXT,
    resolved_at     TIMESTAMP,
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- Equipment
CREATE TABLE IF NOT EXISTS it_schema.equipment (
    equipment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    type          VARCHAR(100) NOT NULL,
    brand         VARCHAR(100),
    model         VARCHAR(100),
    serial_number VARCHAR(100) UNIQUE,
    purchase_date DATE,
    purchase_price DECIMAL(12,2),
    warranty_end  DATE,
    assigned_to   INTEGER,
    location      VARCHAR(255),
    notes         TEXT,
    added_by      INTEGER,
    status        VARCHAR(50)  DEFAULT 'available',
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- Monitoring Metrics
CREATE TABLE IF NOT EXISTS it_schema.monitoring_metrics (
    metric_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name    VARCHAR(200) NOT NULL,
    metric_type     VARCHAR(100) NOT NULL,
    value           DECIMAL(15,4) NOT NULL,
    unit            VARCHAR(20),
    threshold_warn  DECIMAL(15,4),
    threshold_crit  DECIMAL(15,4),
    alert_level     VARCHAR(20)  DEFAULT 'ok',
    host            VARCHAR(200),
    tags            JSONB        DEFAULT '{}',
    recorded_by     INTEGER,
    recorded_at     TIMESTAMP    DEFAULT NOW(),
    created_at      TIMESTAMP    DEFAULT NOW()
);

-- Monitoring Alerts
CREATE TABLE IF NOT EXISTS it_schema.monitoring_alerts (
    alert_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name    VARCHAR(200) NOT NULL,
    severity        VARCHAR(20)  NOT NULL,
    message         TEXT         NOT NULL,
    metric_type     VARCHAR(100),
    value           DECIMAL(15,4),
    host            VARCHAR(200),
    status          VARCHAR(20)  DEFAULT 'open',
    acknowledged_at  TIMESTAMP,
    acknowledged_by  INTEGER,
    resolved_at      TIMESTAMP,
    created_by       INTEGER,
    created_at       TIMESTAMP   DEFAULT NOW(),
    updated_at       TIMESTAMP   DEFAULT NOW()
);

-- Software Licenses
CREATE TABLE IF NOT EXISTS it_schema.software_licenses (
    license_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    software_name VARCHAR(255) NOT NULL,
    vendor        VARCHAR(255),
    license_type  VARCHAR(50),
    license_key   TEXT,
    seats         INTEGER      DEFAULT 1,
    seats_used    INTEGER      DEFAULT 0,
    purchase_date DATE,
    expiry_date   DATE,
    renewal_cost  DECIMAL(12,2),
    contact_email VARCHAR(255),
    notes         TEXT,
    status        VARCHAR(50)  DEFAULT 'active',
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- ==========================================
-- HR SCHEMA
-- ==========================================
CREATE SCHEMA IF NOT EXISTS hr_schema;

-- Employees
CREATE TABLE IF NOT EXISTS hr_schema.employees (
    employee_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_number VARCHAR(50)  UNIQUE NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(20),
    department      VARCHAR(100),
    position        VARCHAR(100),
    employment_type VARCHAR(50)  DEFAULT 'full_time',
    hire_date       DATE         NOT NULL,
    termination_date DATE,
    salary          DECIMAL(12,2),
    manager_id      UUID         REFERENCES hr_schema.employees(employee_id),
    status          VARCHAR(50)  DEFAULT 'active',
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- Leave Requests
CREATE TABLE IF NOT EXISTS hr_schema.leave_requests (
    leave_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID         REFERENCES hr_schema.employees(employee_id),
    leave_type      VARCHAR(50)  NOT NULL,
    start_date      DATE         NOT NULL,
    end_date        DATE         NOT NULL,
    total_days      INTEGER      NOT NULL,
    reason          TEXT,
    status          VARCHAR(50)  DEFAULT 'pending',
    approved_by     INTEGER,
    approved_at     TIMESTAMP,
    rejected_by     INTEGER,
    rejected_at     TIMESTAMP,
    rejection_reason TEXT,
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- Recruitment Candidates
CREATE TABLE IF NOT EXISTS hr_schema.recruitment_candidates (
    candidate_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    phone          VARCHAR(20),
    position_applied VARCHAR(100),
    department     VARCHAR(100),
    cv_url         TEXT,
    source         VARCHAR(100),
    notes          TEXT,
    created_by     INTEGER,
    status         VARCHAR(50)  DEFAULT 'new',
    created_at     TIMESTAMP    DEFAULT NOW(),
    updated_at     TIMESTAMP    DEFAULT NOW()
);

-- Candidate Interviews
CREATE TABLE IF NOT EXISTS hr_schema.candidate_interviews (
    interview_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   UUID         REFERENCES hr_schema.recruitment_candidates(candidate_id),
    interview_date TIMESTAMP    NOT NULL,
    interviewer    VARCHAR(200),
    type           VARCHAR(50)  DEFAULT 'technical',
    notes          TEXT,
    scheduled_by   INTEGER,
    created_at     TIMESTAMP    DEFAULT NOW()
);

-- Payroll Records
CREATE TABLE IF NOT EXISTS hr_schema.payroll_records (
    payroll_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id      UUID         REFERENCES hr_schema.employees(employee_id),
    amount           DECIMAL(12,2) NOT NULL,
    currency         VARCHAR(3)   DEFAULT 'MAD',
    payment_method   VARCHAR(50)  NOT NULL,
    pay_period_start DATE         NOT NULL,
    pay_period_end   DATE         NOT NULL,
    bonuses          DECIMAL(12,2) DEFAULT 0,
    deductions       DECIMAL(12,2) DEFAULT 0,
    notes            TEXT,
    created_by       INTEGER,
    approved_by      INTEGER,
    paid_at          TIMESTAMP,
    status           VARCHAR(50)  DEFAULT 'draft',
    created_at       TIMESTAMP    DEFAULT NOW(),
    updated_at       TIMESTAMP    DEFAULT NOW()
);

-- Performance Reviews
CREATE TABLE IF NOT EXISTS hr_schema.performance_reviews (
    review_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID         REFERENCES hr_schema.employees(employee_id),
    review_period   VARCHAR(50)  NOT NULL,
    review_date     DATE         NOT NULL,
    reviewer_id     INTEGER,
    overall_rating  INTEGER      CHECK (overall_rating >= 1 AND overall_rating <= 5),
    goals_rating    INTEGER      CHECK (goals_rating >= 1 AND goals_rating <= 5),
    skills_rating   INTEGER      CHECK (skills_rating >= 1 AND skills_rating <= 5),
    conduct_rating  INTEGER      CHECK (conduct_rating >= 1 AND conduct_rating <= 5),
    strengths       TEXT,
    improvements    TEXT,
    goals_next      TEXT,
    comments        TEXT,
    created_by      INTEGER,
    status          VARCHAR(50)  DEFAULT 'draft',
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- ==========================================
-- FINANCE SCHEMA
-- ==========================================
CREATE SCHEMA IF NOT EXISTS finance_schema;

-- Budgets
CREATE TABLE IF NOT EXISTS finance_schema.budgets (
    budget_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    amount      DECIMAL(15,2) NOT NULL,
    currency    VARCHAR(3)   DEFAULT 'MAD',
    category    VARCHAR(100) NOT NULL,
    fiscal_year INTEGER      NOT NULL,
    start_date  DATE,
    end_date    DATE,
    spent       DECIMAL(15,2) DEFAULT 0,
    created_by  INTEGER,
    status      VARCHAR(50)  DEFAULT 'active',
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW()
);

-- Financial Reports
CREATE TABLE IF NOT EXISTS finance_schema.financial_reports (
    report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        VARCHAR(255) NOT NULL,
    type         VARCHAR(100) NOT NULL,
    period_start DATE,
    period_end   DATE,
    description  TEXT,
    data         JSONB        DEFAULT '{}',
    created_by   INTEGER,
    status       VARCHAR(50)  DEFAULT 'draft',
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS finance_schema.payments (
    payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id     UUID,
    payee_name     VARCHAR(255) NOT NULL,
    payee_iban     VARCHAR(100),
    amount         DECIMAL(12,2) NOT NULL,
    currency       VARCHAR(3)   DEFAULT 'MAD',
    payment_method VARCHAR(50)  NOT NULL,
    payment_date   DATE         NOT NULL,
    reference      VARCHAR(200),
    notes          TEXT,
    created_by     INTEGER,
    executed_at    TIMESTAMP,
    status         VARCHAR(50)  DEFAULT 'pending',
    created_at     TIMESTAMP    DEFAULT NOW(),
    updated_at     TIMESTAMP    DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS finance_schema.expenses (
    expense_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    amount       DECIMAL(12,2) NOT NULL,
    currency     VARCHAR(3)   DEFAULT 'MAD',
    category     VARCHAR(100) NOT NULL,
    expense_date DATE         NOT NULL,
    budget_id    UUID,
    receipt_url  TEXT,
    created_by   INTEGER,
    approved_by  INTEGER,
    approved_at  TIMESTAMP,
    rejected_by  INTEGER,
    rejected_at  TIMESTAMP,
    paid_at      TIMESTAMP,
    status       VARCHAR(50)  DEFAULT 'pending',
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS finance_schema.invoices (
    invoice_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  VARCHAR(50) UNIQUE NOT NULL,
    client_name     VARCHAR(255) NOT NULL,
    client_email    VARCHAR(255),
    description     TEXT,
    amount          DECIMAL(12,2) NOT NULL,
    tax_rate        DECIMAL(5,2)  DEFAULT 0,
    tax_amount      DECIMAL(12,2) DEFAULT 0,
    total_amount    DECIMAL(12,2) NOT NULL,
    currency        VARCHAR(3)   DEFAULT 'MAD',
    due_date        DATE         NOT NULL,
    line_items      JSONB        DEFAULT '[]',
    created_by      INTEGER,
    payment_received_at TIMESTAMP,
    status          VARCHAR(50)  DEFAULT 'draft',
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW()
);

-- ==========================================
-- OPERATIONS SCHEMA
-- ==========================================
CREATE SCHEMA IF NOT EXISTS ops_schema;

-- Tasks
CREATE TABLE IF NOT EXISTS ops_schema.tasks (
    task_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    priority     VARCHAR(20)  DEFAULT 'medium',
    due_date     DATE,
    assigned_to  INTEGER,
    project_id   UUID,
    tags         JSONB        DEFAULT '[]',
    created_by   INTEGER,
    completed_at TIMESTAMP,
    status       VARCHAR(50)  DEFAULT 'todo',
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- Workflow Definitions
CREATE TABLE IF NOT EXISTS ops_schema.workflow_definitions (
    definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    type          VARCHAR(100),
    steps         JSONB        DEFAULT '[]',
    triggered_by  VARCHAR(200),
    created_by    INTEGER,
    status        VARCHAR(50)  DEFAULT 'active',
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- Workflow Instances
CREATE TABLE IF NOT EXISTS ops_schema.workflow_instances (
    instance_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id   UUID         REFERENCES ops_schema.workflow_definitions(definition_id),
    title         VARCHAR(255),
    initiated_by  INTEGER,
    initiated_for VARCHAR(255),
    context       JSONB        DEFAULT '{}',
    current_step  INTEGER      DEFAULT 0,
    completed_at  TIMESTAMP,
    status        VARCHAR(50)  DEFAULT 'active',
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

-- Workflow Step Logs
CREATE TABLE IF NOT EXISTS ops_schema.workflow_step_logs (
    log_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id  UUID         REFERENCES ops_schema.workflow_instances(instance_id),
    step_order   INTEGER,
    action       VARCHAR(200),
    performed_by INTEGER,
    comment      TEXT,
    created_at   TIMESTAMP    DEFAULT NOW()
);

-- Suppliers
CREATE TABLE IF NOT EXISTS ops_schema.suppliers (
    supplier_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               VARCHAR(200) NOT NULL,
    contact_name       VARCHAR(100),
    email              VARCHAR(255),
    phone              VARCHAR(20),
    address            VARCHAR(500),
    country            VARCHAR(100),
    category           VARCHAR(100) NOT NULL,
    payment_terms      VARCHAR(20)  DEFAULT 'net_30',
    currency           VARCHAR(3)   DEFAULT 'MAD',
    tax_id             VARCHAR(100),
    website            VARCHAR(500),
    notes              TEXT,
    created_by         INTEGER,
    rating             INTEGER      DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    last_rating_comment TEXT,
    last_rated_at      TIMESTAMP,
    status             VARCHAR(50)  DEFAULT 'active',
    created_at         TIMESTAMP    DEFAULT NOW(),
    updated_at         TIMESTAMP    DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS ops_schema.projects (
    project_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    manager_id  INTEGER,
    budget      DECIMAL(15,2),
    currency    VARCHAR(3)   DEFAULT 'MAD',
    start_date  DATE         NOT NULL,
    end_date    DATE,
    priority    VARCHAR(20)  DEFAULT 'medium',
    tags        JSONB        DEFAULT '[]',
    created_by  INTEGER,
    progress    INTEGER      DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    status      VARCHAR(50)  DEFAULT 'planning',
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW()
);

-- Project Members
CREATE TABLE IF NOT EXISTS ops_schema.project_members (
    project_id  UUID         REFERENCES ops_schema.projects(project_id) ON DELETE CASCADE,
    user_id     INTEGER      NOT NULL,
    role        VARCHAR(50)  DEFAULT 'member',
    PRIMARY KEY (project_id, user_id)
);

-- Inventory
CREATE TABLE IF NOT EXISTS ops_schema.inventory (
    item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(200) NOT NULL,
    sku          VARCHAR(100) UNIQUE,
    category     VARCHAR(100) NOT NULL,
    description  TEXT,
    quantity     INTEGER      DEFAULT 0 CHECK (quantity >= 0),
    min_quantity INTEGER      DEFAULT 0,
    unit_price   DECIMAL(12,2),
    currency     VARCHAR(3)   DEFAULT 'MAD',
    location     VARCHAR(200),
    supplier_id  UUID         REFERENCES ops_schema.suppliers(supplier_id),
    unit         VARCHAR(50)  DEFAULT 'pièce',
    created_by   INTEGER,
    status       VARCHAR(50)  DEFAULT 'active',
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- Inventory Movements
CREATE TABLE IF NOT EXISTS ops_schema.inventory_movements (
    movement_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID         REFERENCES ops_schema.inventory(item_id),
    quantity_before INTEGER      NOT NULL,
    quantity_after  INTEGER      NOT NULL,
    movement_qty    INTEGER      NOT NULL,
    type            VARCHAR(20)  NOT NULL CHECK (type IN ('in','out','adjustment')),
    reason          TEXT,
    reference       VARCHAR(200),
    performed_by    INTEGER,
    created_at      TIMESTAMP    DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_tickets_status       ON it_schema.helpdesk_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by   ON it_schema.helpdesk_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_equipment_status     ON it_schema.equipment(status);
CREATE INDEX IF NOT EXISTS idx_licenses_status      ON it_schema.software_licenses(status);
CREATE INDEX IF NOT EXISTS idx_metrics_service      ON it_schema.monitoring_metrics(service_name);
CREATE INDEX IF NOT EXISTS idx_alerts_status        ON it_schema.monitoring_alerts(status);

CREATE INDEX IF NOT EXISTS idx_employees_dept       ON hr_schema.employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status     ON hr_schema.employees(status);
CREATE INDEX IF NOT EXISTS idx_leave_status         ON hr_schema.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_employee       ON hr_schema.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee     ON hr_schema.payroll_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_status       ON hr_schema.payroll_records(status);

CREATE INDEX IF NOT EXISTS idx_budgets_status       ON finance_schema.budgets(status);
CREATE INDEX IF NOT EXISTS idx_expenses_status      ON finance_schema.expenses(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON finance_schema.invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_status      ON finance_schema.payments(status);

CREATE INDEX IF NOT EXISTS idx_tasks_status         ON ops_schema.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned       ON ops_schema.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_projects_status      ON ops_schema.projects(status);
CREATE INDEX IF NOT EXISTS idx_inventory_category   ON ops_schema.inventory(category);
CREATE INDEX IF NOT EXISTS idx_suppliers_status     ON ops_schema.suppliers(status);

DO $$
BEGIN
    RAISE NOTICE '✅ ERP DataProtect — schéma initialisé avec succès';
    RAISE NOTICE '   auth_schema  : 1 table (users + admin par défaut)';
    RAISE NOTICE '   it_schema    : 6 tables';
    RAISE NOTICE '   hr_schema    : 6 tables';
    RAISE NOTICE '   finance_schema: 5 tables';
    RAISE NOTICE '   ops_schema   : 8 tables';
    RAISE NOTICE '   TOTAL        : 26 tables + indexes';
END $$;
