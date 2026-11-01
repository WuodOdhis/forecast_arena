import type { D1Database } from '@cloudflare/workers-types';

export interface AccountExport {
  exportedAt: string;
  account: {
    walletAddress: string;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
  };
  createdRounds: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  auditRecords: Record<string, unknown>[];
}

export function createD1AccountStore(db: D1Database) {
  return {
    async export(address: string): Promise<AccountExport | undefined> {
      const account = await db
        .prepare(
          `SELECT wallet_address AS walletAddress, created_at AS createdAt,
                  updated_at AS updatedAt, deleted_at AS deletedAt
           FROM users WHERE wallet_address = ?`,
        )
        .bind(address)
        .first<AccountExport['account']>();
      if (!account) return undefined;
      const [createdRounds, predictions, auditRecords] = await Promise.all([
        db
          .prepare(
            `SELECT r.*, u.create_tx_hash AS createTxHash,
                    u.created_at AS indexedAt, u.title, u.rules_json AS rulesJson,
                    u.block_number AS creationBlock, u.block_hash AS creationBlockHash
             FROM user_created_rounds u
             JOIN rounds r ON r.id = u.round_id
             WHERE u.creator_address = ?
             ORDER BY u.created_at DESC`,
          )
          .bind(address)
          .all<Record<string, unknown>>(),
        db
          .prepare(
            `SELECT p.*, r.chain_id AS chainId, r.contract_address AS contractAddress,
                    r.chain_round_id AS chainRoundId
             FROM predictions p
             JOIN rounds r ON r.id = p.round_id
             WHERE p.wallet_address = ?
             ORDER BY p.created_at DESC`,
          )
          .bind(address)
          .all<Record<string, unknown>>(),
        db
          .prepare(
            `SELECT action, resource_id AS resourceId, outcome, detail_json AS detailJson,
                    request_id AS requestId, created_at AS createdAt
             FROM audit_records WHERE wallet_address = ?
             ORDER BY created_at DESC`,
          )
          .bind(address)
          .all<Record<string, unknown>>(),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        account,
        createdRounds: createdRounds.results,
        predictions: predictions.results,
        auditRecords: auditRecords.results,
      };
    },

    async delete(address: string, now = Date.now()): Promise<boolean> {
      const account = await db
        .prepare('SELECT wallet_address FROM users WHERE wallet_address = ?')
        .bind(address)
        .first<{ wallet_address: string }>();
      if (!account) return false;
      await db.batch([
        db
          .prepare(
            'UPDATE users SET updated_at = ?, deleted_at = ? WHERE wallet_address = ?',
          )
          .bind(now, now, address),
        db.prepare('DELETE FROM wallet_challenges WHERE wallet_address = ?').bind(address),
        db.prepare('DELETE FROM wallet_auth_attempts WHERE wallet_address = ?').bind(address),
        db
          .prepare(
            'UPDATE wallet_sessions SET revoked_at = ? WHERE wallet_address = ? AND revoked_at IS NULL',
          )
          .bind(now, address),
        db.prepare('DELETE FROM audit_records WHERE wallet_address = ?').bind(address),
      ]);
      return true;
    },
  };
}
