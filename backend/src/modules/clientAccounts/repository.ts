import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import {
  createNumericCode,
  hashOneTimeCode,
  hashPassword,
  verifyPassword,
} from '../../lib/authCrypto.js';
import { nowUtc, toMysqlDateTime } from '../../lib/datetime.js';
import { createPublicId } from '../../lib/ids.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/httpErrors.js';
import { selectOne, withConnection, withTransaction } from '../../lib/mysqlUtils.js';
import { getRequestContext } from '../../lib/observability.js';
import { recordSecurityEvent } from '../../lib/securityEvents.js';
import { validateAddressForStorage } from '../../lib/addressValidation.js';
import { emailAuthProvider } from '../auth/providers/email.js';
import { assertStrongClientPassword } from '../auth/passwordPolicy.js';
import { smsAuthProvider } from '../auth/providers/sms.js';
import { ensurePlatformReady } from '../platform/bootstrap.js';
import type { NotificationPreferences } from './types.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './types.js';

interface PortalUserContextRow extends RowDataPacket {
  client_account_id: number;
  display_name: string;
  email: string;
  phone: string | null;
  user_id: number;
}

interface PreferencesRow extends RowDataPacket {
  case_activity_alerts: number;
  email_updates: number;
  in_app_alerts: number;
  invoice_reminders: number;
  product_announcements: number;
  sms_alerts: number;
}

interface AccountSettingsRow extends RowDataPacket {
  address_city: string | null;
  address_country_code: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_postal_code: string | null;
  address_source_code: string | null;
  address_state: string | null;
  address_validation_status_code: string | null;
  display_name: string;
  email: string;
  email_verified_at: string | null;
  mobile_number: string | null;
  phone: string | null;
  phone_verified_at: string | null;
}

interface CredentialRow extends RowDataPacket {
  password_hash: string | null;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface EmailTokenRow extends RowDataPacket {
  code_hash: string;
  email_snapshot: string | null;
  expires_at: string;
  id: number;
}

interface PhoneTokenRow extends RowDataPacket {
  code_hash: string | null;
  expires_at: string;
  id: number;
  phone_snapshot: string;
  provider_code: 'preview' | 'twilio-verify' | null;
  provider_reference: string | null;
}

const toPreferences = (row?: PreferencesRow | null): NotificationPreferences => {
  if (!row) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  return {
    caseActivityAlerts: Boolean(row.case_activity_alerts),
    emailUpdates: Boolean(row.email_updates),
    inAppAlerts: row.in_app_alerts === undefined ? true : Boolean(row.in_app_alerts),
    invoiceReminders: Boolean(row.invoice_reminders),
    productAnnouncements: Boolean(row.product_announcements),
    smsAlerts: Boolean(row.sms_alerts),
  };
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/\s+/g, ' ').trim();
const normalizeAddressField = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeCountryCode = (value: string) => {
  const trimmed = normalizeAddressField(value);
  if (!trimmed) {
    return '';
  }

  const uppercase = trimmed.toUpperCase();
  if (/^[A-Z]{2,3}$/.test(uppercase)) {
    return uppercase;
  }

  return uppercase.length <= 16 ? uppercase : 'ZZ';
};

const normalizePrimaryAddress = (payload: {
  city: string;
  country: string;
  googlePlaceId?: string | null;
  line1: string;
  line2?: string | null;
  postalCode: string;
  sourceCode?: 'google' | 'ip_prefill' | 'manual';
  state: string;
  validationStatusCode?: 'manual' | 'unverified' | 'verified';
}) => ({
  city: normalizeAddressField(payload.city),
  countryCode: normalizeCountryCode(payload.country),
  googlePlaceId: payload.googlePlaceId ? normalizeAddressField(payload.googlePlaceId) : null,
  line1: normalizeAddressField(payload.line1),
  line2: payload.line2 ? normalizeAddressField(payload.line2) : '',
  postalCode: normalizeAddressField(payload.postalCode),
  sourceCode: payload.sourceCode || 'manual',
  state: normalizeAddressField(payload.state),
  validationStatusCode: payload.validationStatusCode || (payload.sourceCode === 'google' ? 'unverified' : 'manual'),
});

const assertEmailFormat = (value: string) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw badRequest('invalid_email', 'Enter a valid email address.');
  }
};

const assertPhoneFormat = (value: string) => {
  if (value.trim().length < 8 || value.trim().length > 40) {
    throw badRequest('invalid_phone', 'Enter a valid phone number.');
  }
};

const assertPrimaryAddress = (payload: ReturnType<typeof normalizePrimaryAddress>) => {
  if (
    payload.line1.length < 3 ||
    payload.city.length < 2 ||
    payload.state.length < 2 ||
    payload.postalCode.length < 3 ||
    payload.countryCode.length < 2
  ) {
    throw badRequest('invalid_address', 'Enter a complete billing address.');
  }
};

export class ClientAccountsRepository {
  public constructor(private readonly pool: Pool) {}

  public async initialize() {
    await ensurePlatformReady();
  }

  private async resolvePortalUserContext(
    connection: PoolConnection,
    userPublicId: string
  ) {
    const row = await selectOne<PortalUserContextRow>(
      connection,
      `SELECT
         u.id AS user_id,
         u.display_name,
         u.email,
         u.phone,
         cac.client_account_id
       FROM users u
       INNER JOIN client_account_contacts cac
         ON cac.user_id = u.id
         AND cac.portal_access_enabled = 1
         AND cac.archived_at IS NULL
       WHERE u.public_id = ?
         AND u.archived_at IS NULL
       LIMIT 1`,
      [userPublicId]
    );

    if (!row) {
      throw notFound('portal_user_not_found', 'Portal user could not be resolved.');
    }

    return row;
  }

  private async readAccountSettings(connection: PoolConnection, userPublicId: string) {
    const context = await this.resolvePortalUserContext(connection, userPublicId);
    const row = await selectOne<AccountSettingsRow>(
      connection,
      `SELECT
         u.display_name,
         u.email,
         u.phone,
         u.email_verified_at,
         u.phone_verified_at,
         cac.mobile_number,
         addr.line1 AS address_line1,
         addr.line2 AS address_line2,
         addr.city AS address_city,
         addr.state AS address_state,
         addr.postal_code AS address_postal_code,
         addr.country_code AS address_country_code,
         addr.source_code AS address_source_code,
         addr.validation_status_code AS address_validation_status_code
       FROM users u
       INNER JOIN client_account_contacts cac
         ON cac.user_id = u.id
        AND cac.client_account_id = ?
        AND cac.archived_at IS NULL
       LEFT JOIN client_addresses addr
         ON addr.client_account_id = cac.client_account_id
         AND addr.is_primary = 1
         AND addr.archived_at IS NULL
       WHERE u.id = ?
       LIMIT 1`,
      [context.client_account_id, context.user_id]
    );

    if (!row) {
      throw notFound('portal_user_not_found', 'Portal user could not be resolved.');
    }

    return {
      account: {
        address: {
          city: row.address_city || '',
          countryCode: row.address_country_code || '',
          line1: row.address_line1 || '',
          line2: row.address_line2 || '',
          postalCode: row.address_postal_code || '',
          sourceCode: row.address_source_code || 'manual',
          state: row.address_state || '',
          validationStatusCode: row.address_validation_status_code || 'manual',
        },
        email: row.email,
        emailVerified: Boolean(row.email_verified_at),
        mobileNumber: row.mobile_number || row.phone || '',
        name: row.display_name,
        phone: row.phone || '',
        phoneVerified: Boolean(row.phone_verified_at),
      },
      deliveryAvailability: {
        email: env.EMAIL_PROVIDER_MODE === 'disabled' ? 'unavailable' : 'available',
        portal: 'available' as const,
        sms: env.SMS_PROVIDER_MODE === 'disabled' ? 'unavailable' : 'available',
      },
    };
  }

  public async getNotificationPreferences(userPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const row = await selectOne<PreferencesRow>(
        connection,
        `SELECT
           in_app_alerts,
           email_updates,
           sms_alerts,
           invoice_reminders,
           case_activity_alerts,
           product_announcements
         FROM user_notification_preferences
         WHERE user_id = ?
         LIMIT 1`,
        [context.user_id]
      );

      return toPreferences(row);
    });
  }

  public async updateNotificationPreferences(
    userPublicId: string,
    preferences: NotificationPreferences
  ) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const timestamp = toMysqlDateTime(nowUtc());
      const requestContext = getRequestContext();

      await connection.execute(
        `INSERT INTO user_notification_preferences (
          user_id,
          in_app_alerts,
          email_updates,
          sms_alerts,
          invoice_reminders,
          case_activity_alerts,
          product_announcements,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          in_app_alerts = VALUES(in_app_alerts),
          email_updates = VALUES(email_updates),
          sms_alerts = VALUES(sms_alerts),
          invoice_reminders = VALUES(invoice_reminders),
          case_activity_alerts = VALUES(case_activity_alerts),
          product_announcements = VALUES(product_announcements),
          updated_at = VALUES(updated_at)`,
        [
          context.user_id,
          preferences.inAppAlerts ? 1 : 0,
          preferences.emailUpdates ? 1 : 0,
          preferences.smsAlerts ? 1 : 0,
          preferences.invoiceReminders ? 1 : 0,
          preferences.caseActivityAlerts ? 1 : 0,
          preferences.productAnnouncements ? 1 : 0,
          timestamp,
        ]
      );

      await connection.execute(
        `INSERT INTO audit_events (
          public_id,
          actor_user_id,
          actor_role_code_snapshot,
          entity_table_name,
          entity_pk,
          action_code,
          action_label,
          source_module,
          request_correlation_id,
          ip_address,
          user_agent,
          summary_old_value,
          summary_new_value,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createPublicId(),
          context.user_id,
          'client',
          'user_notification_preferences',
          context.user_id,
          'preferences_updated',
          'Notification preferences updated',
          'Client Settings',
          requestContext?.requestId ?? null,
          requestContext?.ipAddress ?? null,
          requestContext?.userAgent ?? null,
          null,
          JSON.stringify(preferences),
          timestamp,
        ]
      );

      return preferences;
    });
  }

  public async getAccountSettings(userPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) => this.readAccountSettings(connection, userPublicId));
  }

  public async updatePrimaryAddress(
    userPublicId: string,
    payload: {
      city: string;
      country: string;
      line1: string;
      line2?: string | null;
      postalCode: string;
      sourceCode?: 'google' | 'ip_prefill' | 'manual';
      state: string;
      googlePlaceId?: string | null;
      validationStatusCode?: 'manual' | 'unverified' | 'verified';
    }
  ) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const address = normalizePrimaryAddress(await validateAddressForStorage(payload));
      assertPrimaryAddress(address);
      const timestamp = toMysqlDateTime(nowUtc());

      const existingPrimary = await selectOne<IdRow>(
        connection,
        `SELECT id
         FROM client_addresses
         WHERE client_account_id = ?
           AND is_primary = 1
           AND archived_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [context.client_account_id]
      );

      if (existingPrimary?.id) {
        await connection.execute(
          `UPDATE client_addresses
           SET address_type_code = 'primary',
               line1 = ?,
               line2 = ?,
               city = ?,
               state = ?,
               postal_code = ?,
               country_code = ?,
               source_code = ?,
               google_place_id = ?,
               validation_status_code = ?,
               is_primary = 1,
               updated_at = ?,
               archived_at = NULL
           WHERE id = ?`,
          [
            address.line1,
            address.line2 || null,
            address.city,
            address.state,
            address.postalCode,
            address.countryCode,
            address.sourceCode,
            address.googlePlaceId,
            address.validationStatusCode,
            timestamp,
            existingPrimary.id,
          ]
        );

        await connection.execute(
          `UPDATE client_addresses
           SET is_primary = 0,
               archived_at = ?,
               updated_at = ?
           WHERE client_account_id = ?
             AND archived_at IS NULL
             AND is_primary = 1
             AND id <> ?`,
          [timestamp, timestamp, context.client_account_id, existingPrimary.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO client_addresses (
            client_account_id,
            address_type_code,
            line1,
            line2,
            city,
            state,
            postal_code,
            country_code,
            source_code,
            google_place_id,
            validation_status_code,
            is_primary,
            created_at,
            updated_at
          ) VALUES (?, 'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            context.client_account_id,
            address.line1,
            address.line2 || null,
            address.city,
            address.state,
            address.postalCode,
            address.countryCode,
            address.sourceCode,
            address.googlePlaceId,
            address.validationStatusCode,
            timestamp,
            timestamp,
          ]
        );
      }

      await this.insertAuditEvent(
        connection,
        context.user_id,
        'client.address_updated',
        'Client billing address updated',
        {
          city: address.city,
          countryCode: address.countryCode,
          postalCode: address.postalCode,
          sourceCode: address.sourceCode,
          state: address.state,
          validationStatusCode: address.validationStatusCode,
        }
      );
      await recordSecurityEvent(
        {
          eventTypeCode: 'client.address_updated',
          success: true,
          userId: context.user_id,
        },
        connection
      );

      return this.readAccountSettings(connection, userPublicId);
    });
  }

  public async updateDisplayName(userPublicId: string, payload: { name: string }) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const normalizedName = payload.name.replace(/\s+/g, ' ').trim();

      if (normalizedName.length < 2 || normalizedName.length > 160) {
        throw badRequest('invalid_display_name', 'Name must be between 2 and 160 characters.');
      }

      const [firstName = normalizedName, ...restName] = normalizedName.split(' ');
      const lastName = restName.join(' ') || null;
      const timestamp = toMysqlDateTime(nowUtc());

      await connection.execute(
        `UPDATE users
         SET display_name = ?,
             first_name = ?,
             last_name = ?,
             updated_at = ?
         WHERE id = ?`,
        [normalizedName, firstName, lastName, timestamp, context.user_id]
      );

      await this.insertAuditEvent(
        connection,
        context.user_id,
        'client.name_updated',
        'Client account name updated',
        { name: normalizedName }
      );

      return this.readAccountSettings(connection, userPublicId);
    });
  }

  public async changePassword(
    userPublicId: string,
    payload: { currentPassword: string; newPassword: string }
  ) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      assertStrongClientPassword(payload.newPassword, {
        email: context.email,
        fullName: context.display_name,
      });

      const credential = await selectOne<CredentialRow>(
        connection,
        `SELECT password_hash
         FROM user_credentials
         WHERE user_id = ?
         LIMIT 1`,
        [context.user_id]
      );

      if (!credential?.password_hash) {
        throw badRequest('password_not_configured', 'This account does not currently have a password.');
      }

      const currentMatches = await verifyPassword(payload.currentPassword, credential.password_hash);
      if (!currentMatches) {
        throw unauthorized('invalid_current_password', 'Current password is incorrect.');
      }

      await connection.execute(
        `UPDATE user_credentials
         SET password_hash = ?,
             password_algo = 'scrypt',
             password_changed_at = ?,
             must_rotate_password = 0
         WHERE user_id = ?`,
        [await hashPassword(payload.newPassword), toMysqlDateTime(nowUtc()), context.user_id]
      );

      await this.insertAuditEvent(connection, context.user_id, 'client.password_changed', 'Client password changed');
      await recordSecurityEvent(
        {
          eventTypeCode: 'client.password_changed',
          success: true,
          userId: context.user_id,
        },
        connection
      );

      return { status: 'updated' as const };
    });
  }

  public async requestEmailChange(userPublicId: string, nextEmail: string) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const email = normalizeEmail(nextEmail);
      assertEmailFormat(email);

      const duplicate = await selectOne<IdRow>(
        connection,
        `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1`,
        [email, context.user_id]
      );

      if (duplicate) {
        throw conflict('email_already_exists', 'This email is already used by another account.');
      }

      const code = createNumericCode();
      const timestamp = toMysqlDateTime(nowUtc());
      const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_MINUTES * 60_000).toISOString();
      const delivery = await emailAuthProvider.sendCode({
        code,
        purpose: 'email_verification',
        recipientEmail: email,
        recipientName: context.display_name,
      });

      await connection.execute(
        `UPDATE email_verification_tokens
         SET consumed_at = UTC_TIMESTAMP(6)
         WHERE user_id = ?
           AND purpose_code = 'email_change'
           AND consumed_at IS NULL`,
        [context.user_id]
      );

      await connection.execute(
        `INSERT INTO email_verification_tokens (
          public_id,
          user_id,
          email_snapshot,
          purpose_code,
          code_hash,
          expires_at,
          sent_at,
          attempt_count,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'email_change', ?, ?, ?, 0, ?, ?)`,
        [
          createPublicId(),
          context.user_id,
          email,
          hashOneTimeCode(code, env.AUTH_SESSION_SECRET),
          toMysqlDateTime(expiresAt),
          timestamp,
          timestamp,
          timestamp,
        ]
      );

      await this.insertAuditEvent(connection, context.user_id, 'client.email_change_requested', 'Client email change requested', {
        nextEmail: email,
      });

      return {
        deliveryHint: delivery.deliveryHint,
        deliveryStatus: 'verification_required' as const,
        email,
        status: 'verification_required' as const,
      };
    });
  }

  public async confirmEmailChange(userPublicId: string, payload: { code: string; email: string }) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const email = normalizeEmail(payload.email);
      const token = await selectOne<EmailTokenRow>(
        connection,
        `SELECT id, email_snapshot, code_hash, expires_at
         FROM email_verification_tokens
         WHERE user_id = ?
           AND purpose_code = 'email_change'
           AND consumed_at IS NULL
         ORDER BY sent_at DESC
         LIMIT 1
         FOR UPDATE`,
        [context.user_id]
      );

      if (!token || normalizeEmail(token.email_snapshot || '') !== email) {
        throw unauthorized('email_change_not_pending', 'Email change verification is not pending.');
      }
      if (new Date(token.expires_at).getTime() <= Date.now()) {
        throw unauthorized('email_change_expired', 'Email change verification code expired.');
      }
      if (hashOneTimeCode(payload.code.trim(), env.AUTH_SESSION_SECRET) !== token.code_hash) {
        throw unauthorized('invalid_email_change_code', 'Email change verification code is invalid.');
      }

      const duplicate = await selectOne<IdRow>(
        connection,
        `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1`,
        [email, context.user_id]
      );

      if (duplicate) {
        throw conflict('email_already_exists', 'This email is already used by another account.');
      }

      const timestamp = toMysqlDateTime(nowUtc());
      await connection.execute(
        `UPDATE users
         SET email = ?,
             email_verified_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [email, timestamp, timestamp, context.user_id]
      );
      await connection.execute(
        `UPDATE client_accounts
         SET primary_email = ?,
             updated_at = ?
         WHERE id = ?`,
        [email, timestamp, context.client_account_id]
      );
      await connection.execute(
        `UPDATE email_verification_tokens
         SET consumed_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, token.id]
      );

      await this.insertAuditEvent(connection, context.user_id, 'client.email_changed', 'Client email changed', {
        nextEmail: email,
      });

      return this.readAccountSettings(connection, userPublicId);
    });
  }

  public async requestPhoneChange(userPublicId: string, nextPhone: string) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const phone = normalizePhone(nextPhone);
      assertPhoneFormat(phone);

      const duplicate = await selectOne<IdRow>(
        connection,
        `SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1`,
        [phone, context.user_id]
      );

      if (duplicate) {
        throw conflict('phone_already_exists', 'This phone number is already used by another account.');
      }

      const timestamp = toMysqlDateTime(nowUtc());
      const expiresAt = new Date(Date.now() + env.PHONE_OTP_TTL_MINUTES * 60_000).toISOString();
      const code = env.SMS_PROVIDER_MODE === 'twilio-verify' ? undefined : createNumericCode();
      const delivery = await smsAuthProvider.sendCode({
        code,
        purpose: 'phone_verification',
        recipientPhone: phone,
      });

      await connection.execute(
        `UPDATE phone_verification_tokens
         SET consumed_at = UTC_TIMESTAMP(6)
         WHERE user_id = ?
           AND purpose_code = 'phone_change'
           AND consumed_at IS NULL`,
        [context.user_id]
      );

      await connection.execute(
        `INSERT INTO phone_verification_tokens (
          public_id,
          user_id,
          phone_snapshot,
          purpose_code,
          provider_code,
          provider_reference,
          code_hash,
          expires_at,
          sent_at,
          attempt_count,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'phone_change', ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          createPublicId(),
          context.user_id,
          phone,
          env.SMS_PROVIDER_MODE === 'twilio' ? 'twilio' : env.SMS_PROVIDER_MODE === 'preview' ? 'preview' : 'twilio-verify',
          delivery.providerReference || null,
          code ? hashOneTimeCode(code, env.AUTH_SESSION_SECRET) : null,
          toMysqlDateTime(expiresAt),
          timestamp,
          timestamp,
          timestamp,
        ]
      );

      await this.insertAuditEvent(connection, context.user_id, 'client.phone_change_requested', 'Client phone change requested');

      return {
        deliveryHint: delivery.deliveryHint,
        deliveryStatus: 'verification_required' as const,
        phone,
        status: 'verification_required' as const,
      };
    });
  }

  public async confirmPhoneChange(userPublicId: string, payload: { code: string; phone: string }) {
    await this.initialize();

    return withTransaction(this.pool, async (connection) => {
      const context = await this.resolvePortalUserContext(connection, userPublicId);
      const phone = normalizePhone(payload.phone);
      const token = await selectOne<PhoneTokenRow>(
        connection,
        `SELECT id, phone_snapshot, provider_code, provider_reference, code_hash, expires_at
         FROM phone_verification_tokens
         WHERE user_id = ?
           AND purpose_code = 'phone_change'
           AND consumed_at IS NULL
         ORDER BY sent_at DESC
         LIMIT 1
         FOR UPDATE`,
        [context.user_id]
      );

      if (!token || normalizePhone(token.phone_snapshot) !== phone) {
        throw unauthorized('phone_change_not_pending', 'Phone change verification is not pending.');
      }
      if (new Date(token.expires_at).getTime() <= Date.now()) {
        throw unauthorized('phone_change_expired', 'Phone change verification code expired.');
      }

      if (token.provider_code === 'twilio-verify') {
        const verification = await smsAuthProvider.verifyCode({
          code: payload.code.trim(),
          purpose: 'phone_verification',
          providerReference: token.provider_reference || undefined,
          recipientPhone: phone,
        });
        if (!verification.approved) {
          throw unauthorized('invalid_phone_change_code', 'Phone verification code is invalid.');
        }
      } else if (!token.code_hash || hashOneTimeCode(payload.code.trim(), env.AUTH_SESSION_SECRET) !== token.code_hash) {
        throw unauthorized('invalid_phone_change_code', 'Phone verification code is invalid.');
      }

      const duplicate = await selectOne<IdRow>(
        connection,
        `SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1`,
        [phone, context.user_id]
      );

      if (duplicate) {
        throw conflict('phone_already_exists', 'This phone number is already used by another account.');
      }

      const timestamp = toMysqlDateTime(nowUtc());
      await connection.execute(
        `UPDATE users
         SET phone = ?,
             phone_verified_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [phone, timestamp, timestamp, context.user_id]
      );
      await connection.execute(
        `UPDATE client_accounts
         SET primary_phone = ?,
             updated_at = ?
         WHERE id = ?`,
        [phone, timestamp, context.client_account_id]
      );
      await connection.execute(
        `UPDATE client_account_contacts
         SET mobile_number = ?,
             updated_at = ?
         WHERE client_account_id = ?
           AND user_id = ?
           AND archived_at IS NULL`,
        [phone, timestamp, context.client_account_id, context.user_id]
      );
      await connection.execute(
        `UPDATE phone_verification_tokens
         SET consumed_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, token.id]
      );

      await this.insertAuditEvent(connection, context.user_id, 'client.phone_changed', 'Client phone changed');

      return this.readAccountSettings(connection, userPublicId);
    });
  }

  private async insertAuditEvent(
    connection: PoolConnection,
    userId: number,
    actionCode: string,
    actionLabel: string,
    summary?: unknown
  ) {
    const timestamp = toMysqlDateTime(nowUtc());
    const requestContext = getRequestContext();
    await connection.execute(
      `INSERT INTO audit_events (
        public_id,
        actor_user_id,
        actor_role_code_snapshot,
        entity_table_name,
        entity_pk,
        action_code,
        action_label,
        source_module,
        request_correlation_id,
        ip_address,
        user_agent,
        summary_old_value,
        summary_new_value,
        occurred_at
      ) VALUES (?, ?, 'client', 'users', ?, ?, ?, 'Client Settings', ?, ?, ?, NULL, ?, ?)`,
      [
        createPublicId(),
        userId,
        userId,
        actionCode,
        actionLabel,
        requestContext?.requestId ?? null,
        requestContext?.ipAddress ?? null,
        requestContext?.userAgent ?? null,
        summary ? JSON.stringify(summary) : null,
        timestamp,
      ]
    );
  }
}
