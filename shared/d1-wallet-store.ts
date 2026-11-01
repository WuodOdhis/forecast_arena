import type { D1Database } from '@cloudflare/workers-types';
import type { WalletAuthStore, WalletChallenge, WalletSession } from './wallet-auth.js';

export function createD1WalletAuthStore(db: D1Database): WalletAuthStore {
  return {
    async issueChallenge(challenge, limit, windowStart) {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO users (wallet_address, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT(wallet_address) DO UPDATE SET
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
          )
          .bind(challenge.address, challenge.issuedAt, challenge.issuedAt),
        db
          .prepare(
            `DELETE FROM wallet_auth_attempts
             WHERE created_at < ?`,
          )
          .bind(windowStart),
        db
          .prepare(
            `DELETE FROM wallet_challenges
             WHERE expires_at <= ?`,
          )
          .bind(challenge.issuedAt),
        db
          .prepare(
            `INSERT INTO wallet_auth_attempts (nonce_hash, wallet_address, created_at)
             SELECT ?, ?, ?
             WHERE (SELECT COUNT(*) FROM wallet_auth_attempts
                    WHERE wallet_address = ? AND created_at >= ?) < ?
             RETURNING nonce_hash`,
          )
          .bind(
            challenge.nonceHash,
            challenge.address,
            challenge.issuedAt,
            challenge.address,
            windowStart,
            limit,
          ),
        db
          .prepare(
            `INSERT INTO wallet_challenges
               (nonce_hash, wallet_address, origin, chain_id, issued_at, expires_at, message)
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM wallet_auth_attempts WHERE nonce_hash = ?
             )`,
          )
          .bind(
            challenge.nonceHash,
            challenge.address,
            challenge.origin,
            challenge.chainId,
            challenge.issuedAt,
            challenge.expiresAt,
            challenge.message,
            challenge.nonceHash,
          ),
      ]);
      return results[3]?.meta.changes === 1 && results[4]?.meta.changes === 1;
    },

    async findChallenge(nonceHash) {
      const row = await db
        .prepare(
          `SELECT nonce_hash AS nonceHash, wallet_address AS address, origin,
                  chain_id AS chainId, message,
                  issued_at AS issuedAt, expires_at AS expiresAt
           FROM wallet_challenges WHERE nonce_hash = ?`,
        )
        .bind(nonceHash)
        .first<WalletChallenge>();
      return row ?? undefined;
    },

    async completeLogin(nonceHash, address, now, session) {
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM wallet_sessions WHERE expires_at <= ?`,
          )
          .bind(now),
        db
          .prepare(
            `DELETE FROM wallet_challenges
             WHERE nonce_hash = ? AND wallet_address = ? AND expires_at > ?`,
          )
          .bind(nonceHash, address, now),
        db
          .prepare(
            `INSERT INTO wallet_sessions
               (token_hash, wallet_address, created_at, expires_at, revoked_at)
             SELECT ?, ?, ?, ?, NULL WHERE changes() > 0`,
          )
          .bind(session.tokenHash, session.address, session.createdAt, session.expiresAt),
      ]);
      return results[1]?.meta.changes === 1 && results[2]?.meta.changes === 1;
    },

    async getSession(tokenHash, now) {
      const row = await db
        .prepare(
          `SELECT s.token_hash AS tokenHash, s.wallet_address AS address,
                  s.created_at AS createdAt, s.expires_at AS expiresAt
           FROM wallet_sessions s
           JOIN users u ON u.wallet_address = s.wallet_address
           WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
             AND u.deleted_at IS NULL`,
        )
        .bind(tokenHash, now)
        .first<WalletSession>();
      if (!row)
        await db.prepare('DELETE FROM wallet_sessions WHERE token_hash = ?').bind(tokenHash).run();
      return row ?? undefined;
    },

    async deleteSession(tokenHash) {
      await db
        .prepare('UPDATE wallet_sessions SET revoked_at = ? WHERE token_hash = ?')
        .bind(Date.now(), tokenHash)
        .run();
    },
  };
}
