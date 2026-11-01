PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY CHECK (length(wallet_address) = 42),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  nonce_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  origin TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wallet_challenges_expiry ON wallet_challenges(expires_at);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wallet_sessions_wallet_expiry
  ON wallet_sessions(wallet_address, expires_at);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  chain_round_id TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  commit_deadline INTEGER NOT NULL,
  reveal_deadline INTEGER NOT NULL,
  observation_start INTEGER NOT NULL,
  observation_end INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'settled', 'cancelled')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (creator_address) REFERENCES users(wallet_address)
);
CREATE UNIQUE INDEX IF NOT EXISTS rounds_chain_identity
  ON rounds(chain_id, contract_address, chain_round_id);
CREATE INDEX IF NOT EXISTS rounds_creator_created
  ON rounds(creator_address, created_at DESC);

CREATE TABLE IF NOT EXISTS user_created_rounds (
  round_id TEXT PRIMARY KEY,
  creator_address TEXT NOT NULL,
  create_tx_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_address) REFERENCES users(wallet_address)
);

CREATE TABLE IF NOT EXISTS predictions (
  round_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  commitment_hash TEXT NOT NULL,
  value INTEGER,
  revealed_at INTEGER,
  missed_at INTEGER,
  commit_tx_hash TEXT NOT NULL,
  reveal_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, wallet_address),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address)
);
CREATE INDEX IF NOT EXISTS predictions_wallet_created
  ON predictions(wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS commitments (
  round_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  commitment_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  block_number TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, wallet_address),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address)
);

CREATE TABLE IF NOT EXISTS reveals (
  round_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  value INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  block_number TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, wallet_address),
  FOREIGN KEY (round_id, wallet_address)
    REFERENCES commitments(round_id, wallet_address) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settlements (
  round_id TEXT PRIMARY KEY,
  outcome INTEGER NOT NULL,
  evidence_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  block_number TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS round_evidence (
  round_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  verified_at INTEGER,
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_latest
  ON leaderboard_snapshots(chain_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT,
  action TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  detail_json TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_records_wallet_created
  ON audit_records(wallet_address, created_at DESC);
