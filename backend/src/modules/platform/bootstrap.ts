import type { PoolConnection } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { nowUtc, toMysqlDateTime } from '../../lib/datetime.js';
import { createPublicId } from '../../lib/ids.js';
import { ensureDatabaseMigrations } from '../../lib/migrations.js';
import { getMysqlPool } from '../../lib/mysql.js';
import { withTransaction } from '../../lib/mysqlUtils.js';
import {
  CONSULTATION_MODE_SEEDS,
  EVENT_STATUS_SEEDS,
  INVOICE_STATUS_SEEDS,
  LEGAL_DOMAIN_SEEDS,
  MATTER_OPERATIONAL_STATUS_SEEDS,
  MATTER_STAGE_SEEDS,
  NOTIFICATION_TYPE_SEEDS,
  PAYMENT_STATUS_SEEDS,
  PERMISSION_SEEDS,
  PRICING_CONSULTATION_RULE_SEEDS,
  PRICING_SERVICE_SLAB_SEEDS,
  PRICING_URGENCY_RULE_SEEDS,
  REQUEST_STATUS_SEEDS,
  ROLE_PERMISSION_SEEDS,
  ROLE_SEEDS,
  SERVICE_SEEDS,
  TAX_RATE_SEEDS,
  THREAD_STATUS_SEEDS,
} from './referenceData.js';

let platformBootstrapPromise: Promise<void> | null = null;

const upsertLookup = async (
  connection: PoolConnection,
  tableName: string,
  columns: string[],
  values: Array<Array<string | number | null>>
) => {
  for (const row of values) {
    const placeholders = columns.map(() => '?').join(', ');
    const updateAssignments = columns
      .slice(1)
      .map((column) => `${column} = VALUES(${column})`)
      .join(', ');

    await connection.execute(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updateAssignments}`,
      row
    );
  }
};

const seedReferenceData = async (connection: PoolConnection) => {
  const timestamp = toMysqlDateTime(nowUtc());

  await upsertLookup(
    connection,
    'roles',
    ['code', 'name', 'description', 'is_system', 'is_active', 'created_at', 'updated_at'],
    ROLE_SEEDS.map((role) => [
      role.code,
      role.name,
      role.description,
      1,
      1,
      timestamp,
      timestamp,
    ])
  );

  await upsertLookup(
    connection,
    'permissions',
    ['code', 'module_name', 'action_name', 'description', 'created_at', 'updated_at'],
    PERMISSION_SEEDS.map(([code, moduleName, actionName, description]) => [
      code,
      moduleName,
      actionName,
      description,
      timestamp,
      timestamp,
    ])
  );

  for (const [roleCode, permissionCodes] of ROLE_PERMISSION_SEEDS) {
    for (const permissionCode of permissionCodes) {
      await connection.execute(
        `INSERT INTO role_permissions (role_code, permission_code, granted_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE granted_at = VALUES(granted_at)`,
        [roleCode, permissionCode, timestamp]
      );
    }
  }

  await upsertLookup(
    connection,
    'consultation_modes',
    ['code', 'label', 'sort_order', 'is_active'],
    CONSULTATION_MODE_SEEDS.map(([code, label, sortOrder]) => [code, label, sortOrder, 1])
  );

  await upsertLookup(
    connection,
    'request_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    REQUEST_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'matter_stages',
    ['code', 'label', 'stage_order', 'is_client_visible', 'is_terminal', 'is_active'],
    MATTER_STAGE_SEEDS.map(([code, label, stageOrder, isClientVisible, isTerminal]) => [
      code,
      label,
      stageOrder,
      isClientVisible,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'matter_operational_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    MATTER_OPERATIONAL_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'invoice_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    INVOICE_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'payment_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    PAYMENT_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'thread_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    THREAD_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'event_statuses',
    ['code', 'label', 'sort_order', 'is_terminal', 'is_active'],
    EVENT_STATUS_SEEDS.map(([code, label, sortOrder, isTerminal]) => [
      code,
      label,
      sortOrder,
      isTerminal,
      1,
    ])
  );

  await upsertLookup(
    connection,
    'notification_types',
    ['code', 'label', 'sort_order', 'is_active'],
    NOTIFICATION_TYPE_SEEDS.map(([code, label, sortOrder]) => [code, label, sortOrder, 1])
  );

  for (const [code, name, sortOrder] of LEGAL_DOMAIN_SEEDS) {
    await connection.execute(
      `INSERT INTO legal_domains (
        public_id, domain_code, domain_name, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        domain_code = domain_code`,
      [createPublicId(), code, name, sortOrder, 1, timestamp, timestamp]
    );
  }

  for (const [serviceCode, , serviceName, serviceDescription, sortOrder, isSubEligible] of SERVICE_SEEDS) {
    await connection.execute(
      `INSERT INTO services (
        public_id, service_code, service_name, service_description, sort_order,
        is_active, is_subscription_eligible, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        service_code = service_code`,
      [
        createPublicId(),
        serviceCode,
        serviceName,
        serviceDescription,
        sortOrder,
        1,
        isSubEligible,
        timestamp,
        timestamp,
      ]
    );
  }

  for (const [minCount, maxCount, baseAmount, perExtraAmount] of PRICING_SERVICE_SLAB_SEEDS) {
    await connection.execute(
      `INSERT INTO pricing_service_slabs (
        effective_from, effective_to, min_service_count, max_service_count, base_amount,
        per_extra_service_amount, is_active, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM pricing_service_slabs
        WHERE effective_from = ?
          AND min_service_count = ?
          AND (
            (max_service_count IS NULL AND ? IS NULL)
            OR max_service_count = ?
          )
      )`,
      [
        '2024-01-01',
        null,
        minCount,
        maxCount,
        baseAmount,
        perExtraAmount,
        1,
        timestamp,
        timestamp,
        '2024-01-01',
        minCount,
        maxCount,
        maxCount,
      ]
    );
  }

  for (const [code, label, surchargeType, surchargeValue, sortOrder] of PRICING_URGENCY_RULE_SEEDS) {
    await connection.execute(
      `INSERT INTO pricing_urgency_rules (
        urgency_code, label, surcharge_type_code, surcharge_value, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        urgency_code = urgency_code`,
      [code, label, surchargeType, surchargeValue, sortOrder, 1, timestamp, timestamp]
    );
  }

  for (const [modeCode, surchargeType, surchargeValue] of PRICING_CONSULTATION_RULE_SEEDS) {
    await connection.execute(
      `INSERT INTO pricing_consultation_mode_rules (
        consultation_mode_code, surcharge_type_code, surcharge_value, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        surcharge_type_code = VALUES(surcharge_type_code),
        surcharge_value = VALUES(surcharge_value),
        is_active = VALUES(is_active),
        updated_at = VALUES(updated_at)`,
      [modeCode, surchargeType, surchargeValue, 1, timestamp, timestamp]
    );
  }

  for (const [taxCode, taxName, ratePercent, jurisdictionCode, effectiveFrom] of TAX_RATE_SEEDS) {
    await connection.execute(
      `INSERT INTO tax_rates (
        tax_code, tax_name, rate_percent, jurisdiction_code, effective_from, effective_to, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        tax_name = VALUES(tax_name),
        rate_percent = VALUES(rate_percent),
        jurisdiction_code = VALUES(jurisdiction_code),
        effective_to = VALUES(effective_to),
        is_active = VALUES(is_active),
        updated_at = VALUES(updated_at)`,
      [taxCode, taxName, ratePercent, jurisdictionCode, effectiveFrom, null, 1, timestamp, timestamp]
    );
  }
};

const seedPreviewData = async (_connection: PoolConnection) => {
  return;
};

export const ensurePlatformReady = async () => {
  if (!env.MYSQL_HOST || !env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD) {
    return;
  }

  if (!platformBootstrapPromise) {
    platformBootstrapPromise = (async () => {
      await ensureDatabaseMigrations();
      await withTransaction(getMysqlPool(), async (connection) => {
        await seedReferenceData(connection);
        await seedPreviewData(connection);
      });
    })().catch((error) => {
      platformBootstrapPromise = null;
      throw error;
    });
  }

  await platformBootstrapPromise;
};
