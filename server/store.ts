import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import type { Round } from './domain.js';
import type { PublicUsage } from '../shared/public-access.js';
import type { WalletAuthStore, WalletChallenge, WalletSession } from '../shared/wallet-auth.js';

mkdirSync('data', { recursive: true, mode: 0o700 });
const db = new Database('data/arena.sqlite');
db.pragma('journal_mode = WAL');
db.exec(
  'CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL)',
);
db.exec(
  'CREATE TABLE IF NOT EXISTS public_usage (id INTEGER PRIMARY KEY CHECK(id = 1), body TEXT NOT NULL)',
);
db.exec(`
  CREATE TABLE IF NOT EXISTS wallet_challenges (
    nonce_hash TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    origin TEXT NOT NULL,
    chain_id INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wallet_auth_attempts (
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wallet_auth_attempts_window
    ON wallet_auth_attempts(address, created_at);
  CREATE TABLE IF NOT EXISTS wallet_sessions (
    token_hash TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wallet_sessions_expiry ON wallet_sessions(expires_at);
`);
const challengeColumns = db.prepare('PRAGMA table_info(wallet_challenges)').all() as {
  name: string;
}[];
if (!challengeColumns.some((column) => column.name === 'chain_id'))
  db.exec('ALTER TABLE wallet_challenges ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 0');

const walletAuth: WalletAuthStore = {
  issueChallenge(challenge, limit, windowStart) {
    const issue = db.transaction(() => {
      db.prepare('DELETE FROM wallet_auth_attempts WHERE created_at < ?').run(windowStart);
      db.prepare('DELETE FROM wallet_challenges WHERE expires_at <= ?').run(challenge.issuedAt);
      const attempts = db
        .prepare('SELECT COUNT(*) AS count FROM wallet_auth_attempts WHERE address = ? AND created_at >= ?')
        .get(challenge.address, windowStart) as { count: number };
      if (attempts.count >= limit) return false;
      db.prepare('INSERT INTO wallet_auth_attempts (address, created_at) VALUES (?, ?)').run(
        challenge.address,
        challenge.issuedAt,
      );
      db.prepare(
        `INSERT INTO wallet_challenges
         (nonce_hash, address, origin, chain_id, message, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        challenge.nonceHash,
        challenge.address,
        challenge.origin,
        challenge.chainId,
        challenge.message,
        challenge.issuedAt,
        challenge.expiresAt,
      );
      return true;
    });
    return issue();
  },
  findChallenge(nonceHash) {
    return db
      .prepare(
        `SELECT nonce_hash AS nonceHash, address, origin, chain_id AS chainId, message,
                issued_at AS issuedAt, expires_at AS expiresAt
         FROM wallet_challenges WHERE nonce_hash = ?`,
      )
      .get(nonceHash) as WalletChallenge | undefined;
  },
  completeLogin(nonceHash, address, now, session) {
    const complete = db.transaction(() => {
      const challenge = db
        .prepare(
          'SELECT nonce_hash FROM wallet_challenges WHERE nonce_hash = ? AND address = ? AND expires_at > ?',
        )
        .get(nonceHash, address, now);
      if (!challenge) return false;
      db.prepare('DELETE FROM wallet_challenges WHERE nonce_hash = ?').run(nonceHash);
      db.prepare('DELETE FROM wallet_sessions WHERE expires_at <= ?').run(now);
      db.prepare('INSERT INTO wallet_sessions VALUES (?, ?, ?, ?)').run(
        session.tokenHash,
        session.address,
        session.createdAt,
        session.expiresAt,
      );
      return true;
    });
    return complete();
  },
  getSession(tokenHash, now) {
    const session = db
      .prepare(
        'SELECT token_hash AS tokenHash, address, created_at AS createdAt, expires_at AS expiresAt FROM wallet_sessions WHERE token_hash = ? AND expires_at > ?',
      )
      .get(tokenHash, now) as WalletSession | undefined;
    if (!session) db.prepare('DELETE FROM wallet_sessions WHERE token_hash = ?').run(tokenHash);
    return session;
  },
  deleteSession(tokenHash) {
    db.prepare('DELETE FROM wallet_sessions WHERE token_hash = ?').run(tokenHash);
  },
};

export { walletAuth };

export function getPublicUsage(): PublicUsage | undefined {
  const row = db.prepare('SELECT body FROM public_usage WHERE id = 1').get() as
    { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
export function savePublicUsage(usage: PublicUsage) {
  db.prepare(
    'INSERT INTO public_usage VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
  ).run(JSON.stringify(usage));
}
const upsert = db.prepare(
  'INSERT INTO rounds VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
);
export function save(round: Round) {
  upsert.run(round.id, round.createdAt, JSON.stringify(round));
}
export function all(): Round[] {
  return (
    db.prepare('SELECT body FROM rounds ORDER BY created_at DESC, rowid DESC').all() as {
      body: string;
    }[]
  ).map((r) => JSON.parse(r.body));
}
export function get(id: string): Round | undefined {
  const row = db.prepare('SELECT body FROM rounds WHERE id = ?').get(id) as
    { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
}
