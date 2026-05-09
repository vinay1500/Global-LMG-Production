import type { Pool, RowDataPacket } from 'mysql2/promise';
import { notFound } from '../../lib/httpErrors.js';
import { selectAll, selectOne, withConnection } from '../../lib/mysqlUtils.js';
import { ensurePlatformReady } from '../platform/bootstrap.js';
import type { AuthenticatedActor } from './types.js';

interface ActorRow extends RowDataPacket {
  actor_type_code: string;
  client_account_id: number | null;
  display_name: string;
  email: string;
  public_id: string;
  user_id: number;
}

interface RoleRow extends RowDataPacket {
  role_code: string;
}

interface PermissionRow extends RowDataPacket {
  permission_code: string;
}

export class AccessRepository {
  public constructor(private readonly pool: Pool) {}

  public async initialize() {
    await ensurePlatformReady();
  }

  public async getActorByPublicId(userPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) => {
      const actor = await selectOne<ActorRow>(
        connection,
        `SELECT
           u.id AS user_id,
           u.public_id,
           u.display_name,
           u.email,
           u.actor_type_code,
           ca.id AS client_account_id
         FROM users u
         LEFT JOIN client_account_contacts cac
           ON cac.user_id = u.id
           AND cac.portal_access_enabled = 1
           AND cac.archived_at IS NULL
         LEFT JOIN client_accounts ca
           ON ca.id = cac.client_account_id
          AND ca.archived_at IS NULL
         WHERE u.public_id = ?
           AND u.login_enabled = 1
           AND u.archived_at IS NULL
         LIMIT 1`,
        [userPublicId]
      );

      if (!actor) {
        throw notFound('actor_not_found', 'Authenticated actor could not be resolved.');
      }

      const roles = await selectAll<RoleRow>(
        connection,
        `SELECT ur.role_code
         FROM user_roles ur
         WHERE ur.user_id = ?
           AND ur.is_active = 1
           AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
           AND (ur.ends_at IS NULL OR ur.ends_at > UTC_TIMESTAMP(6))`,
        [actor.user_id]
      );

      const permissions = await selectAll<PermissionRow>(
        connection,
        `SELECT DISTINCT rp.permission_code
         FROM user_roles ur
         INNER JOIN role_permissions rp
           ON rp.role_code = ur.role_code
         WHERE ur.user_id = ?
           AND ur.is_active = 1
           AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
           AND (ur.ends_at IS NULL OR ur.ends_at > UTC_TIMESTAMP(6))`,
        [actor.user_id]
      );

      return {
        actorTypeCode: actor.actor_type_code,
        clientAccountId: actor.client_account_id,
        displayName: actor.display_name,
        email: actor.email,
        permissionCodes: permissions.map((entry) => entry.permission_code),
        publicId: actor.public_id,
        roleCodes: roles.map((entry) => entry.role_code),
        userId: actor.user_id,
      } satisfies AuthenticatedActor;
    });
  }
}
