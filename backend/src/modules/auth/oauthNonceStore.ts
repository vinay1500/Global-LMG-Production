import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { createRandomToken, hashOpaqueValue } from '../../lib/authCrypto.js';
import { unauthorized } from '../../lib/httpErrors.js';
import { createPublicId } from '../../lib/ids.js';
import { getMysqlPool } from '../../lib/mysql.js';
import { selectOne, withTransaction } from '../../lib/mysqlUtils.js';

const GOOGLE_NONCE_TTL_MINUTES = 5;
const GOOGLE_PROVIDER_CODE = 'google';
const GOOGLE_NONCE_PURPOSE = 'sign_in';

type OAuthNonceRow = RowDataPacket & {
  consumed_at: Date | string | null;
  expires_at: Date | string;
  id: number;
};

const toMysqlDateTime = (date: Date) => date.toISOString().slice(0, 23).replace('T', ' ');

const parseMysqlDateTime = (value: Date | string) => {
  if (value instanceof Date) {
    return value;
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
};

export const hashOAuthNonce = (nonce: string) =>
  hashOpaqueValue(nonce.trim(), env.AUTH_SESSION_SECRET);

export const isOAuthNonceRowUsable = (row: OAuthNonceRow, nowMs = Date.now()) => {
  if (row.consumed_at) {
    return false;
  }

  return parseMysqlDateTime(row.expires_at).getTime() > nowMs;
};

export const issueGoogleOAuthNonce = async () => {
  const nonce = createRandomToken(24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GOOGLE_NONCE_TTL_MINUTES * 60_000);

  await getMysqlPool().execute(
    `INSERT INTO oauth_nonces (
       public_id,
       provider_code,
       purpose_code,
       nonce_hash,
       expires_at,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      createPublicId(),
      GOOGLE_PROVIDER_CODE,
      GOOGLE_NONCE_PURPOSE,
      hashOAuthNonce(nonce),
      toMysqlDateTime(expiresAt),
      toMysqlDateTime(now),
      toMysqlDateTime(now),
    ]
  );

  return {
    expiresAt: expiresAt.toISOString(),
    nonce,
  };
};

export const consumeGoogleOAuthNonce = async (nonce: string | undefined) => {
  const normalizedNonce = nonce?.trim();

  if (!normalizedNonce) {
    throw unauthorized('google_nonce_required', 'Google sign-in expired. Please try again.');
  }

  const nonceHash = hashOAuthNonce(normalizedNonce);

  await withTransaction(getMysqlPool(), async (connection) => {
    const row = await selectOne<OAuthNonceRow>(
      connection,
      `SELECT id, expires_at, consumed_at
       FROM oauth_nonces
       WHERE provider_code = ?
         AND nonce_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [GOOGLE_PROVIDER_CODE, nonceHash]
    );

    if (!row || !isOAuthNonceRowUsable(row)) {
      throw unauthorized('google_nonce_invalid', 'Google sign-in expired. Please try again.');
    }

    await connection.execute(
      `UPDATE oauth_nonces
       SET consumed_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [row.id]
    );
  });
};
