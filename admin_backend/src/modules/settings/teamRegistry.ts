import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPublicId } from '../../lib/authCrypto.js';
import { AppError, badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { createAuditEvent } from '../writeSupport.js';
import { getPlatformDefaultTimezone } from './platformSettings.js';

export type TeamMemberType = 'external_counsel' | 'field_partner' | 'internal_staff';

export type TeamMemberPayload = {
  active?: boolean;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  name: string;
  phone?: string | null;
  specialization?: string | null;
  state?: string | null;
  type: TeamMemberType;
};

export type UpdateTeamMemberPayload = Partial<TeamMemberPayload>;

type StaffRegistryRow = RowDataPacket & {
  assignmentCount: number;
  city: string | null;
  email: string;
  employmentStatusCode: string;
  id: string;
  name: string;
  phone: string | null;
  specialization: string;
  state: string | null;
};

type CounselRegistryRow = RowDataPacket & {
  active: number;
  assignmentCount: number;
  city: string;
  country: string;
  email: string;
  id: string;
  name: string;
  phone: string;
  specialization: string | null;
  state: string;
  type: TeamMemberType | null;
};

type IdRow = RowDataPacket & { id: number };
type StaffDetailRow = RowDataPacket & {
  dbId: number;
  email: string;
  employmentStatusCode: string;
  id: string;
  name: string;
  phone: string | null;
};
type CounselDetailRow = RowDataPacket & {
  dbId: number;
  email: string;
  id: string;
  name: string;
  phone: string;
  type: TeamMemberType | null;
};

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const normalizeOptionalText = (value: string | null | undefined) => {
  const next = value?.trim();
  return next ? next : null;
};

const normalizeRequiredText = (value: string | undefined, fieldName: string) => {
  const next = value?.trim();
  if (!next || next.length < 2) {
    throw badRequest('invalid_team_member', `${fieldName} is required.`);
  }

  return next;
};

const assertEmail = (email: string | null) => {
  if (!email) {
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('invalid_email', 'Enter a valid email address.');
  }
};

const splitName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || name,
    lastName: parts.slice(1).join(' ') || null,
  };
};

const normalizePayload = (payload: TeamMemberPayload): TeamMemberPayload => {
  const name = normalizeRequiredText(payload.name, 'Name');
  const email = normalizeOptionalText(payload.email);
  assertEmail(email);

  return {
    active: payload.active ?? true,
    city: normalizeOptionalText(payload.city),
    country: normalizeOptionalText(payload.country) || 'IN',
    email,
    name,
    phone: normalizeOptionalText(payload.phone),
    specialization: normalizeOptionalText(payload.specialization),
    state: normalizeOptionalText(payload.state),
    type: payload.type,
  };
};

const assertUserEmailAvailable = async (
  email: string | null,
  executor: QueryExecutor,
  excludeUserId?: number
) => {
  if (!email) {
    return;
  }

  const duplicate = firstRow(
    await queryRows<IdRow>(
      `SELECT id
       FROM users
       WHERE LOWER(email) = LOWER(?)
         AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [email, excludeUserId ?? null, excludeUserId ?? null],
      executor
    )
  );

  if (duplicate) {
    throw new AppError(409, 'team_member_email_exists', 'A user with this email already exists.');
  }
};

const assertCounselEmailAvailable = async (
  email: string | null,
  executor: QueryExecutor,
  excludeCounselId?: number
) => {
  if (!email) {
    return;
  }

  const duplicate = firstRow(
    await queryRows<IdRow>(
      `SELECT id
       FROM counsel_partners
       WHERE archived_at IS NULL
         AND LOWER(email) = LOWER(?)
         AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [email, excludeCounselId ?? null, excludeCounselId ?? null],
      executor
    )
  );

  if (duplicate) {
    throw new AppError(409, 'team_member_email_exists', 'A registry entry with this email already exists.');
  }
};

const generateCounselCode = (type: TeamMemberType, publicId: string) => {
  const prefix = type === 'field_partner' ? 'FIELD' : 'COUNSEL';
  return `${prefix}-${publicId.slice(-10).toUpperCase()}`;
};

const syntheticStaffEmail = (publicId: string) => `${publicId.toLowerCase()}@staff.local.globallmg`;

const mapStaff = (row: StaffRegistryRow) => ({
  active: row.employmentStatusCode === 'active',
  assignmentCount: Number(row.assignmentCount || 0),
  city: row.city || '',
  country: 'IN',
  email: row.email.includes('@staff.local.globallmg') ? '' : row.email,
  id: row.id,
  name: row.name,
  phone: row.phone || '',
  specialization: row.specialization || '',
  state: row.state || '',
  type: 'internal_staff' as const,
});

const mapCounsel = (row: CounselRegistryRow) => ({
  active: Boolean(row.active),
  assignmentCount: Number(row.assignmentCount || 0),
  city: row.city || '',
  country: row.country || 'IN',
  email: row.email || '',
  id: row.id,
  name: row.name,
  phone: row.phone || '',
  specialization: row.specialization || '',
  state: row.state || '',
  type: row.type || ('external_counsel' as const),
});

export const getTeamRegistry = async (actor?: AdminActor) => {
  const canView = !actor || actor.permissionCodes.includes('counsel_partner.view') || actor.permissionCodes.includes('settings.manage');
  const canManage = Boolean(actor?.permissionCodes.includes('counsel_partner.manage'));

  if (!canView) {
    return { canManage: false, members: [] };
  }

  const [staffRows, counselRows] = await Promise.all([
    queryRows<StaffRegistryRow>(
      `SELECT
         u.public_id AS id,
         u.display_name AS name,
         u.email,
         u.phone,
         sp.job_title AS specialization,
         sp.employment_status_code AS employmentStatusCode,
         sp.city,
         sp.state,
         COUNT(ma.id) AS assignmentCount
       FROM staff_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       LEFT JOIN matter_assignments ma
         ON ma.internal_user_id = u.id
        AND ma.removed_at IS NULL
        AND ma.assignment_status_code = 'active'
       WHERE u.archived_at IS NULL
         AND u.actor_type_code <> 'client'
       GROUP BY
         u.public_id,
         u.display_name,
         u.email,
         u.phone,
         sp.job_title,
         sp.employment_status_code,
         sp.city,
         sp.state
       ORDER BY u.display_name ASC`
    ),
    queryRows<CounselRegistryRow>(
      `SELECT
         cp.public_id AS id,
         COALESCE(cp.partner_type_code, 'external_counsel') AS type,
         cp.full_name AS name,
         cp.email,
         cp.phone,
         COALESCE(cp.specialization_text, cp.primary_jurisdiction) AS specialization,
         cp.city,
         cp.state,
         cp.country_code AS country,
         CASE WHEN cp.archived_at IS NULL AND cp.partner_status_code = 'active' THEN 1 ELSE 0 END AS active,
         COUNT(ma.id) AS assignmentCount
       FROM counsel_partners cp
       LEFT JOIN matter_assignments ma
         ON ma.counsel_partner_id = cp.id
        AND ma.removed_at IS NULL
        AND ma.assignment_status_code = 'active'
       GROUP BY
         cp.public_id,
         cp.partner_type_code,
         cp.full_name,
         cp.email,
         cp.phone,
         cp.specialization_text,
         cp.primary_jurisdiction,
         cp.city,
         cp.state,
         cp.country_code,
         cp.archived_at,
         cp.partner_status_code
       ORDER BY cp.archived_at IS NULL DESC, cp.full_name ASC`
    ),
  ]);

  return {
    canManage,
    members: [...staffRows.map(mapStaff), ...counselRows.map(mapCounsel)],
  };
};

const getStaffDetail = async (memberId: string, executor?: QueryExecutor) =>
  firstRow(
    await queryRows<StaffDetailRow>(
      `SELECT
         u.id AS dbId,
         u.public_id AS id,
         u.display_name AS name,
         u.email,
         u.phone,
         sp.employment_status_code AS employmentStatusCode
       FROM staff_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       WHERE u.public_id = ?
         AND u.archived_at IS NULL
       LIMIT 1`,
      [memberId],
      executor
    )
  );

const getCounselDetail = async (memberId: string, executor?: QueryExecutor) =>
  firstRow(
    await queryRows<CounselDetailRow>(
      `SELECT
         id AS dbId,
         public_id AS id,
         COALESCE(partner_type_code, 'external_counsel') AS type,
         full_name AS name,
         email,
         phone
       FROM counsel_partners
       WHERE public_id = ?
       LIMIT 1`,
      [memberId],
      executor
    )
  );

const getTeamMember = async (memberId: string, executor?: QueryExecutor) => {
  const staff = await getStaffDetail(memberId, executor);
  if (staff) {
    return { dbId: staff.dbId, type: 'internal_staff' as const };
  }

  const counsel = await getCounselDetail(memberId, executor);
  if (counsel) {
    return { dbId: counsel.dbId, type: counsel.type || ('external_counsel' as const) };
  }

  throw notFound('team_member_not_found', 'Team registry entry not found.');
};

export const createTeamMember = async (actor: AdminActor, payload: TeamMemberPayload) => {
  const next = normalizePayload(payload);

  return withTransaction(async (connection) => {
    if (next.type === 'internal_staff') {
      await assertUserEmailAvailable(next.email || null, connection);
      const publicId = createPublicId();
      const { firstName, lastName } = splitName(next.name);
      const email = next.email || syntheticStaffEmail(publicId);
      const timezoneName = await getPlatformDefaultTimezone(connection);

      const result = await executeStatement<ResultSetHeader>(
        `INSERT INTO users (
           public_id,
           email,
           phone,
           display_name,
           first_name,
           last_name,
           actor_type_code,
           account_status_code,
           timezone_name,
           locale_code,
           avatar_url,
           login_enabled,
           last_login_at,
           email_verified_at,
           phone_verified_at,
           created_at,
           updated_at,
           archived_at,
           row_version
         ) VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', ?, 'en-US', NULL, 0, NULL, NULL, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, 1)`,
        [publicId, email, next.phone, next.name, firstName, lastName, timezoneName],
        connection
      );

      await executeStatement(
        `INSERT INTO staff_profiles (
           user_id,
           job_title,
           employment_status_code,
           manager_user_id,
           city,
           state
         ) VALUES (?, ?, ?, NULL, ?, ?)`,
        [
          result.insertId,
          next.specialization || 'Coordination Staff',
          next.active ? 'active' : 'inactive',
          next.city,
          next.state,
        ],
        connection
      );

      await createAuditEvent(
        {
          actionCode: 'staff.created',
          actionLabel: 'Internal coordination staff created',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', newValue: next.name },
            { fieldName: 'email', newValue: next.email ? '[provided]' : '[not configured]' },
            { fieldName: 'active', newValue: next.active },
          ],
          entityPk: result.insertId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );

      return {
        active: next.active ?? true,
        assignmentCount: 0,
        city: next.city || '',
        country: next.country || 'IN',
        email: next.email || '',
        id: publicId,
        name: next.name,
        phone: next.phone || '',
        specialization: next.specialization || 'Coordination Staff',
        state: next.state || '',
        type: 'internal_staff' as const,
      };
    }

    await assertCounselEmailAvailable(next.email || null, connection);
    const publicId = createPublicId();
    const result = await executeStatement<ResultSetHeader>(
      `INSERT INTO counsel_partners (
         public_id,
         counsel_code,
         full_name,
         organization_name,
         partner_type_code,
         email,
         phone,
         bar_registration_number,
         specialization_text,
         primary_jurisdiction,
         city,
         state,
         country_code,
         years_experience,
         availability_status_code,
         partner_status_code,
         invited_user_id,
         created_at,
         updated_at,
         archived_at,
         row_version
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 'available', ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, 1)`,
      [
        publicId,
        generateCounselCode(next.type, publicId),
        next.name,
        next.type,
        next.email || '',
        next.phone || '',
        next.specialization,
        next.specialization || next.state || next.country || 'Not specified',
        next.city || '',
        next.state || '',
        next.country || 'IN',
        next.active ? 'active' : 'inactive',
      ],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'counsel.created',
        actionLabel: next.type === 'field_partner' ? 'Field partner created' : 'External counsel created',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'name', newValue: next.name },
          { fieldName: 'type', newValue: next.type },
          { fieldName: 'active', newValue: next.active },
        ],
        entityPk: result.insertId,
        entityTableName: 'counsel_partners',
        sourceModule: 'settings_team_registry',
      },
      connection
    );

    return {
      active: next.active ?? true,
      assignmentCount: 0,
      city: next.city || '',
      country: next.country || 'IN',
      email: next.email || '',
      id: publicId,
      name: next.name,
      phone: next.phone || '',
      specialization: next.specialization || '',
      state: next.state || '',
      type: next.type,
    };
  });
};

export const updateTeamMember = async (
  actor: AdminActor,
  memberId: string,
  payload: UpdateTeamMemberPayload
) => {
  return withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);
    const currentRegistry = await getTeamRegistry(actor);
    const current = currentRegistry.members.find((member) => member.id === memberId);

    if (!current) {
      throw notFound('team_member_not_found', 'Team registry entry not found.');
    }

    const next = normalizePayload({
      active: payload.active ?? current.active,
      city: payload.city === undefined ? current.city : payload.city,
      country: payload.country === undefined ? current.country : payload.country,
      email: payload.email === undefined ? current.email : payload.email,
      name: payload.name ?? current.name,
      phone: payload.phone === undefined ? current.phone : payload.phone,
      specialization: payload.specialization === undefined ? current.specialization : payload.specialization,
      state: payload.state === undefined ? current.state : payload.state,
      type: existing.type,
    });

    if (existing.type === 'internal_staff') {
      await assertUserEmailAvailable(next.email || null, connection, existing.dbId);
      const { firstName, lastName } = splitName(next.name);
      const email = next.email || current.email || syntheticStaffEmail(memberId);

      await executeStatement(
        `UPDATE users
         SET display_name = ?,
             first_name = ?,
             last_name = ?,
             email = ?,
             phone = ?,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [next.name, firstName, lastName, email, next.phone, existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE staff_profiles
         SET job_title = ?,
             employment_status_code = ?,
             city = ?,
             state = ?
         WHERE user_id = ?`,
        [
          next.specialization || 'Coordination Staff',
          next.active ? 'active' : 'inactive',
          next.city,
          next.state,
          existing.dbId,
        ],
        connection
      );

      await createAuditEvent(
        {
          actionCode: 'staff.updated',
          actionLabel: 'Internal coordination staff updated',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', oldValue: current.name, newValue: next.name },
            { fieldName: 'active', oldValue: current.active, newValue: next.active },
          ],
          entityPk: existing.dbId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    } else {
      await assertCounselEmailAvailable(next.email || null, connection, existing.dbId);

      await executeStatement(
        `UPDATE counsel_partners
         SET full_name = ?,
             partner_type_code = ?,
             email = ?,
             phone = ?,
             specialization_text = ?,
             primary_jurisdiction = ?,
             city = ?,
             state = ?,
             country_code = ?,
             partner_status_code = ?,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [
          next.name,
          existing.type,
          next.email || '',
          next.phone || '',
          next.specialization,
          next.specialization || next.state || next.country || 'Not specified',
          next.city || '',
          next.state || '',
          next.country || 'IN',
          next.active ? 'active' : 'inactive',
          existing.dbId,
        ],
        connection
      );

      await createAuditEvent(
        {
          actionCode: 'counsel.updated',
          actionLabel: existing.type === 'field_partner' ? 'Field partner updated' : 'External counsel updated',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', oldValue: current.name, newValue: next.name },
            { fieldName: 'active', oldValue: current.active, newValue: next.active },
          ],
          entityPk: existing.dbId,
          entityTableName: 'counsel_partners',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    }

    return {
      active: next.active ?? true,
      assignmentCount: current.assignmentCount,
      city: next.city || '',
      country: next.country || 'IN',
      email: next.email || '',
      id: memberId,
      name: next.name,
      phone: next.phone || '',
      specialization: next.specialization || '',
      state: next.state || '',
      type: existing.type,
    };
  });
};

export const archiveTeamMember = async (actor: AdminActor, memberId: string) => {
  return withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);

    if (existing.type === 'internal_staff') {
      if (existing.dbId === actor.userId) {
        throw badRequest('cannot_archive_self', 'You cannot archive your own staff registry entry.');
      }

      await executeStatement(
        `UPDATE staff_profiles
         SET employment_status_code = 'archived'
         WHERE user_id = ?`,
        [existing.dbId],
        connection
      );
      await createAuditEvent(
        {
          actionCode: 'staff.archived',
          actionLabel: 'Internal coordination staff archived',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          entityPk: existing.dbId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    } else {
      await executeStatement(
        `UPDATE counsel_partners
         SET archived_at = COALESCE(archived_at, UTC_TIMESTAMP(6)),
             partner_status_code = 'inactive',
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [existing.dbId],
        connection
      );
      await createAuditEvent(
        {
          actionCode: 'counsel.archived',
          actionLabel: existing.type === 'field_partner' ? 'Field partner archived' : 'External counsel archived',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          entityPk: existing.dbId,
          entityTableName: 'counsel_partners',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    }

    return { id: memberId, status: 'archived' as const };
  });
};
