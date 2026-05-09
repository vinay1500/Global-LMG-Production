import { createHash } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { getMysqlPool } from './mysql.js';
import { logEvent } from './observability.js';
import { NORMALIZED_MIGRATIONS } from './schemaMigrations.js';

interface SchemaMigrationRow extends RowDataPacket {
  checksum: string;
  id: string;
}

interface MigrationDefinition {
  description: string;
  id: string;
  statements: string[];
}

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

// Migration discipline:
// Never edit an applied migration. Add a new migration instead.
// Checksums are intentionally fatal so drift is discovered before startup changes data.
const MIGRATIONS: MigrationDefinition[] = [
  {
    id: '001-dashboard-schema',
    description: 'Create dashboard entity tables and reference data tables.',
    statements: [
      `CREATE TABLE IF NOT EXISTS dashboard_users (
        id VARCHAR(128) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        payload JSON NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_leads (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        status VARCHAR(64) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_leads_client (client_id),
        INDEX idx_dashboard_leads_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_matters (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        lifecycle_stage VARCHAR(64) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_matters_client (client_id),
        INDEX idx_dashboard_matters_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_matter_packages (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_packages_client (client_id),
        INDEX idx_dashboard_packages_matter (matter_id)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_invoices (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        status VARCHAR(64) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_invoices_client (client_id),
        INDEX idx_dashboard_invoices_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_payments (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        invoice_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_payments_client (client_id),
        INDEX idx_dashboard_payments_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_documents (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        visibility VARCHAR(32) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_documents_client (client_id),
        INDEX idx_dashboard_documents_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_events (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        status VARCHAR(32) NOT NULL,
        event_date DATE NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_events_client (client_id),
        INDEX idx_dashboard_events_sort (client_id, event_date, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_message_threads (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        matter_id VARCHAR(128) NOT NULL,
        status VARCHAR(32) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_threads_client (client_id),
        INDEX idx_dashboard_threads_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_messages (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        thread_id VARCHAR(128) NOT NULL,
        sender_role VARCHAR(32) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_messages_client (client_id),
        INDEX idx_dashboard_messages_thread (thread_id),
        INDEX idx_dashboard_messages_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_audit_entries (
        id VARCHAR(128) PRIMARY KEY,
        client_id VARCHAR(128) NOT NULL,
        entity_type VARCHAR(64) NOT NULL,
        entity_id VARCHAR(128) NOT NULL,
        sort_timestamp DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_dashboard_audit_client (client_id),
        INDEX idx_dashboard_audit_sort (client_id, sort_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_reference_advocates (
        id VARCHAR(128) PRIMARY KEY,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_reference_staff (
        id VARCHAR(128) PRIMARY KEY,
        payload JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL
      )`,
    ],
  },
  {
    id: '002-auth-schema',
    description: 'Create persistent auth accounts, flows, and sessions tables.',
    statements: [
      `CREATE TABLE IF NOT EXISTS auth_accounts (
        id VARCHAR(128) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NULL,
        provider VARCHAR(32) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        UNIQUE KEY uq_auth_accounts_email (email),
        UNIQUE KEY uq_auth_accounts_phone (phone)
      )`,
      `CREATE TABLE IF NOT EXISTS auth_flows (
        hashed_token CHAR(64) PRIMARY KEY,
        account_id VARCHAR(128) NOT NULL,
        purpose VARCHAR(32) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        INDEX idx_auth_flows_account (account_id),
        INDEX idx_auth_flows_expires (expires_at)
      )`,
      `CREATE TABLE IF NOT EXISTS auth_sessions (
        hashed_token CHAR(64) PRIMARY KEY,
        account_id VARCHAR(128) NOT NULL,
        remember_me TINYINT(1) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        last_seen_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        INDEX idx_auth_sessions_account (account_id),
        INDEX idx_auth_sessions_expires (expires_at)
      )`,
    ],
  },
  {
    id: '003-document-storage-schema',
    description: 'Create document storage manifest table for uploaded files.',
    statements: [
      `CREATE TABLE IF NOT EXISTS stored_uploads (
        id VARCHAR(128) PRIMARY KEY,
        owner_account_id VARCHAR(128) NOT NULL,
        source_module VARCHAR(64) NOT NULL,
        related_entity_type VARCHAR(64) NULL,
        related_entity_id VARCHAR(128) NULL,
        storage_driver VARCHAR(32) NOT NULL,
        storage_key VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(160) NOT NULL,
        size_bytes BIGINT NOT NULL,
        checksum_sha256 CHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        finalized_at DATETIME(3) NULL,
        payload JSON NOT NULL,
        UNIQUE KEY uq_stored_uploads_storage_key (storage_key),
        INDEX idx_stored_uploads_owner (owner_account_id),
        INDEX idx_stored_uploads_entity (related_entity_type, related_entity_id),
        INDEX idx_stored_uploads_status (status)
      )`,
    ],
  },
  ...NORMALIZED_MIGRATIONS,
];

let migrationPromise: Promise<void> | null = null;

const checksumMigration = (migration: MigrationDefinition) =>
  createHash('sha256').update(migration.statements.join('\n')).digest('hex');

const ensureMigrationTable = async (connection: PoolConnection) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(64) PRIMARY KEY,
      description VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      executed_at DATETIME(3) NOT NULL
    )
  `);
};

const getAppliedMigrations = async (connection: PoolConnection) => {
  const [rows] = await connection.query<SchemaMigrationRow[]>(
    'SELECT id, checksum FROM schema_migrations ORDER BY id ASC'
  );

  return new Map(rows.map((row) => [row.id, row.checksum]));
};

const applyMigration = async (connection: PoolConnection, migration: MigrationDefinition) => {
  const checksum = checksumMigration(migration);

  for (const statement of migration.statements) {
    await connection.query(statement);
  }

  await connection.execute(
    'INSERT INTO schema_migrations (id, description, checksum, executed_at) VALUES (?, ?, ?, ?)',
    [migration.id, migration.description, checksum, new Date()]
  );
};

export const ensureDatabaseMigrations = async () => {
  if (!isMysqlConfigured) {
    return;
  }

  if (!migrationPromise) {
    migrationPromise = (async () => {
      const pool = getMysqlPool();
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        await ensureMigrationTable(connection);
        const applied = await getAppliedMigrations(connection);

        for (const migration of MIGRATIONS) {
          const checksum = checksumMigration(migration);
          const appliedChecksum = applied.get(migration.id);

          if (appliedChecksum && appliedChecksum !== checksum) {
            throw new Error(
              `Migration checksum mismatch for ${migration.id}. Review schema history before continuing.`
            );
          }

          if (!appliedChecksum) {
            await applyMigration(connection, migration);
            logEvent('info', 'database.migration_applied', {
              migrationId: migration.id,
              description: migration.description,
            });
          }
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })().finally(() => {
      migrationPromise = null;
    });
  }

  await migrationPromise;
};
