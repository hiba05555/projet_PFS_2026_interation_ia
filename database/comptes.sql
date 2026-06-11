-- ==========================================
-- AJOUTER LES TYPES ENUM (si pas déjà fait)
-- ==========================================
DO $$ 
BEGIN
    -- Type pour les rôles
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
        CREATE TYPE user_role_enum AS ENUM ('admin', 'manager', 'employee');
    END IF;
    
    -- Type pour les départements
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_department_enum') THEN
        CREATE TYPE user_department_enum AS ENUM ('IT', 'HR', 'Finance', 'Operations');
    END IF;
END $$;

-- ==========================================
-- MODIFIER LA TABLE USERS (utiliser les ENUM)
-- ==========================================
ALTER TABLE auth_schema.users 
  ALTER COLUMN role TYPE user_role_enum USING role::user_role_enum,
  ALTER COLUMN department TYPE user_department_enum USING department::user_department_enum;

-- ==========================================
-- AJOUTER LES INDEX RBAC
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_users_role ON auth_schema.users(role);
CREATE INDEX IF NOT EXISTS idx_users_department ON auth_schema.users(department);

-- ==========================================
-- AJOUTER LES 6 COMPTES DE TEST
-- ==========================================

-- 1. ADMIN
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'admin', 
    'admin@dataprotect.ma', 
    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WxQdZH5gYX5YU3HmNTy3i',
    'admin'::user_role_enum,
    NULL,
    'Administrateur Système',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'admin'::user_role_enum,
    department = NULL,
    password_hash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WxQdZH5gYX5YU3HmNTy3i';

-- 2. IT MANAGER
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'it_manager', 
    'it.manager@dataprotect.ma', 
    '$2b$10$rQZ5vK8J9M3xN2pL4qR6tOuY7wE8fV9cX0bN1mK2jH3iS4dT5eU6',
    'manager'::user_role_enum,
    'IT'::user_department_enum,
    'Responsable Informatique',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'manager'::user_role_enum,
    department = 'IT'::user_department_enum,
    password_hash = '$2b$10$rQZ5vK8J9M3xN2pL4qR6tOuY7wE8fV9cX0bN1mK2jH3iS4dT5eU6';

-- 3. HR MANAGER
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'hr_manager', 
    'hr.manager@dataprotect.ma', 
    '$2b$10$aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7i',
    'manager'::user_role_enum,
    'HR'::user_department_enum,
    'Responsable Ressources Humaines',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'manager'::user_role_enum,
    department = 'HR'::user_department_enum,
    password_hash = '$2b$10$aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7i';

-- 4. FINANCE MANAGER
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'finance_manager', 
    'finance.manager@dataprotect.ma', 
    '$2b$10$iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1',
    'manager'::user_role_enum,
    'Finance'::user_department_enum,
    'Responsable Financier',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'manager'::user_role_enum,
    department = 'Finance'::user_department_enum,
    password_hash = '$2b$10$iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1';

-- 5. OPERATIONS MANAGER
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'ops_manager', 
    'ops.manager@dataprotect.ma', 
    '$2b$10$qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5',
    'manager'::user_role_enum,
    'Operations'::user_department_enum,
    'Responsable Opérations',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'manager'::user_role_enum,
    department = 'Operations'::user_department_enum,
    password_hash = '$2b$10$qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5';

-- 6. EMPLOYÉ IT
INSERT INTO auth_schema.users (username, email, password_hash, role, department, job_title, is_active)
VALUES (
    'employee_it', 
    'employee@dataprotect.ma', 
    '$2b$10$yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6aB7cD8eF9',
    'employee'::user_role_enum,
    'IT'::user_department_enum,
    'Technicien Support IT',
    true
)
ON CONFLICT (email) DO UPDATE SET
    role = 'employee'::user_role_enum,
    department = 'IT'::user_department_enum,
    password_hash = '$2b$10$yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6aB7cD8eF9';

-- ==========================================
-- VÉRIFICATION FINALE
-- ==========================================
SELECT 
    username, 
    email, 
    role, 
    department, 
    job_title 
FROM auth_schema.users 
ORDER BY role, department;