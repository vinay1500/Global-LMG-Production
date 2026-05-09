# GLMG Database Schema Map

This file maps the database structure used across `backend`, `admin_backend`, `frontend`, and `admin_frontend` so it can be redrawn in draw.io.

## Folder Scope

- `backend`: source of truth for MySQL schema and most client-facing writes. The schema is defined in `backend/src/lib/schemaMigrations.ts` and applied through `backend/src/lib/migrations.ts`.
- `admin_backend`: uses the same normalized MySQL schema for admin reads and writes. It does not define a separate schema.
- `frontend`: no direct database tables. It consumes API contracts from `frontend/src/app/lib/api/contracts.ts`.
- `admin_frontend`: no direct database tables. It consumes API contracts from `admin_frontend/src/app/lib/api/contracts.ts`.

## Runtime RDBMS Patterns

- Database engine: MySQL with `ENGINE=InnoDB`, `utf8mb4`, and `utf8mb4_0900_ai_ci` across the normalized schema.
- Transactions with rollback: `backend/src/lib/mysqlUtils.ts` and `admin_backend/src/lib/mysql.ts` wrap multi-step writes in `beginTransaction -> commit / rollback`.
- Explicit row locking: only `SELECT ... FOR UPDATE` was found, both on `business_sequences` for number allocation in `backend/src/modules/platform/sequences.ts` and `admin_backend/src/modules/packages/service.ts`.
- Soft delete / archival: many business tables use `archived_at`; sessions use `revoked_at`; auth tokens use `consumed_at`; messages use `deleted_at`.
- Optimistic change tracking: several mutable tables use `row_version`, and many admin write paths increment it explicitly.
- Foreign keys: the normalized schema heavily uses FKs with `CASCADE`, `RESTRICT`, and `SET NULL`.
- Check constraints: amount, count, interval, percent, and time-validity rules are enforced with `CHECK (...)` constraints.
- Search indexing: `matters` has `FULLTEXT KEY ftx_matters_title_issue (title, issue_summary)`.
- Not found in the current codebase: triggers, stored procedures, savepoints, `LOCK TABLES`, or explicit isolation-level changes.

## Current vs Legacy

- Current normalized schema: all active tables below.
- Historical-only / dropped schema: early `dashboard_*`, `auth_accounts`, legacy `auth_sessions`, `auth_flows_legacy_pre_009`, and `stored_uploads` appear only in historical migrations. They were removed from the active schema by migrations `051-drop-dead-legacy-tables` and `052-drop-stored-uploads-if-unused`.
- Low-usage but defined normalized tables: `security_events`, `subscription_plans`, `subscription_plan_services`, `subscriptions`, `event_reminders`, and `schema_migrations` exist in schema, but current runtime code has little or no direct usage outside migration/bootstrap paths.
- Important modeling gap: `counsel_partner_expertise` has ID columns that imply relationships to `counsel_partners`, `legal_domains`, and `services`, but no foreign keys are declared in the migration file.

## Table Catalog

### System

#### schema_migrations

Source status: active normalized schema
Runtime references outside migrations: 0

**Columns**

- `id` VARCHAR(64) PRIMARY KEY
- `description` VARCHAR(255) NOT NULL
- `checksum` CHAR(64) NOT NULL
- `executed_at` DATETIME(3) NOT NULL

#### business_sequences

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/modules/platform/sequences.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `sequence_key` VARCHAR(64) NOT NULL
- `sequence_year` SMALLINT UNSIGNED NOT NULL
- `next_value` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (sequence_key, sequence_year)
- [CHECK] CONSTRAINT chk_business_sequences_next_value CHECK (next_value > 0)

### IAM & Security

#### users

Source status: active normalized schema
Runtime references outside migrations: 34 (`backend/src/modules/access/repository.ts`, `backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/clientAccounts/repository.ts`, `backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `email` VARCHAR(255) NOT NULL
- `phone` VARCHAR(40) NULL
- `display_name` VARCHAR(160) NOT NULL
- `first_name` VARCHAR(80) NOT NULL
- `last_name` VARCHAR(80) NULL
- `actor_type_code` VARCHAR(32) NOT NULL
- `account_status_code` VARCHAR(32) NOT NULL
- `timezone_name` VARCHAR(64) NOT NULL DEFAULT 'UTC'
- `locale_code` VARCHAR(16) NOT NULL DEFAULT 'en-US'
- `avatar_url` VARCHAR(500) NULL
- `login_enabled` TINYINT(1) NOT NULL DEFAULT 1
- `last_login_at` DATETIME(6) NULL
- `email_verified_at` DATETIME(6) NULL
- `phone_verified_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_users_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_users_email (email)
- [UNIQUE] UNIQUE KEY uq_users_phone (phone)

#### user_credentials

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/modules/auth/mysqlAuthStore.ts`, `admin_backend/src/modules/auth/service.ts`)

**Columns**

- `user_id` BIGINT UNSIGNED NOT NULL
- `password_hash` VARCHAR(255) NOT NULL
- `password_algo` VARCHAR(64) NOT NULL
- `password_changed_at` DATETIME(6) NOT NULL
- `must_rotate_password` TINYINT(1) NOT NULL DEFAULT 0

**Keys / Constraints**

- [PK] PRIMARY KEY (user_id)
- [FK] CONSTRAINT fk_user_credentials_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### user_oauth_accounts

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `provider_subject` VARCHAR(255) NOT NULL
- `provider_email` VARCHAR(255) NULL
- `linked_at` DATETIME(6) NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_user_oauth_accounts_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_user_oauth_provider_subject (provider_code, provider_subject)
- [FK] CONSTRAINT fk_user_oauth_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### user_sessions

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/modules/auth/mysqlAuthStore.ts`, `admin_backend/src/modules/auth/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `session_token_hash` CHAR(64) NOT NULL
- `csrf_secret_hash` CHAR(64) NOT NULL
- `remember_me` TINYINT(1) NOT NULL DEFAULT 0
- `ip_address` VARCHAR(45) NULL
- `user_agent` TEXT NULL
- `device_label` VARCHAR(100) NULL
- `expires_at` DATETIME(6) NOT NULL
- `last_seen_at` DATETIME(6) NOT NULL
- `revoked_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_user_sessions_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_user_sessions_token_hash (session_token_hash)
- [INDEX] INDEX idx_user_sessions_user (user_id)
- [INDEX] INDEX idx_user_sessions_expires (expires_at)
- [FK] CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### email_verification_tokens

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `purpose_code` VARCHAR(32) NOT NULL
- `code_hash` CHAR(64) NOT NULL
- `expires_at` DATETIME(6) NOT NULL
- `sent_at` DATETIME(6) NOT NULL
- `consumed_at` DATETIME(6) NULL
- `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_email_verification_public_id (public_id)
- [INDEX] INDEX idx_email_verification_user (user_id)
- [INDEX] INDEX idx_email_verification_expires (expires_at)
- [FK] CONSTRAINT fk_email_verification_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### phone_verification_tokens

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `phone_snapshot` VARCHAR(40) NOT NULL
- `purpose_code` VARCHAR(32) NOT NULL
- `code_hash` CHAR(64) NULL
- `expires_at` DATETIME(6) NOT NULL
- `sent_at` DATETIME(6) NOT NULL
- `consumed_at` DATETIME(6) NULL
- `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `provider_code` VARCHAR(32) NULL
- `provider_reference` VARCHAR(255) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_phone_verification_public_id (public_id)
- [INDEX] INDEX idx_phone_verification_user (user_id)
- [INDEX] INDEX idx_phone_verification_expires (expires_at)
- [FK] CONSTRAINT fk_phone_verification_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [INDEX] INDEX idx_phone_verification_provider (provider_code, provider_reference)

#### password_reset_tokens

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `code_hash` CHAR(64) NOT NULL
- `expires_at` DATETIME(6) NOT NULL
- `sent_at` DATETIME(6) NOT NULL
- `consumed_at` DATETIME(6) NULL
- `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_password_reset_public_id (public_id)
- [INDEX] INDEX idx_password_reset_user (user_id)
- [INDEX] INDEX idx_password_reset_expires (expires_at)
- [FK] CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### auth_flows

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `purpose_code` VARCHAR(32) NOT NULL
- `remember_me` TINYINT(1) NOT NULL DEFAULT 0
- `pending_phone` VARCHAR(40) NULL
- `pending_country` VARCHAR(80) NULL
- `oauth_provider_code` VARCHAR(32) NULL
- `email_token_id` BIGINT UNSIGNED NULL
- `phone_token_id` BIGINT UNSIGNED NULL
- `password_reset_token_id` BIGINT UNSIGNED NULL
- `flow_token_hash` CHAR(64) NOT NULL
- `expires_at` DATETIME(6) NOT NULL
- `consumed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_auth_flows_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_auth_flows_token_hash (flow_token_hash)
- [INDEX] INDEX idx_auth_flows_user (user_id)
- [INDEX] INDEX idx_auth_flows_expires (expires_at)
- [FK] CONSTRAINT fk_auth_flows_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_auth_flows_email_token FOREIGN KEY (email_token_id) REFERENCES email_verification_tokens (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_auth_flows_phone_token FOREIGN KEY (phone_token_id) REFERENCES phone_verification_tokens (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_auth_flows_password_reset_token FOREIGN KEY (password_reset_token_id) REFERENCES password_reset_tokens (id) ON UPDATE CASCADE ON DELETE SET NULL

#### oauth_nonces

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/auth/oauthNonceStore.ts`)
Note: this is the active Google ID-token nonce table; the implementation uses the generic OAuth nonce table name.

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `purpose_code` VARCHAR(32) NOT NULL DEFAULT 'sign_in'
- `nonce_hash` CHAR(64) NOT NULL
- `expires_at` DATETIME(6) NOT NULL
- `consumed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_oauth_nonces_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_oauth_nonces_provider_nonce (provider_code, nonce_hash)
- [INDEX] INDEX idx_oauth_nonces_provider_expiry (provider_code, expires_at, consumed_at)

#### idempotency_keys

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/lib/idempotency.ts`, `admin_backend/src/lib/idempotency.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `scope_code` VARCHAR(96) NOT NULL
- `idempotency_key_hash` CHAR(64) NOT NULL
- `actor_key_hash` CHAR(64) NULL
- `actor_user_id` BIGINT UNSIGNED NULL
- `request_method` VARCHAR(16) NOT NULL
- `request_path` VARCHAR(255) NOT NULL
- `request_fingerprint_hash` CHAR(64) NOT NULL
- `status_code` VARCHAR(32) NOT NULL DEFAULT 'processing'
- `response_status_code` SMALLINT UNSIGNED NULL
- `response_body_json` JSON NULL
- `locked_until` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_idempotency_scope_key (scope_code, idempotency_key_hash)
- [INDEX] INDEX idx_idempotency_actor (actor_key_hash, created_at)
- [INDEX] INDEX idx_idempotency_created_at (created_at)
- [INDEX] INDEX idx_idempotency_locked_until (locked_until)
- [FK] CONSTRAINT fk_idempotency_actor_user FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### rate_limit_buckets

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/modules/auth/persistentRateLimiter.ts`, `admin_backend/src/modules/auth/persistentRateLimiter.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `scope_code` VARCHAR(48) NOT NULL
- `bucket_key_hash` CHAR(64) NOT NULL
- `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0
- `window_started_at` DATETIME(6) NOT NULL
- `window_resets_at` DATETIME(6) NOT NULL
- `blocked_until` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_rate_limit_bucket (scope_code, bucket_key_hash)
- [INDEX] INDEX idx_rate_limit_reset (window_resets_at)
- [INDEX] INDEX idx_rate_limit_blocked_until (blocked_until)

#### admin_mfa_secrets

Source status: active normalized schema
Runtime references outside migrations: 1 (`admin_backend/src/modules/auth/mfa.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `user_id` BIGINT UNSIGNED NOT NULL
- `secret_encrypted` TEXT NOT NULL
- `enabled_at` DATETIME(6) NULL
- `recovery_codes_hash_json` JSON NULL
- `last_verified_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_admin_mfa_user (user_id)
- [FK] CONSTRAINT fk_admin_mfa_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### security_events

Source status: active normalized schema
Runtime references outside migrations: 0

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NULL
- `identifier_value` VARCHAR(255) NULL
- `event_type_code` VARCHAR(64) NOT NULL
- `success_flag` TINYINT(1) NOT NULL
- `ip_address` VARCHAR(45) NULL
- `user_agent` TEXT NULL
- `occurred_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_security_events_public_id (public_id)
- [INDEX] INDEX idx_security_events_user (user_id)
- [INDEX] INDEX idx_security_events_occurred_at (occurred_at)
- [FK] CONSTRAINT fk_security_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### user_legal_acceptances

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/auth/mysqlAuthStore.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `acceptance_type_code` VARCHAR(64) NOT NULL
- `source_code` VARCHAR(64) NOT NULL
- `accepted_at` DATETIME(6) NOT NULL
- `ip_address` VARCHAR(45) NULL
- `user_agent` TEXT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_user_legal_acceptances_public_id (public_id)
- [INDEX] INDEX idx_user_legal_acceptances_user (user_id)
- [INDEX] INDEX idx_user_legal_acceptances_type (user_id, acceptance_type_code, accepted_at)
- [FK] CONSTRAINT fk_user_legal_acceptances_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

### RBAC

#### roles

Source status: active normalized schema
Runtime references outside migrations: 10 (`backend/src/modules/access/repository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `backend/src/modules/platform/referenceData.ts`, `backend/src/routes/admin.ts`, `admin_backend/src/modules/dashboard/service.ts`, ...)

**Columns**

- `code` VARCHAR(64) NOT NULL
- `name` VARCHAR(120) NOT NULL
- `description` TEXT NULL
- `is_system` TINYINT(1) NOT NULL DEFAULT 1
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### permissions

Source status: active normalized schema
Runtime references outside migrations: 8 (`backend/src/modules/access/repository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `backend/src/modules/platform/referenceData.ts`, `backend/src/routes/admin.ts`, `admin_backend/src/modules/rbac/service.ts`, ...)

**Columns**

- `code` VARCHAR(128) NOT NULL
- `module_name` VARCHAR(64) NOT NULL
- `action_name` VARCHAR(64) NOT NULL
- `description` TEXT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### role_permissions

Source status: active normalized schema
Runtime references outside migrations: 4 (`backend/src/modules/access/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `admin_backend/src/modules/auth/service.ts`, `admin_backend/src/modules/rbac/service.ts`)

**Columns**

- `role_code` VARCHAR(64) NOT NULL
- `permission_code` VARCHAR(128) NOT NULL
- `granted_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (role_code, permission_code)
- [FK] CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_code) REFERENCES roles (code) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_code) REFERENCES permissions (code) ON UPDATE CASCADE ON DELETE CASCADE

#### user_roles

Source status: active normalized schema
Runtime references outside migrations: 6 (`backend/src/modules/access/repository.ts`, `backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/auth/service.ts`, `admin_backend/src/modules/matters/service.ts`, `admin_backend/src/modules/rbac/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `user_id` BIGINT UNSIGNED NOT NULL
- `role_code` VARCHAR(64) NOT NULL
- `granted_by_user_id` BIGINT UNSIGNED NULL
- `starts_at` DATETIME(6) NULL
- `ends_at` DATETIME(6) NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_user_roles_unique_assignment (user_id, role_code, is_active)
- [FK] CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_user_roles_role FOREIGN KEY (role_code) REFERENCES roles (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_user_roles_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### staff_profiles

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `user_id` BIGINT UNSIGNED NOT NULL
- `job_title` VARCHAR(120) NOT NULL
- `employment_status_code` VARCHAR(32) NOT NULL
- `manager_user_id` BIGINT UNSIGNED NULL
- `city` VARCHAR(100) NULL
- `state` VARCHAR(100) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (user_id)
- [INDEX] INDEX idx_staff_profiles_manager (manager_user_id)
- [FK] CONSTRAINT fk_staff_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_staff_profiles_manager FOREIGN KEY (manager_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

### Clients & Counsel

#### client_accounts

Source status: active normalized schema
Runtime references outside migrations: 13 (`backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/mysqlStoredUploadRepository.ts`, `backend/src/modules/storage/service.ts`, `admin_backend/src/modules/audit/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `client_code` VARCHAR(50) NOT NULL
- `client_type_code` VARCHAR(32) NOT NULL
- `legal_name` VARCHAR(200) NOT NULL
- `display_name` VARCHAR(200) NOT NULL
- `billing_name` VARCHAR(200) NOT NULL
- `primary_email` VARCHAR(255) NOT NULL
- `primary_phone` VARCHAR(40) NOT NULL
- `gstin` CHAR(15) NULL
- `tax_identifier` VARCHAR(64) NULL
- `onboarding_status_code` VARCHAR(32) NOT NULL
- `account_status_code` VARCHAR(32) NOT NULL
- `owner_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_client_accounts_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_client_accounts_client_code (client_code)
- [INDEX] INDEX idx_client_accounts_owner (owner_user_id)
- [FK] CONSTRAINT fk_client_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### client_account_contacts

Source status: active normalized schema  
Runtime references outside migrations: 12 (`backend/src/modules/access/repository.ts`, `backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/clientAccounts/repository.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domainEvents/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `contact_role_code` VARCHAR(32) NOT NULL
- `is_primary` TINYINT(1) NOT NULL DEFAULT 0
- `is_billing` TINYINT(1) NOT NULL DEFAULT 0
- `portal_access_enabled` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_client_account_contacts (client_account_id, user_id)
- [INDEX] INDEX idx_client_account_contacts_user (user_id)
- [FK] CONSTRAINT fk_client_account_contacts_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_client_account_contacts_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### client_addresses

Source status: active normalized schema  
Runtime references outside migrations: 7 (`backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/clients/service.ts`, `admin_backend/src/modules/packages/service.ts`, `admin_backend/src/modules/search/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `address_type_code` VARCHAR(32) NOT NULL
- `line1` VARCHAR(255) NOT NULL
- `line2` VARCHAR(255) NULL
- `city` VARCHAR(100) NOT NULL
- `state` VARCHAR(100) NOT NULL
- `postal_code` VARCHAR(20) NOT NULL
- `country_code` VARCHAR(16) NOT NULL
- `is_primary` TINYINT(1) NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_client_addresses_account (client_account_id)
- [FK] CONSTRAINT fk_client_addresses_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE CASCADE
- [INDEX] INDEX idx_client_addresses_primary_lookup (client_account_id, archived_at, is_primary, id)

#### user_notification_preferences

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/auth/mysqlAuthStore.ts`, `backend/src/modules/clientAccounts/repository.ts`)

**Columns**

- `user_id` BIGINT UNSIGNED NOT NULL
- `email_updates` TINYINT(1) NOT NULL DEFAULT 1
- `sms_alerts` TINYINT(1) NOT NULL DEFAULT 1
- `invoice_reminders` TINYINT(1) NOT NULL DEFAULT 1
- `case_activity_alerts` TINYINT(1) NOT NULL DEFAULT 1
- `product_announcements` TINYINT(1) NOT NULL DEFAULT 0
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (user_id)
- [FK] CONSTRAINT fk_user_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE

#### counsel_partners

Source status: active normalized schema  
Runtime references outside migrations: 5 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/matters/service.ts`, `admin_backend/src/modules/shared.ts`, `admin_backend/src/modules/writeSupport.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `counsel_code` VARCHAR(50) NOT NULL
- `full_name` VARCHAR(160) NOT NULL
- `organization_name` VARCHAR(200) NULL
- `email` VARCHAR(255) NOT NULL
- `phone` VARCHAR(40) NOT NULL
- `bar_registration_number` VARCHAR(80) NULL
- `primary_jurisdiction` VARCHAR(120) NOT NULL
- `city` VARCHAR(100) NOT NULL
- `state` VARCHAR(100) NOT NULL
- `country_code` VARCHAR(16) NOT NULL
- `years_experience` SMALLINT UNSIGNED NOT NULL
- `availability_status_code` VARCHAR(32) NOT NULL
- `partner_status_code` VARCHAR(32) NOT NULL
- `invited_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_counsel_partners_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_counsel_partners_counsel_code (counsel_code)
- [INDEX] INDEX idx_counsel_partners_invited_user (invited_user_id)
- [FK] CONSTRAINT fk_counsel_partners_invited_user FOREIGN KEY (invited_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### counsel_partner_expertise

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `counsel_partner_id` BIGINT UNSIGNED NOT NULL
- `legal_domain_id` BIGINT UNSIGNED NOT NULL
- `service_id` BIGINT UNSIGNED NULL
- `proficiency_level_code` VARCHAR(32) NOT NULL
- `years_experience` SMALLINT UNSIGNED NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_counsel_partner_expertise (counsel_partner_id, legal_domain_id, service_id)
- [INDEX] INDEX idx_counsel_partner_expertise_service (service_id)

### Catalog & Pricing

#### legal_domains

Source status: active normalized schema  
Runtime references outside migrations: 4 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `domain_code` VARCHAR(64) NOT NULL
- `domain_name` VARCHAR(160) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_legal_domains_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_legal_domains_code (domain_code)

#### services

Source status: active normalized schema  
Runtime references outside migrations: 25 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domain/types.ts`, `backend/src/modules/platform/bootstrap.ts`, `backend/src/routes/dashboard.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `service_code` VARCHAR(64) NOT NULL
- `legal_domain_id` BIGINT UNSIGNED NOT NULL
- `service_name` VARCHAR(180) NOT NULL
- `service_description` TEXT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `is_subscription_eligible` TINYINT(1) NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_services_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_services_code (service_code)
- [INDEX] INDEX idx_services_domain (legal_domain_id)
- [FK] CONSTRAINT fk_services_domain FOREIGN KEY (legal_domain_id) REFERENCES legal_domains (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### consultation_modes

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(100) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### request_statuses

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### matter_stages

Source status: active normalized schema  
Runtime references outside migrations: 4 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `admin_backend/src/modules/dashboard/service.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `stage_order` INT NOT NULL
- `is_client_visible` TINYINT(1) NOT NULL DEFAULT 1
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)
- [CHECK] CONSTRAINT chk_matter_stages_stage_order CHECK (stage_order > 0)

#### matter_operational_statuses

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### invoice_statuses

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### payment_statuses

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### thread_statuses

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### event_statuses

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_terminal` TINYINT(1) NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### notification_types

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/notifications/repository.ts`, `backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `code` VARCHAR(64) NOT NULL
- `label` VARCHAR(140) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (code)

#### pricing_service_slabs

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `effective_from` DATE NOT NULL
- `effective_to` DATE NULL
- `min_service_count` INT UNSIGNED NOT NULL
- `max_service_count` INT UNSIGNED NULL
- `base_amount` DECIMAL(14,2) NOT NULL
- `per_extra_service_amount` DECIMAL(14,2) NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [CHECK] CONSTRAINT chk_pricing_service_slabs_counts CHECK ( min_service_count > 0 AND ( max_service_count IS NULL OR max_service_count >= min_service_count ) )
- [CHECK] CONSTRAINT chk_pricing_service_slabs_amounts CHECK ( base_amount >= 0 AND ( per_extra_service_amount IS NULL OR per_extra_service_amount >= 0 ) )

#### pricing_urgency_rules

Source status: active normalized schema  
Runtime references outside migrations: 4 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/platform/bootstrap.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `urgency_code` VARCHAR(32) NOT NULL
- `label` VARCHAR(120) NOT NULL
- `surcharge_type_code` VARCHAR(16) NOT NULL
- `surcharge_value` DECIMAL(14,2) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_pricing_urgency_rules_code (urgency_code)
- [CHECK] CONSTRAINT chk_pricing_urgency_rules_value CHECK (surcharge_value >= 0)

#### pricing_consultation_mode_rules

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `consultation_mode_code` VARCHAR(32) NOT NULL
- `surcharge_type_code` VARCHAR(16) NOT NULL
- `surcharge_value` DECIMAL(14,2) NOT NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_pricing_consultation_mode_rules_code (consultation_mode_code)
- [FK] CONSTRAINT fk_pricing_consultation_mode_rules_mode FOREIGN KEY (consultation_mode_code) REFERENCES consultation_modes (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_pricing_consultation_mode_rules_value CHECK (surcharge_value >= 0)

#### tax_rates

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/platform/bootstrap.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `tax_code` VARCHAR(32) NOT NULL
- `tax_name` VARCHAR(120) NOT NULL
- `rate_percent` DECIMAL(5,2) NOT NULL
- `jurisdiction_code` VARCHAR(32) NOT NULL
- `effective_from` DATE NOT NULL
- `effective_to` DATE NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_tax_rates_code (tax_code)
- [CHECK] CONSTRAINT chk_tax_rates_percent CHECK (rate_percent >= 0 AND rate_percent <= 100)

#### exchange_rates

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/modules/pricing/fx.ts`, `admin_backend/src/modules/pricing/fx.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `base_currency` CHAR(3) NOT NULL
- `quote_currency` CHAR(3) NOT NULL
- `rate` DECIMAL(20,8) NOT NULL
- `rate_date` DATE NOT NULL
- `provider` VARCHAR(64) NOT NULL DEFAULT 'manual'
- `fetched_at` DATETIME(6) NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_exchange_rates_pair_date_provider (base_currency, quote_currency, rate_date, provider)
- [INDEX] INDEX idx_exchange_rates_lookup (base_currency, quote_currency, rate_date)
- [CHECK] CONSTRAINT chk_exchange_rates_rate CHECK (rate > 0)

#### subscription_plans

Source status: active normalized schema  
Runtime references outside migrations: 0

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `plan_code` VARCHAR(64) NOT NULL
- `plan_name` VARCHAR(120) NOT NULL
- `description` TEXT NULL
- `billing_interval_code` VARCHAR(32) NOT NULL
- `interval_count` INT UNSIGNED NOT NULL DEFAULT 1
- `fee_amount` DECIMAL(14,2) NOT NULL
- `currency_code` CHAR(3) NOT NULL DEFAULT 'USD'
- `tax_rate_id` BIGINT UNSIGNED NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_subscription_plans_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_subscription_plans_code (plan_code)
- [FK] CONSTRAINT fk_subscription_plans_tax_rate FOREIGN KEY (tax_rate_id) REFERENCES tax_rates (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_subscription_plans_amount CHECK (fee_amount >= 0)
- [CHECK] CONSTRAINT chk_subscription_plans_interval CHECK (interval_count > 0)

#### subscription_plan_services

Source status: active normalized schema  
Runtime references outside migrations: 0

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `subscription_plan_id` BIGINT UNSIGNED NOT NULL
- `service_id` BIGINT UNSIGNED NOT NULL
- `included_quantity` INT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_subscription_plan_services (subscription_plan_id, service_id)
- [FK] CONSTRAINT fk_subscription_plan_services_plan FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_subscription_plan_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE RESTRICT

### Requests & Matters

#### service_requests

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `request_number` VARCHAR(50) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `requested_by_user_id` BIGINT UNSIGNED NOT NULL
- `status_code` VARCHAR(32) NOT NULL
- `title` VARCHAR(200) NOT NULL
- `issue_summary` VARCHAR(500) NOT NULL
- `detailed_description` LONGTEXT NULL
- `legal_domain_id` BIGINT UNSIGNED NOT NULL
- `consultation_mode_code` VARCHAR(32) NOT NULL
- `urgency_rule_id` BIGINT UNSIGNED NOT NULL
- `preferred_start_at` DATETIME(6) NULL
- `preferred_end_at` DATETIME(6) NULL
- `contact_name_snapshot` VARCHAR(160) NOT NULL
- `contact_email_snapshot` VARCHAR(255) NOT NULL
- `contact_mobile_snapshot` VARCHAR(40) NOT NULL
- `past_legal_action_flag` TINYINT(1) NOT NULL DEFAULT 0
- `quote_total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `submitted_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_service_requests_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_service_requests_number (request_number)
- [INDEX] INDEX idx_service_requests_client (client_account_id)
- [INDEX] INDEX idx_service_requests_status (status_code)
- [FK] CONSTRAINT fk_service_requests_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_service_requests_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_service_requests_status FOREIGN KEY (status_code) REFERENCES request_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_service_requests_legal_domain FOREIGN KEY (legal_domain_id) REFERENCES legal_domains (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_service_requests_consultation_mode FOREIGN KEY (consultation_mode_code) REFERENCES consultation_modes (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_service_requests_urgency_rule FOREIGN KEY (urgency_rule_id) REFERENCES pricing_urgency_rules (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_service_requests_quote_total CHECK (quote_total_amount >= 0)

#### request_services

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `service_request_id` BIGINT UNSIGNED NOT NULL
- `service_id` BIGINT UNSIGNED NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `quoted_base_fee` DECIMAL(14,2) NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_request_services (service_request_id, service_id)
- [FK] CONSTRAINT fk_request_services_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_request_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_request_services_fee CHECK (quoted_base_fee >= 0)

#### pricing_quotes

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `service_request_id` BIGINT UNSIGNED NOT NULL
- `version_no` INT UNSIGNED NOT NULL
- `service_count` INT UNSIGNED NOT NULL
- `base_amount` DECIMAL(14,2) NOT NULL
- `urgency_surcharge_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `consultation_mode_surcharge_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `tax_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `total_amount` DECIMAL(14,2) NOT NULL
- `currency_code` CHAR(3) NOT NULL DEFAULT 'USD'
- `is_final` TINYINT(1) NOT NULL DEFAULT 0
- `accepted_at` DATETIME(6) NULL
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_pricing_quotes_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_pricing_quotes_version (service_request_id, version_no)
- [FK] CONSTRAINT fk_pricing_quotes_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_pricing_quotes_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_pricing_quotes_amounts CHECK ( service_count > 0 AND base_amount >= 0 AND urgency_surcharge_amount >= 0 AND consultation_mode_surcharge_amount >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 )

#### pricing_quote_lines

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `pricing_quote_id` BIGINT UNSIGNED NOT NULL
- `line_type_code` VARCHAR(32) NOT NULL
- `service_id` BIGINT UNSIGNED NULL
- `pricing_rule_source_code` VARCHAR(64) NULL
- `description` VARCHAR(255) NOT NULL
- `quantity` DECIMAL(12,2) NOT NULL DEFAULT 1.00
- `unit_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `line_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_pricing_quote_lines_quote (pricing_quote_id)
- [FK] CONSTRAINT fk_pricing_quote_lines_quote FOREIGN KEY (pricing_quote_id) REFERENCES pricing_quotes (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_pricing_quote_lines_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_pricing_quote_lines_amounts CHECK ( quantity > 0 AND unit_amount >= 0 AND line_amount >= 0 )

#### request_status_history

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `service_request_id` BIGINT UNSIGNED NOT NULL
- `from_status_code` VARCHAR(32) NULL
- `to_status_code` VARCHAR(32) NOT NULL
- `changed_by_user_id` BIGINT UNSIGNED NULL
- `change_note` TEXT NULL
- `changed_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_request_status_history_request (service_request_id)
- [FK] CONSTRAINT fk_request_status_history_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_request_status_history_from FOREIGN KEY (from_status_code) REFERENCES request_statuses (code) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_request_status_history_to FOREIGN KEY (to_status_code) REFERENCES request_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_request_status_history_changed_by FOREIGN KEY (changed_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### matters

Source status: active normalized schema  
Runtime references outside migrations: 58 (`backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domainEvents/service.ts`, `backend/src/modules/notifications/repository.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `matter_number` VARCHAR(50) NOT NULL
- `service_request_id` BIGINT UNSIGNED NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `opened_by_user_id` BIGINT UNSIGNED NOT NULL
- `legal_domain_id` BIGINT UNSIGNED NOT NULL
- `title` VARCHAR(255) NOT NULL
- `issue_summary` VARCHAR(500) NOT NULL
- `detailed_description` LONGTEXT NULL
- `current_stage_code` VARCHAR(32) NOT NULL
- `operational_status_code` VARCHAR(32) NOT NULL
- `consultation_mode_code` VARCHAR(32) NOT NULL
- `urgency_rule_id` BIGINT UNSIGNED NOT NULL
- `priority_code` VARCHAR(32) NOT NULL
- `quoted_total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `paid_total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `refunded_total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `due_total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `opened_at` DATETIME(6) NOT NULL
- `last_activity_at` DATETIME(6) NOT NULL
- `closed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1
- `selected_matter_package_id` BIGINT UNSIGNED NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_matters_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_matters_number (matter_number)
- [UNIQUE] UNIQUE KEY uq_matters_request (service_request_id)
- [INDEX] INDEX idx_matters_client (client_account_id)
- [INDEX] INDEX idx_matters_status (operational_status_code)
- [FULLTEXT] FULLTEXT KEY ftx_matters_title_issue (title, issue_summary)
- [FK] CONSTRAINT fk_matters_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_matters_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_legal_domain FOREIGN KEY (legal_domain_id) REFERENCES legal_domains (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_stage FOREIGN KEY (current_stage_code) REFERENCES matter_stages (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_operational_status FOREIGN KEY (operational_status_code) REFERENCES matter_operational_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_consultation_mode FOREIGN KEY (consultation_mode_code) REFERENCES consultation_modes (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matters_urgency_rule FOREIGN KEY (urgency_rule_id) REFERENCES pricing_urgency_rules (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_matters_amounts CHECK ( quoted_total_amount >= 0 AND paid_total_amount >= 0 AND refunded_total_amount >= 0 AND due_total_amount >= 0 )
- [INDEX] INDEX idx_matters_selected_package (selected_matter_package_id)
- [FK] CONSTRAINT fk_matters_selected_package FOREIGN KEY (selected_matter_package_id) REFERENCES matter_packages (id) ON UPDATE CASCADE ON DELETE SET NULL

#### matter_services

Source status: active normalized schema  
Runtime references outside migrations: 5 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/matters/service.ts`, `admin_backend/src/modules/packages/service.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_id` BIGINT UNSIGNED NOT NULL
- `service_id` BIGINT UNSIGNED NOT NULL
- `final_fee` DECIMAL(14,2) NOT NULL DEFAULT 0
- `service_status_code` VARCHAR(32) NOT NULL
- `completed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_matter_services (matter_id, service_id)
- [FK] CONSTRAINT fk_matter_services_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_matter_services_fee CHECK (final_fee >= 0)

#### matter_assignments

Source status: active normalized schema  
Runtime references outside migrations: 5 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/audit/service.ts`, `admin_backend/src/modules/matters/service.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_id` BIGINT UNSIGNED NOT NULL
- `assignment_role_code` VARCHAR(32) NOT NULL
- `internal_user_id` BIGINT UNSIGNED NULL
- `counsel_partner_id` BIGINT UNSIGNED NULL
- `is_primary` TINYINT(1) NOT NULL DEFAULT 0
- `fee_agreed_amount` DECIMAL(14,2) NULL
- `fee_paid_amount` DECIMAL(14,2) NULL
- `fee_due_amount` DECIMAL(14,2) NULL
- `assigned_by_user_id` BIGINT UNSIGNED NOT NULL
- `assigned_at` DATETIME(6) NOT NULL
- `removed_at` DATETIME(6) NULL
- `assignment_status_code` VARCHAR(32) NOT NULL
- `notes` TEXT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_matter_assignments_matter (matter_id)
- [INDEX] INDEX idx_matter_assignments_internal_user (internal_user_id)
- [INDEX] INDEX idx_matter_assignments_counsel (counsel_partner_id)
- [FK] CONSTRAINT fk_matter_assignments_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_assignments_internal_user FOREIGN KEY (internal_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matter_assignments_counsel FOREIGN KEY (counsel_partner_id) REFERENCES counsel_partners (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matter_assignments_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_matter_assignments_fees CHECK ( (fee_agreed_amount IS NULL OR fee_agreed_amount >= 0) AND (fee_paid_amount IS NULL OR fee_paid_amount >= 0) AND (fee_due_amount IS NULL OR fee_due_amount >= 0) )

#### matter_stage_history

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/matters/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_id` BIGINT UNSIGNED NOT NULL
- `stage_code` VARCHAR(32) NOT NULL
- `entered_at` DATETIME(6) NOT NULL
- `exited_at` DATETIME(6) NULL
- `changed_by_user_id` BIGINT UNSIGNED NULL
- `visible_to_client` TINYINT(1) NOT NULL DEFAULT 1
- `change_note` TEXT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_matter_stage_history_matter (matter_id)
- [FK] CONSTRAINT fk_matter_stage_history_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_stage_history_stage FOREIGN KEY (stage_code) REFERENCES matter_stages (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_matter_stage_history_changed_by FOREIGN KEY (changed_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### matter_updates

Source status: active normalized schema  
Runtime references outside migrations: 5 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/audit/service.ts`, `admin_backend/src/modules/matters/service.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_id` BIGINT UNSIGNED NOT NULL
- `update_type_code` VARCHAR(32) NOT NULL
- `title` VARCHAR(200) NOT NULL
- `body_text` TEXT NOT NULL
- `visible_to_client` TINYINT(1) NOT NULL DEFAULT 1
- `created_by_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `edited_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_matter_updates_matter (matter_id)
- [FK] CONSTRAINT fk_matter_updates_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_updates_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### matter_packages

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `matter_id` BIGINT UNSIGNED NOT NULL
- `package_name` VARCHAR(160) NOT NULL
- `description` TEXT NULL
- `total_price` DECIMAL(14,2) NOT NULL
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1
- `proposal_version_no` INT UNSIGNED NOT NULL
- `display_order` INT NOT NULL DEFAULT 0
- `is_recommended` TINYINT(1) NOT NULL DEFAULT 0
- `published_at` DATETIME(6) NULL
- `superseded_at` DATETIME(6) NULL
- `selected_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_matter_packages_public_id (public_id)
- [INDEX] INDEX idx_matter_packages_matter (matter_id)
- [FK] CONSTRAINT fk_matter_packages_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_packages_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_matter_packages_price CHECK (total_price >= 0)
- [INDEX] INDEX idx_matter_packages_proposal_version (matter_id, proposal_version_no)

#### matter_package_services

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_package_id` BIGINT UNSIGNED NOT NULL
- `service_id` BIGINT UNSIGNED NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_matter_package_services (matter_package_id, service_id)
- [FK] CONSTRAINT fk_matter_package_services_package FOREIGN KEY (matter_package_id) REFERENCES matter_packages (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_package_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### matter_package_features

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_package_id` BIGINT UNSIGNED NOT NULL
- `feature_text` VARCHAR(255) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_matter_package_features_package (matter_package_id)
- [FK] CONSTRAINT fk_matter_package_features_package FOREIGN KEY (matter_package_id) REFERENCES matter_packages (id) ON UPDATE CASCADE ON DELETE CASCADE

### Documents

#### documents

Source status: active normalized schema  
Runtime references outside migrations: 54 (`backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domain/types.ts`, `backend/src/modules/notifications/repository.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `document_number` VARCHAR(50) NOT NULL
- `owner_client_account_id` BIGINT UNSIGNED NOT NULL
- `title` VARCHAR(255) NOT NULL
- `category_code` VARCHAR(32) NOT NULL
- `visibility_scope_code` VARCHAR(32) NOT NULL
- `current_version_no` INT UNSIGNED NOT NULL DEFAULT 0
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_documents_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_documents_number (document_number)
- [INDEX] INDEX idx_documents_owner (owner_client_account_id)
- [FK] CONSTRAINT fk_documents_owner_account FOREIGN KEY (owner_client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_documents_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### document_versions

Source status: active normalized schema  
Runtime references outside migrations: 7 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`, `admin_backend/src/modules/dashboard/service.ts`, `admin_backend/src/modules/documents/service.ts`, `admin_backend/src/modules/search/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `document_id` BIGINT UNSIGNED NOT NULL
- `version_no` INT UNSIGNED NOT NULL
- `storage_driver_code` VARCHAR(32) NOT NULL
- `storage_path` VARCHAR(500) NOT NULL
- `original_file_name` VARCHAR(255) NOT NULL
- `mime_type` VARCHAR(160) NOT NULL
- `file_extension` VARCHAR(20) NOT NULL
- `file_size_bytes` BIGINT UNSIGNED NOT NULL
- `checksum_sha256` CHAR(64) NOT NULL
- `virus_scan_status_code` VARCHAR(32) NOT NULL
- `uploaded_by_user_id` BIGINT UNSIGNED NOT NULL
- `uploaded_at` DATETIME(6) NOT NULL
- `is_current` TINYINT(1) NOT NULL DEFAULT 1
- `retention_hold_flag` TINYINT(1) NOT NULL DEFAULT 0

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_document_versions_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_document_versions_document_version (document_id, version_no)
- [INDEX] INDEX idx_document_versions_document (document_id)
- [FK] CONSTRAINT fk_document_versions_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_document_versions_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_document_versions_size CHECK (file_size_bytes >= 0)

#### request_documents

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `service_request_id` BIGINT UNSIGNED NOT NULL
- `document_id` BIGINT UNSIGNED NOT NULL
- `link_role_code` VARCHAR(32) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_request_documents (service_request_id, document_id)
- [FK] CONSTRAINT fk_request_documents_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_request_documents_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### matter_documents

Source status: active normalized schema  
Runtime references outside migrations: 7 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`, `admin_backend/src/modules/documents/service.ts`, `admin_backend/src/modules/notifications/service.ts`, `admin_backend/src/modules/search/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `matter_id` BIGINT UNSIGNED NOT NULL
- `document_id` BIGINT UNSIGNED NOT NULL
- `link_role_code` VARCHAR(32) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_matter_documents (matter_id, document_id)
- [FK] CONSTRAINT fk_matter_documents_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_matter_documents_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### document_download_logs

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `document_id` BIGINT UNSIGNED NOT NULL
- `document_version_id` BIGINT UNSIGNED NOT NULL
- `downloaded_by_user_id` BIGINT UNSIGNED NOT NULL
- `ip_address` VARCHAR(45) NULL
- `user_agent` TEXT NULL
- `downloaded_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_document_download_logs_document (document_id)
- [FK] CONSTRAINT fk_document_download_logs_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_document_download_logs_version FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_document_download_logs_user FOREIGN KEY (downloaded_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### document_upload_intents

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/storage/mysqlStoredUploadRepository.ts`, `backend/src/modules/storage/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `owner_user_id` BIGINT UNSIGNED NOT NULL
- `owner_client_account_id` BIGINT UNSIGNED NOT NULL
- `source_module` VARCHAR(64) NOT NULL
- `request_public_id` CHAR(26) NULL
- `matter_public_id` CHAR(26) NULL
- `invoice_public_id` CHAR(26) NULL
- `thread_public_id` CHAR(26) NULL
- `original_name` VARCHAR(255) NOT NULL
- `mime_type` VARCHAR(160) NOT NULL
- `size_bytes` BIGINT UNSIGNED NOT NULL
- `checksum_sha256` CHAR(64) NOT NULL
- `storage_driver_code` VARCHAR(32) NOT NULL
- `storage_key` VARCHAR(255) NOT NULL
- `status_code` VARCHAR(32) NOT NULL
- `document_id` BIGINT UNSIGNED NULL
- `document_version_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `expires_at` DATETIME(6) NOT NULL
- `stored_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_document_upload_intents_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_document_upload_intents_storage_key (storage_key)
- [FK] CONSTRAINT fk_document_upload_intents_owner_user FOREIGN KEY (owner_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_document_upload_intents_owner_account FOREIGN KEY (owner_client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_document_upload_intents_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_document_upload_intents_document_version FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_document_upload_intents_size CHECK (size_bytes > 0)

#### invoice_documents

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/domain/repository.ts`, `backend/src/modules/storage/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `invoice_id` BIGINT UNSIGNED NOT NULL
- `document_id` BIGINT UNSIGNED NOT NULL
- `link_role_code` VARCHAR(32) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_invoice_documents (invoice_id, document_id)
- [FK] CONSTRAINT fk_invoice_documents_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_invoice_documents_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE RESTRICT

### Events & Messaging

#### events

Source status: active normalized schema  
Runtime references outside migrations: 43 (`backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domainEvents/service.ts`, `backend/src/modules/notifications/repository.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `matter_id` BIGINT UNSIGNED NULL
- `title` VARCHAR(255) NOT NULL
- `event_type_code` VARCHAR(32) NOT NULL
- `status_code` VARCHAR(32) NOT NULL
- `scheduled_start_at` DATETIME(6) NOT NULL
- `scheduled_end_at` DATETIME(6) NOT NULL
- `timezone_name` VARCHAR(64) NOT NULL DEFAULT 'UTC'
- `mode_code` VARCHAR(32) NOT NULL
- `location_text` VARCHAR(255) NULL
- `meeting_provider_code` VARCHAR(32) NOT NULL
- `external_meeting_id` VARCHAR(255) NULL
- `join_url` VARCHAR(500) NULL
- `host_url` VARCHAR(500) NULL
- `client_visible_flag` TINYINT(1) NOT NULL DEFAULT 1
- `notes` TEXT NULL
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `cancelled_by_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `cancelled_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_events_public_id (public_id)
- [INDEX] INDEX idx_events_client (client_account_id)
- [INDEX] INDEX idx_events_matter (matter_id)
- [FK] CONSTRAINT fk_events_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_events_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_events_status FOREIGN KEY (status_code) REFERENCES event_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_events_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_events_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_events_time CHECK (scheduled_end_at > scheduled_start_at)

#### event_participants

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/domain/repository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `event_id` BIGINT UNSIGNED NOT NULL
- `participant_role_code` VARCHAR(32) NOT NULL
- `internal_user_id` BIGINT UNSIGNED NULL
- `client_contact_user_id` BIGINT UNSIGNED NULL
- `counsel_partner_id` BIGINT UNSIGNED NULL
- `rsvp_status_code` VARCHAR(32) NOT NULL
- `attendance_status_code` VARCHAR(32) NOT NULL
- `joined_at` DATETIME(6) NULL
- `left_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [FK] CONSTRAINT fk_event_participants_event FOREIGN KEY (event_id) REFERENCES events (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_event_participants_internal_user FOREIGN KEY (internal_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_event_participants_client_user FOREIGN KEY (client_contact_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_event_participants_counsel FOREIGN KEY (counsel_partner_id) REFERENCES counsel_partners (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### event_reminders

Source status: active normalized schema  
Runtime references outside migrations: 0

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `event_id` BIGINT UNSIGNED NOT NULL
- `recipient_user_id` BIGINT UNSIGNED NOT NULL
- `channel_code` VARCHAR(32) NOT NULL
- `scheduled_at` DATETIME(6) NOT NULL
- `sent_at` DATETIME(6) NULL
- `delivery_status_code` VARCHAR(32) NOT NULL
- `failure_reason` VARCHAR(255) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_event_reminders_event (event_id)
- [FK] CONSTRAINT fk_event_reminders_event FOREIGN KEY (event_id) REFERENCES events (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_event_reminders_recipient FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### conversation_threads

Source status: active normalized schema  
Runtime references outside migrations: 10 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domainEvents/service.ts`, `backend/src/modules/notifications/repository.ts`, `admin_backend/src/modules/audit/service.ts`, `admin_backend/src/modules/dashboard/service.ts`, `admin_backend/src/modules/messages/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `thread_number` VARCHAR(50) NOT NULL
- `thread_type_code` VARCHAR(32) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `matter_id` BIGINT UNSIGNED NULL
- `subject` VARCHAR(255) NULL
- `status_code` VARCHAR(32) NOT NULL
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `assigned_owner_user_id` BIGINT UNSIGNED NULL
- `last_message_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `closed_at` DATETIME(6) NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_conversation_threads_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_conversation_threads_number (thread_number)
- [INDEX] INDEX idx_conversation_threads_client (client_account_id)
- [INDEX] INDEX idx_conversation_threads_matter (matter_id)
- [FK] CONSTRAINT fk_conversation_threads_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_conversation_threads_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_conversation_threads_status FOREIGN KEY (status_code) REFERENCES thread_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_conversation_threads_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_conversation_threads_assigned_owner FOREIGN KEY (assigned_owner_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### messages

Source status: active normalized schema  
Runtime references outside migrations: 33 (`backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/notifications/repository.ts`, `backend/src/modules/notifications/types.ts`, `backend/src/modules/platform/referenceData.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `thread_id` BIGINT UNSIGNED NOT NULL
- `sender_user_id` BIGINT UNSIGNED NULL
- `sender_counsel_partner_id` BIGINT UNSIGNED NULL
- `sender_system_code` VARCHAR(32) NULL
- `message_type_code` VARCHAR(32) NOT NULL
- `body_text` TEXT NOT NULL
- `visible_to_client` TINYINT(1) NOT NULL DEFAULT 1
- `reply_to_message_id` BIGINT UNSIGNED NULL
- `sent_at` DATETIME(6) NOT NULL
- `edited_at` DATETIME(6) NULL
- `deleted_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_messages_public_id (public_id)
- [INDEX] INDEX idx_messages_thread (thread_id)
- [FK] CONSTRAINT fk_messages_thread FOREIGN KEY (thread_id) REFERENCES conversation_threads (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_messages_sender_user FOREIGN KEY (sender_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_messages_sender_counsel FOREIGN KEY (sender_counsel_partner_id) REFERENCES counsel_partners (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_messages_reply_to FOREIGN KEY (reply_to_message_id) REFERENCES messages (id) ON UPDATE CASCADE ON DELETE SET NULL

#### thread_participants

Source status: active normalized schema  
Runtime references outside migrations: 2 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domainEvents/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `thread_id` BIGINT UNSIGNED NOT NULL
- `participant_role_code` VARCHAR(32) NOT NULL
- `internal_user_id` BIGINT UNSIGNED NULL
- `client_contact_user_id` BIGINT UNSIGNED NULL
- `counsel_partner_id` BIGINT UNSIGNED NULL
- `is_active` TINYINT(1) NOT NULL DEFAULT 1
- `joined_at` DATETIME(6) NOT NULL
- `left_at` DATETIME(6) NULL
- `last_read_message_id` BIGINT UNSIGNED NULL
- `last_read_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_thread_participants_thread (thread_id)
- [FK] CONSTRAINT fk_thread_participants_thread FOREIGN KEY (thread_id) REFERENCES conversation_threads (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_thread_participants_internal_user FOREIGN KEY (internal_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_thread_participants_client_user FOREIGN KEY (client_contact_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_thread_participants_counsel FOREIGN KEY (counsel_partner_id) REFERENCES counsel_partners (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_thread_participants_last_read_message FOREIGN KEY (last_read_message_id) REFERENCES messages (id) ON UPDATE CASCADE ON DELETE SET NULL

#### message_document_versions

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `message_id` BIGINT UNSIGNED NOT NULL
- `document_version_id` BIGINT UNSIGNED NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_message_document_versions (message_id, document_version_id)
- [FK] CONSTRAINT fk_message_document_versions_message FOREIGN KEY (message_id) REFERENCES messages (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_message_document_versions_version FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### message_reads

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/dashboard/normalizedRepository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `message_id` BIGINT UNSIGNED NOT NULL
- `user_id` BIGINT UNSIGNED NOT NULL
- `read_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_message_reads (message_id, user_id)
- [FK] CONSTRAINT fk_message_reads_message FOREIGN KEY (message_id) REFERENCES messages (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_message_reads_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

### Billing

#### payment_methods

Source status: active normalized schema  
Runtime references outside migrations: 1 (`admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `added_by_user_id` BIGINT UNSIGNED NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `method_type_code` VARCHAR(32) NOT NULL
- `provider_customer_ref` VARCHAR(255) NULL
- `provider_method_ref` VARCHAR(255) NULL
- `display_label` VARCHAR(120) NOT NULL
- `brand_last4` VARCHAR(16) NULL
- `expiry_month` TINYINT UNSIGNED NULL
- `expiry_year` SMALLINT UNSIGNED NULL
- `upi_id` VARCHAR(100) NULL
- `is_default` TINYINT(1) NOT NULL DEFAULT 0
- `method_status_code` VARCHAR(32) NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_payment_methods_public_id (public_id)
- [FK] CONSTRAINT fk_payment_methods_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_methods_added_by FOREIGN KEY (added_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### subscriptions

Source status: active normalized schema  
Runtime references outside migrations: 0

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `subscription_number` VARCHAR(50) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `subscription_plan_id` BIGINT UNSIGNED NOT NULL
- `payment_method_id` BIGINT UNSIGNED NULL
- `subscription_status_code` VARCHAR(32) NOT NULL
- `start_date` DATE NOT NULL
- `current_period_start` DATE NOT NULL
- `current_period_end` DATE NOT NULL
- `next_billing_at` DATETIME(6) NULL
- `cancel_at_period_end` TINYINT(1) NOT NULL DEFAULT 0
- `cancelled_at` DATETIME(6) NULL
- `ended_at` DATETIME(6) NULL
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_subscriptions_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_subscriptions_number (subscription_number)
- [FK] CONSTRAINT fk_subscriptions_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_subscriptions_plan FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_subscriptions_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_subscriptions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT

#### invoice_settings

Source status: active normalized schema
Runtime references outside migrations: 3 (`admin_backend/src/modules/settings/invoiceSettings.ts`, `backend/src/modules/domain/invoiceTemplateRendering.ts`, `admin_backend/src/modules/billing/invoiceTemplateRendering.ts`)

**Columns**

- `id` TINYINT UNSIGNED NOT NULL
- `business_legal_name` VARCHAR(200) NOT NULL
- `billing_display_name` VARCHAR(200) NOT NULL
- `gstin` CHAR(15) NULL
- `business_state` VARCHAR(100) NOT NULL
- `business_address` TEXT NULL
- `business_phone` VARCHAR(40) NULL
- `business_email` VARCHAR(255) NULL
- `business_website` VARCHAR(255) NULL
- `invoice_prefix` VARCHAR(24) NOT NULL
- `default_sac_code` VARCHAR(32) NULL
- `gst_enabled` TINYINT(1) NOT NULL DEFAULT 1
- `default_gst_rate_bps` INT UNSIGNED NOT NULL DEFAULT 1800
- `tax_mode_code` VARCHAR(32) NOT NULL DEFAULT 'forward_charge'
- `prices_include_tax` TINYINT(1) NOT NULL DEFAULT 0
- `fallback_tax_type_code` VARCHAR(32) NOT NULL DEFAULT 'igst'
- `payment_terms_days` INT UNSIGNED NOT NULL DEFAULT 7
- `payment_instructions` TEXT NULL
- `invoice_terms` TEXT NULL
- `invoice_footer` TEXT NULL
- `reverse_charge_note` TEXT NULL
- `default_invoice_template_public_id` CHAR(26) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)

#### invoice_pdf_templates

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/lib/invoicePdf.ts`, `admin_backend/src/modules/billing/invoicePdf.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `name` VARCHAR(180) NOT NULL
- `original_file_name` VARCHAR(255) NOT NULL
- `content_type` VARCHAR(80) NOT NULL DEFAULT 'application/pdf'
- `file_size_bytes` BIGINT UNSIGNED NOT NULL
- `pdf_content` LONGBLOB NOT NULL
- `content_top_margin` DECIMAL(10,2) NOT NULL DEFAULT 120.00
- `content_left_margin` DECIMAL(10,2) NOT NULL DEFAULT 54.00
- `content_right_margin` DECIMAL(10,2) NOT NULL DEFAULT 54.00
- `content_bottom_margin` DECIMAL(10,2) NOT NULL DEFAULT 72.00
- `is_active` TINYINT(1) NOT NULL DEFAULT 0
- `created_by_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_invoice_pdf_templates_public_id (public_id)
- [INDEX] INDEX idx_invoice_pdf_templates_active (is_active, archived_at)
- [FK] CONSTRAINT fk_invoice_pdf_templates_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### invoices

Source status: active normalized schema  
Runtime references outside migrations: 37 (`backend/src/modules/dashboard/helpers.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/dashboard/types.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/notifications/repository.ts`, `backend/src/modules/platform/referenceData.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `invoice_number` VARCHAR(50) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `matter_id` BIGINT UNSIGNED NULL
- `matter_package_id` BIGINT UNSIGNED NULL
- `subscription_id` BIGINT UNSIGNED NULL
- `invoice_type_code` VARCHAR(32) NOT NULL
- `status_code` VARCHAR(32) NOT NULL
- `currency_code` CHAR(3) NOT NULL DEFAULT 'USD'
- `original_currency_code` CHAR(3) NULL
- `original_subtotal_amount` DECIMAL(14,2) NULL
- `original_tax_amount` DECIMAL(14,2) NULL
- `original_total_amount` DECIMAL(14,2) NULL
- `exchange_rate` DECIMAL(20,8) NULL
- `exchange_rate_date` DATE NULL
- `exchange_rate_provider` VARCHAR(64) NULL
- `fx_snapshot_json` JSON NULL
- `issue_date` DATE NOT NULL
- `due_date` DATE NOT NULL
- `subtotal_amount` DECIMAL(14,2) NOT NULL
- `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `tax_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `total_amount` DECIMAL(14,2) NOT NULL
- `amount_paid` DECIMAL(14,2) NOT NULL DEFAULT 0
- `amount_refunded` DECIMAL(14,2) NOT NULL DEFAULT 0
- `amount_due` DECIMAL(14,2) NOT NULL DEFAULT 0
- `created_by_user_id` BIGINT UNSIGNED NOT NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `archived_at` DATETIME(6) NULL
- `template_public_id_snapshot` CHAR(26) NULL
- `template_version_snapshot` INT UNSIGNED NULL
- `pdf_template_public_id_snapshot` CHAR(26) NULL
- `pdf_template_name_snapshot` VARCHAR(180) NULL
- `pdf_content_top_margin_snapshot` DECIMAL(10,2) NULL
- `pdf_content_left_margin_snapshot` DECIMAL(10,2) NULL
- `pdf_content_right_margin_snapshot` DECIMAL(10,2) NULL
- `pdf_content_bottom_margin_snapshot` DECIMAL(10,2) NULL
- `rendered_subject_snapshot` VARCHAR(255) NULL
- `rendered_body_snapshot` TEXT NULL
- `rendered_terms_snapshot` TEXT NULL
- `rendered_footer_snapshot` TEXT NULL
- `business_name_snapshot` VARCHAR(255) NULL
- `business_address_snapshot` TEXT NULL
- `business_phone_snapshot` VARCHAR(40) NULL
- `business_email_snapshot` VARCHAR(255) NULL
- `business_website_snapshot` VARCHAR(255) NULL
- `business_gstin_snapshot` CHAR(15) NULL
- `business_state_snapshot` VARCHAR(96) NULL
- `payment_instructions_snapshot` TEXT NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_invoices_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_invoices_number (invoice_number)
- [INDEX] INDEX idx_invoices_client (client_account_id)
- [INDEX] INDEX idx_invoices_matter (matter_id)
- [FK] CONSTRAINT fk_invoices_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_invoices_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_invoices_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_invoices_status FOREIGN KEY (status_code) REFERENCES invoice_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [CHECK] CONSTRAINT chk_invoices_amounts CHECK ( subtotal_amount >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND amount_paid >= 0 AND amount_refunded >= 0 AND amount_due >= 0 )
- [INDEX] INDEX idx_invoices_matter_package (matter_package_id)
- [FK] CONSTRAINT fk_invoices_matter_package FOREIGN KEY (matter_package_id) REFERENCES matter_packages (id) ON UPDATE CASCADE ON DELETE SET NULL

#### invoice_billing_snapshots

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `invoice_id` BIGINT UNSIGNED NOT NULL
- `billing_name` VARCHAR(200) NOT NULL
- `billing_email` VARCHAR(255) NOT NULL
- `billing_phone` VARCHAR(40) NOT NULL
- `address_line1` VARCHAR(255) NOT NULL
- `address_line2` VARCHAR(255) NULL
- `city` VARCHAR(100) NOT NULL
- `state` VARCHAR(100) NOT NULL
- `postal_code` VARCHAR(20) NOT NULL
- `country_code` VARCHAR(16) NOT NULL
- `gstin` CHAR(15) NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (invoice_id)
- [FK] CONSTRAINT fk_invoice_billing_snapshots_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE CASCADE

#### invoice_lines

Source status: active normalized schema  
Runtime references outside migrations: 4 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/packages/service.ts`, `admin_backend/src/modules/shared.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `invoice_id` BIGINT UNSIGNED NOT NULL
- `line_type_code` VARCHAR(32) NOT NULL
- `service_id` BIGINT UNSIGNED NULL
- `subscription_plan_id` BIGINT UNSIGNED NULL
- `description` VARCHAR(255) NOT NULL
- `quantity` DECIMAL(12,2) NOT NULL DEFAULT 1.00
- `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0
- `line_subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0
- `discount_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `taxable_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `line_total` DECIMAL(14,2) NOT NULL DEFAULT 0
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_invoice_lines_invoice (invoice_id)
- [FK] CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_invoice_lines_service FOREIGN KEY (service_id) REFERENCES services (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_invoice_lines_subscription_plan FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_invoice_lines_amounts CHECK ( quantity > 0 AND unit_price >= 0 AND line_subtotal >= 0 AND discount_amount >= 0 AND taxable_amount >= 0 AND line_total >= 0 )

#### invoice_line_taxes

Source status: active normalized schema  
Runtime references outside migrations: 1 (`backend/src/modules/domain/repository.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `invoice_line_id` BIGINT UNSIGNED NOT NULL
- `tax_rate_id` BIGINT UNSIGNED NULL
- `tax_code_snapshot` VARCHAR(32) NOT NULL
- `tax_name_snapshot` VARCHAR(120) NOT NULL
- `tax_percent_snapshot` DECIMAL(5,2) NOT NULL
- `taxable_amount` DECIMAL(14,2) NOT NULL
- `tax_amount` DECIMAL(14,2) NOT NULL
- `sort_order` INT NOT NULL DEFAULT 0
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_invoice_line_taxes_line (invoice_line_id)
- [FK] CONSTRAINT fk_invoice_line_taxes_line FOREIGN KEY (invoice_line_id) REFERENCES invoice_lines (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_invoice_line_taxes_tax_rate FOREIGN KEY (tax_rate_id) REFERENCES tax_rates (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_invoice_line_taxes_amounts CHECK ( tax_percent_snapshot >= 0 AND tax_percent_snapshot <= 100 AND taxable_amount >= 0 AND tax_amount >= 0 )

#### invoice_installments

Source status: active normalized schema  
Runtime references outside migrations: 3 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/packages/service.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `invoice_id` BIGINT UNSIGNED NOT NULL
- `installment_no` INT UNSIGNED NOT NULL
- `due_date` DATE NOT NULL
- `amount_due` DECIMAL(14,2) NOT NULL
- `amount_paid` DECIMAL(14,2) NOT NULL DEFAULT 0
- `amount_remaining` DECIMAL(14,2) NOT NULL DEFAULT 0
- `status_code` VARCHAR(32) NOT NULL
- `paid_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_invoice_installments_no (invoice_id, installment_no)
- [INDEX] INDEX idx_invoice_installments_invoice (invoice_id)
- [FK] CONSTRAINT fk_invoice_installments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE CASCADE
- [CHECK] CONSTRAINT chk_invoice_installments_amounts CHECK ( installment_no > 0 AND amount_due >= 0 AND amount_paid >= 0 AND amount_remaining >= 0 )

#### payment_transactions

Source status: active normalized schema  
Runtime references outside migrations: 9 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `backend/src/modules/domainEvents/service.ts`, `admin_backend/src/modules/audit/service.ts`, `admin_backend/src/modules/billing/service.ts`, `admin_backend/src/modules/dashboard/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `payment_method_id` BIGINT UNSIGNED NULL
- `gateway_provider_code` VARCHAR(32) NOT NULL
- `gateway_order_ref` VARCHAR(255) NULL
- `gateway_payment_ref` VARCHAR(255) NULL
- `status_code` VARCHAR(32) NOT NULL
- `currency_code` CHAR(3) NOT NULL DEFAULT 'USD'
- `gross_amount` DECIMAL(14,2) NOT NULL
- `gateway_fee_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `net_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
- `failure_reason` VARCHAR(255) NULL
- `initiated_at` DATETIME(6) NOT NULL
- `authorized_at` DATETIME(6) NULL
- `captured_at` DATETIME(6) NULL
- `failed_at` DATETIME(6) NULL
- `created_by_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL
- `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_payment_transactions_public_id (public_id)
- [INDEX] INDEX idx_payment_transactions_client (client_account_id)
- [FK] CONSTRAINT fk_payment_transactions_client_account FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_transactions_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_payment_transactions_status FOREIGN KEY (status_code) REFERENCES payment_statuses (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_transactions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_payment_transactions_amounts CHECK ( gross_amount >= 0 AND gateway_fee_amount >= 0 AND net_amount >= 0 )

#### payment_gateway_orders

Source status: active normalized schema
Runtime references outside migrations: 1 (`backend/src/modules/payments/razorpayService.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `provider_order_id` VARCHAR(120) NOT NULL
- `invoice_id` BIGINT UNSIGNED NULL
- `service_request_id` BIGINT UNSIGNED NULL
- `client_account_id` BIGINT UNSIGNED NOT NULL
- `amount` DECIMAL(14,2) NOT NULL
- `amount_minor` BIGINT UNSIGNED NOT NULL
- `currency_code` CHAR(3) NOT NULL DEFAULT 'USD'
- `status_code` VARCHAR(32) NOT NULL
- `receipt` VARCHAR(40) NOT NULL
- `idempotency_key_hash` CHAR(64) NULL
- `provider_payload_json` JSON NULL
- `created_by_user_id` BIGINT UNSIGNED NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_payment_gateway_orders_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_payment_gateway_orders_provider_order (provider_code, provider_order_id)
- [INDEX] INDEX idx_payment_gateway_orders_invoice (invoice_id)
- [INDEX] INDEX idx_payment_gateway_orders_service_request (service_request_id)
- [INDEX] INDEX idx_payment_gateway_orders_client (client_account_id)
- [FK] CONSTRAINT fk_payment_gateway_orders_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_payment_gateway_orders_service_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_payment_gateway_orders_client FOREIGN KEY (client_account_id) REFERENCES client_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_gateway_orders_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### payment_gateway_events

Source status: active normalized schema
Runtime references outside migrations: 2 (`backend/src/routes/webhooks.ts`, `backend/src/modules/payments/razorpayService.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `event_type` VARCHAR(120) NOT NULL
- `provider_event_id` VARCHAR(160) NOT NULL
- `signature_valid` TINYINT(1) NOT NULL DEFAULT 0
- `provider_order_id` VARCHAR(120) NULL
- `provider_payment_id` VARCHAR(120) NULL
- `payload_json` JSON NOT NULL
- `received_at` DATETIME(6) NOT NULL
- `processed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_payment_gateway_events_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_payment_gateway_events_provider_event (provider_code, provider_event_id)
- [INDEX] INDEX idx_payment_gateway_events_order (provider_order_id)
- [INDEX] INDEX idx_payment_gateway_events_payment (provider_payment_id)
- [INDEX] INDEX idx_payment_gateway_events_received (received_at)

#### payment_allocations

Source status: active normalized schema  
Runtime references outside migrations: 6 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domain/repository.ts`, `admin_backend/src/modules/billing/service.ts`, `admin_backend/src/modules/packages/service.ts`, `admin_backend/src/modules/shared.ts`, `admin_backend/src/modules/writeSupport.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `payment_transaction_id` BIGINT UNSIGNED NOT NULL
- `invoice_id` BIGINT UNSIGNED NOT NULL
- `invoice_installment_id` BIGINT UNSIGNED NULL
- `amount_applied` DECIMAL(14,2) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_payment_allocations_payment (payment_transaction_id)
- [INDEX] INDEX idx_payment_allocations_invoice (invoice_id)
- [FK] CONSTRAINT fk_payment_allocations_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_allocations_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_payment_allocations_installment FOREIGN KEY (invoice_installment_id) REFERENCES invoice_installments (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_payment_allocations_amount CHECK (amount_applied > 0)

#### refunds

Source status: active normalized schema  
Runtime references outside migrations: 13 (`backend/src/modules/domain/repository.ts`, `backend/src/modules/domainEvents/service.ts`, `backend/src/modules/platform/referenceData.ts`, `backend/src/routes/admin.ts`, `backend/src/routes/me.ts`, `admin_backend/src/modules/audit/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `payment_transaction_id` BIGINT UNSIGNED NOT NULL
- `invoice_id` BIGINT UNSIGNED NULL
- `amount` DECIMAL(14,2) NOT NULL
- `refund_status_code` VARCHAR(32) NOT NULL
- `reason_text` TEXT NOT NULL
- `gateway_refund_ref` VARCHAR(255) NULL
- `requested_by_user_id` BIGINT UNSIGNED NOT NULL
- `approved_by_user_id` BIGINT UNSIGNED NULL
- `requested_at` DATETIME(6) NOT NULL
- `completed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `updated_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_refunds_public_id (public_id)
- [INDEX] INDEX idx_refunds_payment (payment_transaction_id)
- [FK] CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_refunds_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_refunds_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_refunds_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
- [CHECK] CONSTRAINT chk_refunds_amount CHECK (amount > 0)

### Notifications & Audit

#### email_events

Source status: active normalized schema
Runtime references outside migrations: 1 (`admin_backend/src/modules/webhooks/providerWebhooks.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `provider_event_id` VARCHAR(160) NULL
- `provider_message_id` VARCHAR(160) NULL
- `event_type_code` VARCHAR(80) NOT NULL
- `delivery_status_code` VARCHAR(40) NOT NULL
- `recipient_email` VARCHAR(255) NULL
- `payload_json` JSON NULL
- `received_at` DATETIME(6) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_email_events_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_email_events_provider_event (provider_code, provider_event_id)
- [INDEX] INDEX idx_email_events_provider_message (provider_code, provider_message_id)
- [INDEX] INDEX idx_email_events_received_at (received_at)

#### sms_events

Source status: active normalized schema
Runtime references outside migrations: 1 (`admin_backend/src/modules/webhooks/providerWebhooks.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `provider_code` VARCHAR(32) NOT NULL
- `provider_message_id` VARCHAR(160) NULL
- `event_type_code` VARCHAR(80) NOT NULL
- `delivery_status_code` VARCHAR(40) NOT NULL
- `to_phone` VARCHAR(64) NULL
- `from_phone` VARCHAR(64) NULL
- `error_code` VARCHAR(64) NULL
- `error_message` VARCHAR(255) NULL
- `payload_json` JSON NULL
- `received_at` DATETIME(6) NOT NULL
- `created_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_sms_events_public_id (public_id)
- [UNIQUE] UNIQUE KEY uq_sms_events_provider_message_type (provider_code, provider_message_id, event_type_code)
- [INDEX] INDEX idx_sms_events_received_at (received_at)

#### notifications

Source status: active normalized schema  
Runtime references outside migrations: 26 (`backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domainEvents/service.ts`, `backend/src/modules/notifications/repository.ts`, `backend/src/routes/index.ts`, `backend/src/routes/notifications.ts`, `admin_backend/src/modules/dashboard/service.ts`, ...)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `recipient_user_id` BIGINT UNSIGNED NOT NULL
- `notification_type_code` VARCHAR(64) NOT NULL
- `title` VARCHAR(255) NOT NULL
- `body_text` TEXT NOT NULL
- `priority_code` VARCHAR(16) NOT NULL
- `matter_id` BIGINT UNSIGNED NULL
- `invoice_id` BIGINT UNSIGNED NULL
- `thread_id` BIGINT UNSIGNED NULL
- `event_id` BIGINT UNSIGNED NULL
- `document_id` BIGINT UNSIGNED NULL
- `is_read` TINYINT(1) NOT NULL DEFAULT 0
- `read_at` DATETIME(6) NULL
- `dismissed_at` DATETIME(6) NULL
- `created_at` DATETIME(6) NOT NULL
- `expires_at` DATETIME(6) NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_notifications_public_id (public_id)
- [INDEX] INDEX idx_notifications_recipient (recipient_user_id)
- [FK] CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
- [FK] CONSTRAINT fk_notifications_type FOREIGN KEY (notification_type_code) REFERENCES notification_types (code) ON UPDATE CASCADE ON DELETE RESTRICT
- [FK] CONSTRAINT fk_notifications_matter FOREIGN KEY (matter_id) REFERENCES matters (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_notifications_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_notifications_thread FOREIGN KEY (thread_id) REFERENCES conversation_threads (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_notifications_event FOREIGN KEY (event_id) REFERENCES events (id) ON UPDATE CASCADE ON DELETE SET NULL
- [FK] CONSTRAINT fk_notifications_document FOREIGN KEY (document_id) REFERENCES documents (id) ON UPDATE CASCADE ON DELETE SET NULL

#### audit_events

Source status: active normalized schema  
Runtime references outside migrations: 6 (`backend/src/modules/clientAccounts/repository.ts`, `backend/src/modules/dashboard/normalizedRepository.ts`, `backend/src/modules/domainEvents/service.ts`, `admin_backend/src/modules/audit/service.ts`, `admin_backend/src/modules/shared.ts`, `admin_backend/src/modules/writeSupport.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `public_id` CHAR(26) NOT NULL
- `actor_user_id` BIGINT UNSIGNED NULL
- `actor_role_code_snapshot` VARCHAR(64) NOT NULL
- `entity_table_name` VARCHAR(64) NOT NULL
- `entity_pk` BIGINT UNSIGNED NULL
- `action_code` VARCHAR(64) NOT NULL
- `action_label` VARCHAR(255) NOT NULL
- `source_module` VARCHAR(64) NOT NULL
- `request_correlation_id` VARCHAR(128) NULL
- `ip_address` VARCHAR(45) NULL
- `user_agent` TEXT NULL
- `summary_old_value` TEXT NULL
- `summary_new_value` TEXT NULL
- `occurred_at` DATETIME(6) NOT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [UNIQUE] UNIQUE KEY uq_audit_events_public_id (public_id)
- [INDEX] INDEX idx_audit_events_actor (actor_user_id)
- [INDEX] INDEX idx_audit_events_entity (entity_table_name, entity_pk)
- [FK] CONSTRAINT fk_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL

#### audit_event_changes

Source status: active normalized schema  
Runtime references outside migrations: 1 (`admin_backend/src/modules/writeSupport.ts`)

**Columns**

- `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
- `audit_event_id` BIGINT UNSIGNED NOT NULL
- `field_name` VARCHAR(128) NOT NULL
- `old_value_text` TEXT NULL
- `new_value_text` TEXT NULL

**Keys / Constraints**

- [PK] PRIMARY KEY (id)
- [INDEX] INDEX idx_audit_event_changes_event (audit_event_id)
- [FK] CONSTRAINT fk_audit_event_changes_event FOREIGN KEY (audit_event_id) REFERENCES audit_events (id) ON UPDATE CASCADE ON DELETE CASCADE

### Historical Migration-Only Tables

The early `dashboard_*`, `auth_accounts`, legacy `auth_sessions`,
`auth_flows_legacy_pre_009`, and `stored_uploads` tables are not part of the
active schema. They remain visible only in historical migration source so old
environments can be upgraded safely, and were dropped by cleanup migrations
`051-drop-dead-legacy-tables` and `052-drop-stored-uploads-if-unused`.

## Foreign-Key Relationship Map

- `audit_event_changes.audit_event_id -> audit_events.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `audit_events.actor_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `admin_mfa_secrets.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `auth_flows.email_token_id -> email_verification_tokens.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `auth_flows.password_reset_token_id -> password_reset_tokens.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `auth_flows.phone_token_id -> phone_verification_tokens.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `auth_flows.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `client_account_contacts.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `client_account_contacts.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `client_accounts.owner_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `client_addresses.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `conversation_threads.assigned_owner_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `conversation_threads.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `conversation_threads.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `conversation_threads.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `conversation_threads.status_code -> thread_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `counsel_partners.invited_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `document_download_logs.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `document_download_logs.document_version_id -> document_versions.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `document_download_logs.downloaded_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `document_upload_intents.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `document_upload_intents.document_version_id -> document_versions.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `document_upload_intents.owner_client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `document_upload_intents.owner_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `document_versions.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `document_versions.uploaded_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `documents.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `documents.owner_client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `email_verification_tokens.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `event_participants.client_contact_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `event_participants.counsel_partner_id -> counsel_partners.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `event_participants.event_id -> events.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `event_participants.internal_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `event_reminders.event_id -> events.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `event_reminders.recipient_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `events.cancelled_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `events.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `events.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `events.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `events.status_code -> event_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoice_billing_snapshots.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `invoice_documents.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoice_documents.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `idempotency_keys.actor_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoice_installments.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `invoice_pdf_templates.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoice_line_taxes.invoice_line_id -> invoice_lines.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `invoice_line_taxes.tax_rate_id -> tax_rates.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoice_lines.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `invoice_lines.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoice_lines.subscription_plan_id -> subscription_plans.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoices.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoices.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoices.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoices.matter_package_id -> matter_packages.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `invoices.status_code -> invoice_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `invoices.subscription_id -> subscriptions.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `matter_assignments.assigned_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_assignments.counsel_partner_id -> counsel_partners.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_assignments.internal_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_assignments.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_documents.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_documents.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_package_features.matter_package_id -> matter_packages.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_package_services.matter_package_id -> matter_packages.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_package_services.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_packages.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_packages.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_services.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_services.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_stage_history.changed_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `matter_stage_history.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matter_stage_history.stage_code -> matter_stages.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matter_updates.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `matter_updates.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `matters.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.consultation_mode_code -> consultation_modes.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.current_stage_code -> matter_stages.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.legal_domain_id -> legal_domains.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.opened_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.operational_status_code -> matter_operational_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `matters.selected_matter_package_id -> matter_packages.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `matters.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `matters.urgency_rule_id -> pricing_urgency_rules.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `message_document_versions.document_version_id -> document_versions.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `message_document_versions.message_id -> messages.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `message_reads.message_id -> messages.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `message_reads.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `messages.reply_to_message_id -> messages.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `messages.sender_counsel_partner_id -> counsel_partners.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `messages.sender_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `messages.thread_id -> conversation_threads.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `notifications.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `notifications.event_id -> events.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `notifications.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `notifications.matter_id -> matters.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `notifications.notification_type_code -> notification_types.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `notifications.recipient_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `notifications.thread_id -> conversation_threads.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `password_reset_tokens.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `payment_allocations.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_allocations.invoice_installment_id -> invoice_installments.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_allocations.payment_transaction_id -> payment_transactions.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_methods.added_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_methods.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_gateway_orders.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_gateway_orders.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_gateway_orders.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_gateway_orders.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_transactions.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `payment_transactions.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_transactions.payment_method_id -> payment_methods.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `payment_transactions.status_code -> payment_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `phone_verification_tokens.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `pricing_consultation_mode_rules.consultation_mode_code -> consultation_modes.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `pricing_quote_lines.pricing_quote_id -> pricing_quotes.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `pricing_quote_lines.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `pricing_quotes.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `pricing_quotes.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `refunds.approved_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `refunds.invoice_id -> invoices.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `refunds.payment_transaction_id -> payment_transactions.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `refunds.requested_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `request_documents.document_id -> documents.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `request_documents.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `request_services.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `request_services.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `request_status_history.changed_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `request_status_history.from_status_code -> request_statuses.code` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `request_status_history.service_request_id -> service_requests.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `request_status_history.to_status_code -> request_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `role_permissions.permission_code -> permissions.code` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `role_permissions.role_code -> roles.code` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `security_events.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `service_requests.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `service_requests.consultation_mode_code -> consultation_modes.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `service_requests.legal_domain_id -> legal_domains.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `service_requests.requested_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `service_requests.status_code -> request_statuses.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `service_requests.urgency_rule_id -> pricing_urgency_rules.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `services.legal_domain_id -> legal_domains.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `staff_profiles.manager_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `staff_profiles.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `subscription_plan_services.service_id -> services.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `subscription_plan_services.subscription_plan_id -> subscription_plans.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `subscription_plans.tax_rate_id -> tax_rates.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `subscriptions.client_account_id -> client_accounts.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `subscriptions.created_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `subscriptions.payment_method_id -> payment_methods.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `subscriptions.subscription_plan_id -> subscription_plans.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `thread_participants.client_contact_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `thread_participants.counsel_partner_id -> counsel_partners.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `thread_participants.internal_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `thread_participants.last_read_message_id -> messages.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `thread_participants.thread_id -> conversation_threads.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `user_credentials.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `user_legal_acceptances.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `user_notification_preferences.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `user_oauth_accounts.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `user_roles.granted_by_user_id -> users.id` (ON UPDATE CASCADE, ON DELETE SET NULL)
- `user_roles.role_code -> roles.code` (ON UPDATE CASCADE, ON DELETE RESTRICT)
- `user_roles.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)
- `user_sessions.user_id -> users.id` (ON UPDATE CASCADE, ON DELETE CASCADE)

## Draw.io Suggested Starting Layout

Use these hubs first, then expand outward:

- `users` as the IAM / actor hub.
- `client_accounts` as the client hub.
- `service_requests` -> `matters` as the intake-to-case spine.
- `matter_packages`, `invoices`, `payment_transactions`, and `refunds` as the billing spine.
- `documents` / `document_versions` as the document spine.
- `conversation_threads` / `messages` as the communications spine.
- Keep lookup tables (`*_statuses`, `consultation_modes`, `notification_types`, `tax_rates`) on the outer edge.
- Keep the Legacy section in a separate draw.io page so it does not clutter the active ERD.
