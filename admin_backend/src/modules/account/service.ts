import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { getAdminMfaRequirementMode } from '../settings/platformSettings.js';
import { createAuditEvent } from '../writeSupport.js';

type AccountRow = RowDataPacket & {
  avatarColor: string | null;
  avatarUrl: string | null;
  city: string | null;
  dateFormat: string | null;
  defaultLandingPath: string | null;
  densityCode: string | null;
  displayName: string;
  email: string;
  firstName: string;
  inAppNotificationsEnabled: number | null;
  jobTitle: string | null;
  lastName: string | null;
  mfaEnabledAt: string | null;
  phone: string | null;
  state: string | null;
  timezoneName: string;
};

type CountRow = RowDataPacket & {
  countValue: number;
};

export type AdminProfileUpdatePayload = {
  city?: string | null;
  displayName?: string;
  jobTitle?: string | null;
  phone?: string | null;
  state?: string | null;
};

export type AdminPreferencesUpdatePayload = {
  avatarColor?: string;
  dateFormat?: string;
  defaultLandingPath?: string;
  densityCode?: 'comfortable' | 'compact';
  inAppNotificationsEnabled?: boolean;
  timezoneName?: string;
};

const DEFAULT_PREFERENCES = {
  avatarColor: '#2C2B29',
  dateFormat: 'DD/MM/YYYY',
  defaultLandingPath: '/dashboard',
  densityCode: 'comfortable',
  inAppNotificationsEnabled: true,
};

const ALLOWED_LANDING_PATHS = new Set([
  '/dashboard',
  '/clients',
  '/matters',
  '/requests',
  '/billing',
  '/messages',
  '/documents',
  '/meetings',
  '/reports',
  '/notifications',
]);

const normalizeOptional = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const splitDisplayName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/);
  return {
    firstName: parts.shift() || displayName.trim(),
    lastName: parts.length ? parts.join(' ') : null,
  };
};

const normalizeColor = (value: string) => {
  const normalized = value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    throw badRequest('invalid_avatar_color', 'Avatar color must be a hex color such as #2C2B29.');
  }

  return normalized.toUpperCase();
};

const assertPhoneAvailable = async (actor: AdminActor, phone: string | null) => {
  if (!phone) {
    return;
  }

  const rows = await queryRows<CountRow>(
    `SELECT COUNT(*) AS countValue
     FROM users
     WHERE phone = ?
       AND id <> ?
       AND archived_at IS NULL`,
    [phone, actor.userId]
  );

  if (Number(rows[0]?.countValue || 0) > 0) {
    throw badRequest('phone_already_exists', 'That phone number is already attached to another account.');
  }
};

const actorRole = (actor: AdminActor) => actor.roleCodes[0] || 'ops_admin';

const toAccountResponse = (
  actor: AdminActor,
  row: AccountRow,
  mfaRequirementMode: Awaited<ReturnType<typeof getAdminMfaRequirementMode>>
) => ({
  preferences: {
    avatarColor: row.avatarColor || DEFAULT_PREFERENCES.avatarColor,
    dateFormat: row.dateFormat || DEFAULT_PREFERENCES.dateFormat,
    defaultLandingPath: row.defaultLandingPath || DEFAULT_PREFERENCES.defaultLandingPath,
    densityCode: row.densityCode || DEFAULT_PREFERENCES.densityCode,
    inAppNotificationsEnabled:
      row.inAppNotificationsEnabled === null
        ? DEFAULT_PREFERENCES.inAppNotificationsEnabled
        : Boolean(row.inAppNotificationsEnabled),
    timezoneName: row.timezoneName,
  },
  profile: {
    avatarUrl: row.avatarUrl,
    city: row.city || '',
    displayName: row.displayName,
    email: row.email,
    firstName: row.firstName,
    id: actor.id,
    jobTitle: row.jobTitle || '',
    lastName: row.lastName || '',
    permissionCodes: actor.permissionCodes,
    phone: row.phone || '',
    roleCodes: actor.roleCodes,
    state: row.state || '',
    timezoneName: row.timezoneName,
  },
  security: {
    mfaEnabled: Boolean(row.mfaEnabledAt),
    mfaEnabledAt: row.mfaEnabledAt,
    mfaRequirementMode,
  },
});

export const getAdminAccount = async (actor: AdminActor) => {
  const rows = await queryRows<AccountRow>(
    `SELECT
       u.display_name AS displayName,
       u.first_name AS firstName,
       u.last_name AS lastName,
       u.email,
       u.phone,
       u.timezone_name AS timezoneName,
       u.avatar_url AS avatarUrl,
       sp.job_title AS jobTitle,
       sp.city,
       sp.state,
       ams.enabled_at AS mfaEnabledAt,
       aup.default_landing_path AS defaultLandingPath,
       aup.date_format AS dateFormat,
       aup.density_code AS densityCode,
       aup.avatar_color AS avatarColor,
       aup.in_app_notifications_enabled AS inAppNotificationsEnabled
     FROM users u
     LEFT JOIN staff_profiles sp ON sp.user_id = u.id
     LEFT JOIN admin_user_preferences aup ON aup.user_id = u.id
     LEFT JOIN admin_mfa_secrets ams ON ams.user_id = u.id AND ams.enabled_at IS NOT NULL
     WHERE u.id = ?
       AND u.archived_at IS NULL
     LIMIT 1`,
    [actor.userId]
  );

  const account = rows[0] || null;
  if (!account) {
    throw notFound('admin_profile_not_found', 'Admin profile was not found.');
  }

  return toAccountResponse(actor, account, await getAdminMfaRequirementMode());
};

export const updateAdminProfile = async (actor: AdminActor, payload: AdminProfileUpdatePayload) => {
  await assertPhoneAvailable(actor, normalizeOptional(payload.phone));

  await withTransaction(async (connection) => {
    const currentRows = await queryRows<AccountRow>(
      `SELECT
         u.display_name AS displayName,
         u.first_name AS firstName,
         u.last_name AS lastName,
         u.email,
         u.phone,
         u.timezone_name AS timezoneName,
         u.avatar_url AS avatarUrl,
         NULL AS jobTitle,
         NULL AS city,
         NULL AS state,
         NULL AS mfaEnabledAt,
         NULL AS defaultLandingPath,
         NULL AS dateFormat,
         NULL AS densityCode,
         NULL AS avatarColor,
         NULL AS inAppNotificationsEnabled
       FROM users u
       WHERE u.id = ?
       LIMIT 1`,
      [actor.userId],
      connection
    );
    const current = currentRows[0] || null;
    if (!current) {
      throw notFound('admin_profile_not_found', 'Admin profile was not found.');
    }

    const displayName = payload.displayName?.trim() || current.displayName;
    if (displayName.length < 2) {
      throw badRequest('invalid_display_name', 'Display name must be at least 2 characters.');
    }

    const { firstName, lastName } = splitDisplayName(displayName);
    const phone = payload.phone === undefined ? current.phone : normalizeOptional(payload.phone);

    await executeStatement<ResultSetHeader>(
      `UPDATE users
       SET display_name = ?,
           first_name = ?,
           last_name = ?,
           phone = ?,
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [displayName, firstName, lastName, phone, actor.userId],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'admin.profile_updated',
        actionLabel: 'Admin profile updated',
        actorRoleCode: actorRole(actor),
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'display_name', newValue: displayName, oldValue: current.displayName },
          { fieldName: 'phone', newValue: phone, oldValue: current.phone },
        ],
        entityPk: actor.userId,
        entityTableName: 'users',
        sourceModule: 'admin_account',
        summaryNewValue: { displayName, phone },
        summaryOldValue: { displayName: current.displayName, phone: current.phone },
      },
      connection
    );
  });

  return getAdminAccount({
    ...actor,
    displayName: payload.displayName?.trim() || actor.displayName,
  });
};

export const updateAdminPreferences = async (
  actor: AdminActor,
  payload: AdminPreferencesUpdatePayload
) => {
  const current = await getAdminAccount(actor);
  const next = {
    avatarColor:
      payload.avatarColor === undefined
        ? current.preferences.avatarColor
        : normalizeColor(payload.avatarColor),
    dateFormat: payload.dateFormat?.trim() || current.preferences.dateFormat,
    defaultLandingPath: payload.defaultLandingPath?.trim() || current.preferences.defaultLandingPath,
    densityCode: payload.densityCode || current.preferences.densityCode,
    inAppNotificationsEnabled:
      payload.inAppNotificationsEnabled === undefined
        ? current.preferences.inAppNotificationsEnabled
        : payload.inAppNotificationsEnabled,
    timezoneName: payload.timezoneName?.trim() || current.preferences.timezoneName,
  };

  if (!ALLOWED_LANDING_PATHS.has(next.defaultLandingPath)) {
    throw badRequest('invalid_landing_path', 'Default landing page must be an existing admin route.');
  }

  if (!['comfortable', 'compact'].includes(next.densityCode)) {
    throw badRequest('invalid_density', 'Density must be comfortable or compact.');
  }

  if (!next.timezoneName || next.timezoneName.length > 64) {
    throw badRequest('invalid_timezone', 'Timezone is required and must be 64 characters or fewer.');
  }

  await withTransaction(async (connection) => {
    await executeStatement(
      `UPDATE users
       SET timezone_name = ?,
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [next.timezoneName, actor.userId],
      connection
    );

    await executeStatement(
      `INSERT INTO admin_user_preferences (
         user_id,
         default_landing_path,
         date_format,
         density_code,
         avatar_color,
         in_app_notifications_enabled,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE
         default_landing_path = VALUES(default_landing_path),
         date_format = VALUES(date_format),
         density_code = VALUES(density_code),
         avatar_color = VALUES(avatar_color),
         in_app_notifications_enabled = VALUES(in_app_notifications_enabled),
         updated_at = UTC_TIMESTAMP(6)`,
      [
        actor.userId,
        next.defaultLandingPath,
        next.dateFormat,
        next.densityCode,
        next.avatarColor,
        next.inAppNotificationsEnabled ? 1 : 0,
      ],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'admin.preferences_updated',
        actionLabel: 'Admin preferences updated',
        actorRoleCode: actorRole(actor),
        actorUserId: actor.userId,
        changes: [
          {
            fieldName: 'preferences',
            newValue: next,
            oldValue: current.preferences,
          },
        ],
        entityPk: actor.userId,
        entityTableName: 'admin_user_preferences',
        sourceModule: 'admin_account',
        summaryNewValue: next,
        summaryOldValue: current.preferences,
      },
      connection
    );
  });

  return getAdminAccount(actor);
};
