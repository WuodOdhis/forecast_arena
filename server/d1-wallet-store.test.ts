import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { createD1WalletAuthStore } from '../shared/d1-wallet-store.js';
import { createD1AccountStore } from '../shared/d1-account-store.js';
import type { WalletChallenge, WalletSession } from '../shared/wallet-auth.js';

function makeD1(): D1Database {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('migrations/0001_wallet_accounts.sql', 'utf8'));
  database.exec(readFileSync('migrations/0002_wallet_auth_store.sql', 'utf8'));
  database.exec(readFileSync('migrations/0003_round_index.sql', 'utf8'));
  const wrap = (query: string, values: unknown[] = []) => {
    const statement = database.prepare(query);
    return {
      first: async <T>() => statement.get(...(values as (string | number | null)[])) as T | undefined,
      all: async <T>() => ({
        results: statement.all(...(values as (string | number | null)[])) as T[],
        success: true,
        meta: { changes: 0 },
      }),
      run: async () => {
        const result = statement.run(...(values as (string | number | null)[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      bind: (...bound: unknown[]) => wrap(query, bound),
      execute: () => {
        const result = statement.run(...(values as (string | number | null)[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  };
  const db = {
    prepare: (query: string) => wrap(query) as unknown as D1PreparedStatement,
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      database.exec('BEGIN');
      try {
        const results = statements.map((statement) =>
          (statement as unknown as { execute: () => D1Result<T> }).execute(),
        );
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db as unknown as D1Database;
}

function challenge(nonceHash: string, now: number): WalletChallenge {
  return {
    nonceHash,
    address: '0x1111111111111111111111111111111111111111',
    origin: 'https://forecast.example',
    chainId: 968,
    message: 'Forecast Arena sign-in test',
    issuedAt: now,
    expiresAt: now + 60_000,
  };
}

function session(tokenHash: string, now: number): WalletSession {
  return {
    tokenHash,
    address: '0x1111111111111111111111111111111111111111',
    createdAt: now,
    expiresAt: now + 60_000,
  };
}

test('D1 wallet auth store persists challenges and revocable sessions', async () => {
  const store = createD1WalletAuthStore(makeD1());
  const now = 1_800_000_000_000;
  const issued = challenge('nonce-hash-1', now);
  assert.equal(await store.issueChallenge(issued, 5, now - 900_000), true);
  assert.deepEqual({ ...(await store.findChallenge(issued.nonceHash)) }, issued);

  const login = session('token-hash-1', now);
  assert.equal(await store.completeLogin(issued.nonceHash, issued.address, now, login), true);
  assert.equal(await store.findChallenge(issued.nonceHash), undefined);
  assert.deepEqual({ ...(await store.getSession(login.tokenHash, now)) }, login);

  await store.deleteSession(login.tokenHash);
  assert.equal(await store.getSession(login.tokenHash, now), undefined);
});

test('D1 wallet auth store enforces address limits and one-time challenge use', async () => {
  const store = createD1WalletAuthStore(makeD1());
  const now = 1_800_000_000_000;
  for (let i = 0; i < 2; i++)
    assert.equal(
      await store.issueChallenge(challenge(`nonce-hash-${i}`, now + i), 2, now - 900_000),
      true,
    );
  assert.equal(
    await store.issueChallenge(challenge('nonce-hash-over-limit', now + 3), 2, now - 900_000),
    false,
  );
  const login = session('token-hash-once', now);
  assert.equal(await store.completeLogin('nonce-hash-0', login.address, now, login), true);
  assert.equal(await store.completeLogin('nonce-hash-0', login.address, now, login), false);
  assert.equal(await store.completeLogin('nonce-hash-1', '0x2222222222222222222222222222222222222222', now, login), false);
});

test('D1 wallet auth store refuses expired challenge and session records', async () => {
  const store = createD1WalletAuthStore(makeD1());
  const now = 1_800_000_000_000;
  const issued = challenge('nonce-hash-expired', now);
  assert.equal(await store.issueChallenge(issued, 5, now - 900_000), true);
  const login = session('token-hash-expired', now);
  assert.equal(await store.completeLogin(issued.nonceHash, issued.address, issued.expiresAt, login), false);
  assert.equal(await store.getSession(login.tokenHash, login.expiresAt), undefined);
});

test('D1 account export includes history and deletion revokes account access', async () => {
  const db = makeD1();
  const auth = createD1WalletAuthStore(db);
  const accounts = createD1AccountStore(db);
  const now = 1_800_000_000_000;
  const entry = challenge('account-export-nonce', now);
  assert.equal(await auth.issueChallenge(entry, 5, now - 900_000), true);
  const login = session('account-export-token', now);
  assert.equal(await auth.completeLogin(entry.nonceHash, entry.address, now, login), true);
  await db
    .prepare(
      `INSERT INTO rounds
       (id, chain_id, contract_address, chain_round_id, creator_address, rules_hash,
        commit_deadline, reveal_deadline, observation_start, observation_end, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind('r1', 968, '0x2222222222222222222222222222222222222222', '1', entry.address, '0xhash', 1, 2, 2, 3, 'open', now)
    .run();
  await db
    .prepare(
      `INSERT INTO user_created_rounds
       (round_id, creator_address, create_tx_hash, created_at, title, rules_json, block_number, block_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind('r1', entry.address, '0xtx', now, 'Test', '{"test":true}', '4', '0xblock')
    .run();
  await db
    .prepare(
      `INSERT INTO predictions
       (round_id, wallet_address, commitment_hash, value, revealed_at, missed_at,
        commit_tx_hash, reveal_tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind('r1', entry.address, '0xcommitment', 42, now, null, '0xcommit', '0xreveal', now)
    .run();

  const exported = await accounts.export(entry.address);
  assert.equal(exported?.createdRounds.length, 1);
  assert.equal(exported?.predictions.length, 1);
  assert.equal(await accounts.delete(entry.address, now + 1), true);
  assert.equal(await auth.getSession(login.tokenHash, now + 2), undefined);
  assert.equal((await accounts.export(entry.address))?.account.deletedAt, now + 1);
});
