import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AppError, badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { createAuditEvent } from '../writeSupport.js';

export type PlatformSettingValue = boolean | number | string | null;
export type PlatformSettingValueType = 'boolean' | 'decimal' | 'integer' | 'json' | 'select' | 'string' | 'text';
export type AdminMfaRequirementMode = 'enforce' | 'off' | 'warn';

export type PlatformSetting = {
  category: string;
  description: string | null;
  isSensitive: boolean;
  key: string;
  label: string;
  masked: boolean;
  updatedAt: string;
  updatedBy: number | null;
  value: PlatformSettingValue;
  valueType: PlatformSettingValueType;
  version: number;
};

export type UpdatePlatformSettingPayload = {
  value: PlatformSettingValue;
  version?: number;
};

type PlatformSettingRow = RowDataPacket & {
  category: string;
  description: string | null;
  isSensitive: number;
  label: string;
  settingKey: string;
  settingValueJson: unknown;
  updatedAt: string;
  updatedBy: number | null;
  valueType: PlatformSettingValueType;
  version: number;
};

type SettingRule = {
  allowEmpty?: boolean;
  maxLength?: number;
  options?: string[];
  pattern?: RegExp;
  type: PlatformSettingValueType;
};

type CountRow = RowDataPacket & {
  countValue: number;
};

export const PLATFORM_TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'UTC',
  'Europe/London',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Singapore',
] as const;

export const PLATFORM_TIMEZONE_PATTERN =
  /^(UTC|[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/;

export const isAllowedPlatformTimezone = (value: string) =>
  (PLATFORM_TIMEZONE_OPTIONS as readonly string[]).includes(value);

export const ADMIN_MFA_REQUIREMENT_MODES = ['off', 'warn', 'enforce'] as const;

export const normalizeAdminMfaRequirementMode = (
  value: unknown
): AdminMfaRequirementMode => {
  if (typeof value !== 'string') {
    return 'off';
  }

  const normalized = value.trim().toLowerCase();
  return (ADMIN_MFA_REQUIREMENT_MODES as readonly string[]).includes(normalized)
    ? (normalized as AdminMfaRequirementMode)
    : 'off';
};

const SETTING_RULES: Record<string, SettingRule> = {
  'platform.default_currency': {
    options: ['USD'],
    pattern: /^[A-Z]{3}$/,
    type: 'select',
  },
  'platform.default_date_format': {
    options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'],
    type: 'select',
  },
  'platform.default_timezone': {
    options: Array.from(PLATFORM_TIMEZONE_OPTIONS),
    pattern: PLATFORM_TIMEZONE_PATTERN,
    type: 'select',
  },
  'platform.display_name': { maxLength: 120, type: 'string' },
  'platform.operational_footer_note': { allowEmpty: true, maxLength: 1000, type: 'text' },
  'platform.support_email': {
    allowEmpty: true,
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    type: 'string',
  },
  'platform.support_phone': {
    allowEmpty: true,
    maxLength: 40,
    pattern: /^[0-9+\-()\s.]*$/,
    type: 'string',
  },
  'pricing.show_approximate_local_currency': { type: 'boolean' },
  'portal.maintenance_banner_enabled': { type: 'boolean' },
  'portal.maintenance_banner_message': { allowEmpty: true, maxLength: 500, type: 'text' },
  'security.admin_mfa_required_mode': {
    options: Array.from(ADMIN_MFA_REQUIREMENT_MODES),
    type: 'select',
  },
};

const decodeSettingValue = (rawValue: unknown): PlatformSettingValue => {
  const parsed =
    typeof rawValue === 'string'
      ? JSON.parse(rawValue)
      : rawValue && typeof rawValue === 'object'
        ? rawValue
        : null;

  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, 'value')) {
    return null;
  }

  const value = (parsed as { value: unknown }).value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value === null) {
    return value;
  }

  return JSON.stringify(value);
};

export const getPlatformDefaultTimezone = async (executor?: QueryExecutor) => {
  const rows = await queryRows<Pick<PlatformSettingRow, 'settingValueJson'> & RowDataPacket>(
    `SELECT setting_value_json AS settingValueJson
     FROM platform_settings
     WHERE setting_key = 'platform.default_timezone'
     LIMIT 1`,
    [],
    executor
  );
  const value = rows[0] ? decodeSettingValue(rows[0].settingValueJson) : null;

  return typeof value === 'string' && isAllowedPlatformTimezone(value) ? value : 'UTC';
};

export const getAdminMfaRequirementMode = async (
  executor?: QueryExecutor
): Promise<AdminMfaRequirementMode> => {
  const rows = await queryRows<Pick<PlatformSettingRow, 'settingValueJson'> & RowDataPacket>(
    `SELECT setting_value_json AS settingValueJson
     FROM platform_settings
     WHERE setting_key = 'security.admin_mfa_required_mode'
     LIMIT 1`,
    [],
    executor
  );
  const value = rows[0] ? decodeSettingValue(rows[0].settingValueJson) : null;

  return normalizeAdminMfaRequirementMode(value);
};

const countActiveAdminsWithoutMfa = async () => {
  const rows = await queryRows<CountRow>(
    `SELECT COUNT(DISTINCT u.id) AS countValue
     FROM users u
     INNER JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     INNER JOIN roles r
       ON r.code = ur.role_code
      AND r.is_active = 1
      AND r.code <> 'client'
     LEFT JOIN admin_mfa_secrets ams
       ON ams.user_id = u.id
      AND ams.enabled_at IS NOT NULL
     WHERE u.archived_at IS NULL
       AND u.actor_type_code <> 'client'
       AND u.login_enabled = 1
       AND ams.id IS NULL`
  );

  return Number(rows[0]?.countValue || 0);
};

const mapRow = (row: PlatformSettingRow): PlatformSetting => {
  const isSensitive = Boolean(row.isSensitive);

  return {
    category: row.category,
    description: row.description,
    isSensitive,
    key: row.settingKey,
    label: row.label,
    masked: isSensitive,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy === null ? null : Number(row.updatedBy),
    value: isSensitive ? null : decodeSettingValue(row.settingValueJson),
    valueType: row.valueType,
    version: Number(row.version || 0),
  };
};

const normalizeValue = (
  key: string,
  value: PlatformSettingValue,
  valueType: PlatformSettingValueType
): PlatformSettingValue => {
  const rule = SETTING_RULES[key] || { type: valueType };

  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw badRequest('invalid_setting_value', `${key} must be true or false.`);
    }

    return value;
  }

  if (rule.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw badRequest('invalid_setting_value', `${key} must be a whole number.`);
    }

    return value;
  }

  if (rule.type === 'decimal') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw badRequest('invalid_setting_value', `${key} must be a number.`);
    }

    return value;
  }

  if (typeof value !== 'string') {
    throw badRequest('invalid_setting_value', `${key} must be text.`);
  }

  const normalized = value.trim();
  if (!rule.allowEmpty && normalized.length === 0) {
    throw badRequest('invalid_setting_value', `${key} cannot be empty.`);
  }

  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw badRequest('invalid_setting_value', `${key} must be ${rule.maxLength} characters or fewer.`);
  }

  if (rule.pattern && normalized && !rule.pattern.test(normalized)) {
    throw badRequest('invalid_setting_value', `${key} has an invalid format.`);
  }

  if (rule.options && normalized && !rule.options.includes(normalized)) {
    throw badRequest('invalid_setting_value', `${key} must be one of the configured options.`);
  }

  return normalized;
};

const selectPlatformSetting = async (key: string) => {
  const rows = await queryRows<PlatformSettingRow>(
    `SELECT
       setting_key AS settingKey,
       setting_value_json AS settingValueJson,
       category,
       label,
       description,
       value_type AS valueType,
       is_sensitive AS isSensitive,
       version,
       updated_by AS updatedBy,
       updated_at AS updatedAt
     FROM platform_settings
     WHERE setting_key = ?
     LIMIT 1`,
    [key]
  );

  return rows[0] || null;
};

export const getPlatformSettings = async (): Promise<PlatformSetting[]> => {
  const rows = await queryRows<PlatformSettingRow>(
    `SELECT
       setting_key AS settingKey,
       setting_value_json AS settingValueJson,
       category,
       label,
       description,
       value_type AS valueType,
       is_sensitive AS isSensitive,
       version,
       updated_by AS updatedBy,
       updated_at AS updatedAt
     FROM platform_settings
     ORDER BY category ASC, label ASC`
  );

  return rows.map(mapRow);
};

export const updatePlatformSetting = async (
  actor: AdminActor,
  key: string,
  payload: UpdatePlatformSettingPayload
): Promise<PlatformSetting> => {
  const existingRow = await selectPlatformSetting(key);
  if (!existingRow) {
    throw notFound('setting_not_found', 'Platform setting not found.');
  }

  if (existingRow.isSensitive) {
    throw badRequest('sensitive_setting_unsupported', 'Sensitive settings cannot be updated through this endpoint.');
  }

  const current = mapRow(existingRow);
  const normalizedValue = normalizeValue(key, payload.value, existingRow.valueType);
  const expectedVersion = payload.version ?? current.version;

  if (key === 'security.admin_mfa_required_mode' && normalizedValue === 'enforce') {
    const unenrolledAdminCount = await countActiveAdminsWithoutMfa();
    if (unenrolledAdminCount > 0) {
      throw badRequest(
        'admin_mfa_enforcement_blocked',
        `MFA enforcement cannot be enabled until ${unenrolledAdminCount} active admin account${unenrolledAdminCount === 1 ? '' : 's'} have enrolled. Use warn mode during rollout.`
      );
    }
  }

  const result = await executeStatement<ResultSetHeader>(
    `UPDATE platform_settings
     SET setting_value_json = ?,
         version = version + 1,
         updated_by = ?,
         updated_at = UTC_TIMESTAMP(6)
     WHERE setting_key = ?
       AND version = ?`,
    [JSON.stringify({ value: normalizedValue }), actor.userId, key, expectedVersion]
  );

  if (result.affectedRows === 0) {
    throw new AppError(
      409,
      'setting_version_conflict',
      'This setting changed after you loaded the page. Reload settings and try again.'
    );
  }

  await createAuditEvent({
    actionCode: 'settings.updated',
    actionLabel: 'Platform setting updated',
    actorRoleCode: actor.roleCodes[0] || 'ops_admin',
    actorUserId: actor.userId,
    changes: [
      {
        fieldName: key,
        newValue: normalizedValue,
        oldValue: current.value,
      },
    ],
    entityPk: null,
    entityTableName: 'platform_settings',
    sourceModule: 'settings_workspace',
    summaryNewValue: { key },
  });

  const updatedRow = await selectPlatformSetting(key);
  if (!updatedRow) {
    throw notFound('setting_not_found', 'Platform setting not found.');
  }

  return mapRow(updatedRow);
};
