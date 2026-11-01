import type { D1Database } from '@cloudflare/workers-types';
import type { Round } from './domain.js';

export interface IndexedRoundCreated {
  chainId: number;
  contractAddress: `0x${string}`;
  chainRoundId: string;
  creatorAddress: `0x${string}`;
  rulesHash: `0x${string}`;
  commitDeadline: number;
  revealDeadline: number;
  observationStart: number;
  observationEnd: number;
  createdAt: number;
  createTxHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  title: string;
  rulesJson: string;
  logIndex: number;
}

export function createD1RoundIndex(db: D1Database) {
  return {
    async recordRound(input: IndexedRoundCreated): Promise<string> {
      const id = `${input.chainId}:${input.contractAddress.toLowerCase()}:${input.chainRoundId}`;
      const existing = await db
        .prepare(
          `SELECT creator_address AS creatorAddress, rules_hash AS rulesHash
           FROM rounds WHERE chain_id = ? AND contract_address = ? AND chain_round_id = ?`,
        )
        .bind(input.chainId, input.contractAddress.toLowerCase(), input.chainRoundId)
        .first<{ creatorAddress: string; rulesHash: string }>();
      if (
        existing &&
        (existing.creatorAddress.toLowerCase() !== input.creatorAddress.toLowerCase() ||
          existing.rulesHash.toLowerCase() !== input.rulesHash.toLowerCase())
      )
        throw new Error('The indexed round identity conflicts with existing chain records.');

      await db.batch([
        db
          .prepare(
            `INSERT INTO users (wallet_address, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT(wallet_address) DO NOTHING`,
          )
          .bind(input.creatorAddress, input.createdAt * 1000, input.createdAt * 1000),
        db
          .prepare(
            `INSERT INTO rounds
               (id, chain_id, contract_address, chain_round_id, creator_address, rules_hash,
                commit_deadline, reveal_deadline, observation_start, observation_end, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            id,
            input.chainId,
            input.contractAddress.toLowerCase(),
            input.chainRoundId,
            input.creatorAddress,
            input.rulesHash,
            input.commitDeadline,
            input.revealDeadline,
            input.observationStart,
            input.observationEnd,
            input.createdAt * 1000,
          ),
        db
          .prepare(
            `INSERT INTO user_created_rounds
               (round_id, creator_address, create_tx_hash, created_at, title, rules_json,
                block_number, block_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(round_id) DO NOTHING`,
          )
          .bind(
            id,
            input.creatorAddress,
            input.createTxHash,
            input.createdAt * 1000,
            input.title,
            input.rulesJson,
            input.blockNumber,
            input.blockHash,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO chain_index_events
               (chain_id, contract_address, transaction_hash, log_index, block_number, block_hash,
                event_name, event_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'RoundCreated', ?, ?)`,
          )
          .bind(
            input.chainId,
            input.contractAddress.toLowerCase(),
            input.createTxHash,
            input.logIndex,
            input.blockNumber,
            input.blockHash,
            JSON.stringify(input),
            input.createdAt * 1000,
          ),
      ]);
      return id;
    },

    async recordCommit(input: {
      roundId: string;
      address: `0x${string}`;
      commitment: `0x${string}`;
      transactionHash: `0x${string}`;
      blockNumber: string;
      blockHash: `0x${string}`;
      logIndex: number;
      createdAt: number;
      chainId: number;
      contractAddress: `0x${string}`;
    }) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (wallet_address, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT(wallet_address) DO NOTHING`,
          )
          .bind(input.address, input.createdAt * 1000, input.createdAt * 1000),
        db
          .prepare(
            `INSERT INTO predictions
               (round_id, wallet_address, commitment_hash, value, revealed_at, missed_at,
                commit_tx_hash, reveal_tx_hash, created_at)
             VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)
             ON CONFLICT(round_id, wallet_address) DO UPDATE SET
               commitment_hash = excluded.commitment_hash,
               commit_tx_hash = excluded.commit_tx_hash,
               created_at = excluded.created_at`,
          )
          .bind(input.roundId, input.address, input.commitment, input.transactionHash, input.createdAt * 1000),
        db
          .prepare(
            `INSERT INTO commitments
               (round_id, wallet_address, commitment_hash, transaction_hash, block_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(round_id, wallet_address) DO UPDATE SET
               commitment_hash = excluded.commitment_hash,
               transaction_hash = excluded.transaction_hash,
               block_number = excluded.block_number,
               created_at = excluded.created_at`,
          )
          .bind(
            input.roundId,
            input.address,
            input.commitment,
            input.transactionHash,
            input.blockNumber,
            input.createdAt * 1000,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO chain_index_events
               (chain_id, contract_address, transaction_hash, log_index, block_number, block_hash,
                event_name, event_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'HumanCommitted', ?, ?)`,
          )
          .bind(
            input.chainId,
            input.contractAddress.toLowerCase(),
            input.transactionHash,
            input.logIndex,
            input.blockNumber,
            input.blockHash,
            JSON.stringify(input),
            input.createdAt * 1000,
          ),
      ]);
    },

    async recordReveal(input: {
      roundId: string;
      address: `0x${string}`;
      value: number;
      transactionHash: `0x${string}`;
      blockNumber: string;
      blockHash: `0x${string}`;
      logIndex: number;
      createdAt: number;
      chainId: number;
      contractAddress: `0x${string}`;
    }) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (wallet_address, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, NULL)
             ON CONFLICT(wallet_address) DO NOTHING`,
          )
          .bind(input.address, input.createdAt * 1000, input.createdAt * 1000),
        db
          .prepare(
            `INSERT INTO predictions
               (round_id, wallet_address, commitment_hash, value, revealed_at, missed_at,
                commit_tx_hash, reveal_tx_hash, created_at)
             VALUES (?, ?, '', ?, ?, NULL, '', ?, ?)
             ON CONFLICT(round_id, wallet_address) DO UPDATE SET
               value = excluded.value, revealed_at = excluded.revealed_at,
               reveal_tx_hash = excluded.reveal_tx_hash`,
          )
          .bind(
            input.roundId,
            input.address,
            input.value,
            input.createdAt * 1000,
            input.transactionHash,
            input.createdAt * 1000,
          ),
        db
          .prepare(
            `INSERT INTO reveals
               (round_id, wallet_address, value, transaction_hash, block_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(round_id, wallet_address) DO UPDATE SET
               value = excluded.value, transaction_hash = excluded.transaction_hash,
               block_number = excluded.block_number, created_at = excluded.created_at`,
          )
          .bind(
            input.roundId,
            input.address,
            input.value,
            input.transactionHash,
            input.blockNumber,
            input.createdAt * 1000,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO chain_index_events
               (chain_id, contract_address, transaction_hash, log_index, block_number, block_hash,
                event_name, event_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'HumanRevealed', ?, ?)`,
          )
          .bind(
            input.chainId,
            input.contractAddress.toLowerCase(),
            input.transactionHash,
            input.logIndex,
            input.blockNumber,
            input.blockHash,
            JSON.stringify(input),
            input.createdAt * 1000,
          ),
      ]);
    },

    async listRounds(chainId: number, contractAddress: string): Promise<Round[]> {
      const result = await db
        .prepare(
          `SELECT r.*, u.create_tx_hash AS createTx, u.title,
                  u.rules_json AS rules, s.outcome, s.evidence_hash AS evidenceHash,
                  s.transaction_hash AS settleTx
           FROM rounds r
           JOIN user_created_rounds u ON u.round_id = r.id
           LEFT JOIN settlements s ON s.round_id = r.id
           WHERE r.chain_id = ? AND r.contract_address = ?
           ORDER BY r.created_at DESC`,
        )
        .bind(chainId, contractAddress.toLowerCase())
        .all<Record<string, unknown>>();
      return result.results.map((row) => {
        const createdAt = Number(row.created_at) / 1000;
        const creator = String(row.creator_address);
        const round: Round = {
          id: String(row.id),
          mode: 'onchain',
          createdAt,
          commitDeadline: Number(row.commit_deadline),
          revealDeadline: Number(row.reveal_deadline),
          observationStart: Number(row.observation_start),
          observationEnd: Number(row.observation_end),
          rules: String(row.rules),
          rulesHash: String(row.rules_hash) as `0x${string}`,
          forecasts: [],
          cancelled: row.status === 'cancelled',
          chainRoundId: String(row.chain_round_id),
          contractAddress: String(row.contract_address) as `0x${string}`,
          createTx: String(row.createTx) as `0x${string}`,
          activity: [{ at: createdAt, message: `Created by ${creator}` }],
        };
        if (row.outcome !== null && row.outcome !== undefined) round.outcome = Number(row.outcome);
        if (row.evidenceHash) round.evidenceHash = String(row.evidenceHash) as `0x${string}`;
        if (row.settleTx) round.settleTx = String(row.settleTx) as `0x${string}`;
        return round;
      });
    },
  };
}
