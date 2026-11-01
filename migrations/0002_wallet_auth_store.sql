ALTER TABLE wallet_challenges
  ADD COLUMN message TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS wallet_auth_attempts (
  nonce_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (wallet_address) REFERENCES users(wallet_address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wallet_auth_attempts_wallet_created
  ON wallet_auth_attempts(wallet_address, created_at);
