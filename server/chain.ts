import 'dotenv/config';
import './network.js';
import { createChain } from '../shared/chain.js';

export const {
  botTestnet,
  profile,
  features,
  credentialsConfigured,
  arenaAddress,
  rpc,
  abi,
  signer,
  contractAddress,
  assertTestnet,
  assertChain,
  assertOperator,
  send,
  recentStats,
  lowerBoundTimestamp,
  collectEvidence,
} = createChain(process.env);
