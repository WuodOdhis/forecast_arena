ALTER TABLE user_created_rounds
  ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE user_created_rounds
  ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_created_rounds
  ADD COLUMN block_number TEXT NOT NULL DEFAULT '0';
ALTER TABLE user_created_rounds
  ADD COLUMN block_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS chain_index_state (
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  next_block TEXT NOT NULL,
  checkpoint_number TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS chain_index_events (
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, contract_address, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS chain_index_events_block
  ON chain_index_events(chain_id, contract_address, block_number);
