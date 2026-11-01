import 'dotenv/config';
import { z } from 'zod';
import { digest } from '../shared/domain.js';
import { createChain } from '../shared/chain.js';

const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const blockSchema = z.object({
  number: z.string().regex(/^\d+$/),
  hash: hashSchema,
  timestamp: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});
const boundarySchema = z.object({
  number: z.string().regex(/^\d+$/),
  hash: hashSchema,
  timestamp: z.number().int().nonnegative(),
});
const evidenceSchema = z.object({
  schema: z.literal('forecast-arena/outcome-v1'),
  chainId: z.number().int().positive(),
  observationStart: z.number().int().nonnegative(),
  observationEnd: z.number().int().positive(),
  collectedAt: z.number().int().nonnegative(),
  source: z.string().min(1),
  method: z.string().min(1),
  previousBlock: boundarySchema.nullable(),
  endBoundary: boundarySchema,
  blocks: z.array(blockSchema),
  outcome: z.number().int().nonnegative(),
});
const roundSchema = z
  .object({
    id: z.string().min(1),
    mode: z.literal('onchain'),
    chainRoundId: z.string().regex(/^\d+$/),
    contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    rulesHash: hashSchema,
    commitDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    observationStart: z.number().int().nonnegative(),
    observationEnd: z.number().int().positive(),
    outcome: z.number().int().nonnegative(),
    evidenceHash: hashSchema,
    settleTx: hashSchema,
    cancelled: z.literal(false),
  })
  .passthrough();

const roundId = process.argv[2];
if (!roundId) throw new Error('Usage: npm run verify:round -- <round-id>');

const chain = createChain(process.env);
const apiBase = (process.env.ARENA_API_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const response = await fetch(`${apiBase}/api/rounds`);
if (!response.ok) throw new Error(`Could not load rounds from ${apiBase} (HTTP ${response.status}).`);
const rounds = z.array(z.unknown()).parse(await response.json());
const roundValue = rounds.find(
  (value) => typeof value === 'object' && value !== null && 'id' in value && value.id === roundId,
);
if (!roundValue) throw new Error(`Round ${roundId} was not found at ${apiBase}.`);
const round = roundSchema.parse(roundValue);
if (round.outcome === undefined || round.evidenceHash === undefined)
  throw new Error('Round has not been settled with published evidence.');

const [rulesResponse, evidenceResponse] = await Promise.all([
  fetch(`${apiBase}/api/rounds/${encodeURIComponent(roundId)}/rules`),
  fetch(`${apiBase}/api/rounds/${encodeURIComponent(roundId)}/evidence`),
]);
if (!rulesResponse.ok)
  throw new Error(`Could not load committed round rules (HTTP ${rulesResponse.status}).`);
if (!evidenceResponse.ok)
  throw new Error(`Could not load round evidence (HTTP ${evidenceResponse.status}).`);
const [rules, evidenceText] = await Promise.all([
  rulesResponse.text(),
  evidenceResponse.text(),
]);
if (digest(rules).toLowerCase() !== round.rulesHash.toLowerCase())
  throw new Error('Published rules do not match the round rules hash.');
if (digest(evidenceText).toLowerCase() !== round.evidenceHash.toLowerCase())
  throw new Error('Published evidence does not match the committed evidence hash.');
const evidence = evidenceSchema.parse(JSON.parse(evidenceText));
if (
  evidence.chainId !== chain.profile.chainId ||
  evidence.observationStart !== round.observationStart ||
  evidence.observationEnd !== round.observationEnd
)
  throw new Error('Evidence chain or observation window does not match the round.');
const parsedRules: unknown = JSON.parse(rules);
const rulesWindow = z
  .object({
    chainId: z.number().int(),
    observationStart: z.number().int(),
    observationEnd: z.number().int(),
  })
  .parse(parsedRules);
if (
  rulesWindow.chainId !== evidence.chainId ||
  rulesWindow.observationStart !== evidence.observationStart ||
  rulesWindow.observationEnd !== evidence.observationEnd
)
  throw new Error('Committed rules specify a different chain or observation window.');

const actualChainId = await chain.rpc.getChainId();
if (actualChainId !== chain.profile.chainId)
  throw new Error(`RPC chain ID ${actualChainId} does not match ${chain.profile.name}.`);
const latest = await chain.rpc.getBlock({ blockTag: 'latest' });
const safeNumber = latest.number - BigInt(chain.profile.confirmationsRequired);
if (safeNumber < 0n || BigInt(evidence.endBoundary.number) > safeNumber)
  throw new Error('The evidence boundary has not reached the configured confirmation depth.');
if (evidence.endBoundary.timestamp < evidence.observationEnd)
  throw new Error('The end boundary does not close the observation window.');

let parentHash: string | undefined;
if (evidence.previousBlock) {
  const previous = await chain.rpc.getBlock({
    blockNumber: BigInt(evidence.previousBlock.number),
    includeTransactions: false,
  });
  if (
    previous.hash?.toLowerCase() !== evidence.previousBlock.hash.toLowerCase() ||
    Number(previous.timestamp) !== evidence.previousBlock.timestamp ||
    Number(previous.timestamp) >= evidence.observationStart
  )
    throw new Error('The published preceding block is not canonical or outside its expected boundary.');
  parentHash = previous.hash;
}

let totalTransactions = 0;
let expectedNumber = evidence.previousBlock ? BigInt(evidence.previousBlock.number) + 1n : 0n;
for (let offset = 0; offset < evidence.blocks.length; offset += 128) {
  const batch = evidence.blocks.slice(offset, offset + 128);
  const canonical = await Promise.all(
    batch.map((block) =>
      chain.rpc.getBlock({ blockNumber: BigInt(block.number), includeTransactions: false }),
    ),
  );
  for (let index = 0; index < batch.length; index++) {
    const published = batch[index]!;
    const actual = canonical[index]!;
    if (BigInt(published.number) !== expectedNumber)
      throw new Error(`Evidence skips or reorders block ${expectedNumber}.`);
    if (
      actual.hash?.toLowerCase() !== published.hash.toLowerCase() ||
      Number(actual.timestamp) !== published.timestamp ||
      actual.transactions.length !== published.transactions ||
      (parentHash !== undefined && actual.parentHash.toLowerCase() !== parentHash.toLowerCase()) ||
      published.timestamp < evidence.observationStart ||
      published.timestamp >= evidence.observationEnd
    )
      throw new Error(`Published evidence for block ${published.number} does not match canonical RPC data.`);
    totalTransactions += actual.transactions.length;
    parentHash = actual.hash;
    expectedNumber++;
  }
}

const boundary = await chain.rpc.getBlock({
  blockNumber: BigInt(evidence.endBoundary.number),
  includeTransactions: false,
});
if (
  BigInt(evidence.endBoundary.number) !== expectedNumber ||
  boundary.hash?.toLowerCase() !== evidence.endBoundary.hash.toLowerCase() ||
  Number(boundary.timestamp) !== evidence.endBoundary.timestamp ||
  Number(boundary.timestamp) < evidence.observationEnd ||
  (parentHash !== undefined && boundary.parentHash.toLowerCase() !== parentHash.toLowerCase())
)
  throw new Error('Published end boundary is not the canonical successor of the evidence blocks.');
if (totalTransactions !== evidence.outcome || evidence.outcome !== round.outcome)
  throw new Error('Recomputed transaction count does not match the published outcome.');

const contractAddress = round.contractAddress as `0x${string}`;
const contractRound = await chain.rpc.readContract({
  address: contractAddress,
  abi: chain.abi,
  functionName: 'rounds',
  args: [BigInt(round.chainRoundId)],
});
if (
  contractRound[0].toLowerCase() !== round.rulesHash.toLowerCase() ||
  Number(contractRound[1]) !== round.commitDeadline ||
  Number(contractRound[2]) !== round.revealDeadline ||
  Number(contractRound[3]) !== round.observationStart ||
  Number(contractRound[4]) !== round.observationEnd ||
  !contractRound[5] ||
  contractRound[6] ||
  contractRound[7] !== BigInt(round.outcome) ||
  contractRound[8].toLowerCase() !== round.evidenceHash.toLowerCase()
)
  throw new Error('On-chain round state does not match the published round and evidence.');
const settlement = await chain.rpc.getTransactionReceipt({ hash: round.settleTx as `0x${string}` });
if (
  settlement.status !== 'success' ||
  settlement.to?.toLowerCase() !== contractAddress.toLowerCase() ||
  settlement.blockNumber > safeNumber
)
  throw new Error('Settlement transaction is not successful, for this contract, or sufficiently confirmed.');

console.log(
  JSON.stringify(
    {
      verified: true,
      roundId,
      chain: chain.profile.name,
      chainId: evidence.chainId,
      contract: contractAddress,
      chainRoundId: round.chainRoundId,
      outcome: evidence.outcome,
      evidenceBlocks: evidence.blocks.length,
      evidenceHash: round.evidenceHash,
      settlementTransaction: round.settleTx,
      confirmedThroughBlock: safeNumber.toString(),
    },
    null,
    2,
  ),
);
