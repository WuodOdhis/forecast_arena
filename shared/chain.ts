import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  parseAbi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { resolveChainProfile, type ChainEnvironment } from './chains.js';
import type { Evidence } from './domain.js';
import { resolveFeatureFlags, type FeatureFlagEnvironment } from './features.js';

export type ChainConfig = ChainEnvironment & FeatureFlagEnvironment;

export function createChain(config: ChainConfig) {
  const resolved = resolveChainProfile(config);
  const { profile } = resolved;
  const features = resolveFeatureFlags(config, profile.id);
  const credentialsConfigured = {
    wallet: Boolean(resolved.deployerPrivateKey),
    contract: Boolean(resolved.arenaContractAddress),
  };
  const botChain = defineChain({
    id: profile.chainId,
    name: profile.name,
    nativeCurrency: profile.nativeCurrency,
    rpcUrls: { default: { http: [resolved.rpcUrl] } },
    blockExplorers: { default: { name: 'BOTScan', url: profile.explorerBaseUrl } },
    testnet: profile.testnet,
  });
  const rpc = createPublicClient({
    chain: botChain,
    transport: http(resolved.rpcUrl, {
      timeout: 15_000,
      retryCount: 2,
      batch: { batchSize: 128, wait: 5 },
    }),
  });
  const abi = parseAbi([
    'function operator() view returns (address)',
    'function nextRoundId() view returns (uint256)',
    'function rounds(uint256) view returns (bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd, bool settled, bool cancelled, uint256 outcome, bytes32 evidenceHash)',
    'function predictions(uint256, bytes32) view returns (address submitter, bytes32 commitment, uint256 value, bool revealed)',
    'function createRound(bytes32, uint64, uint64, uint64, uint64) returns (uint256)',
    'function commit(uint256, bytes32, bytes32)',
    'function reveal(uint256, bytes32, uint256, bytes32)',
    'function settle(uint256, uint256, bytes32)',
    'function cancel(uint256)',
  ]);
  function signer() {
    const key = resolved.deployerPrivateKey;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
      throw new Error(`Configure a valid ${profile.id} deployer private key in the server secrets.`);
    const account = privateKeyToAccount(key as Hex);
    return createWalletClient({ account, chain: botChain, transport: http(resolved.rpcUrl) });
  }
  function contractAddress(): Hex {
    const address = resolved.arenaContractAddress;
    if (!address || !isAddress(address))
      throw new Error(`Deploy the contract and configure the ${profile.id} arena address.`);
    return address;
  }
  async function assertChain() {
    const actualChainId = await rpc.getChainId();
    if (actualChainId !== profile.chainId)
      throw new Error(
        `RPC chain ID ${actualChainId} does not match ${profile.name} (${profile.chainId}).`,
      );
  }
  async function assertTestnet() {
    if (profile.id !== 'testnet')
      throw new Error(`This operation is testnet-only; selected profile is ${profile.id}.`);
    await assertChain();
  }
  async function assertOperator(address: Hex) {
    await assertChain();
    const wallet = signer();
    const owner = await rpc.readContract({ address, abi, functionName: 'operator' });
    if (owner.toLowerCase() !== wallet.account.address.toLowerCase())
      throw new Error("Configured wallet is not this contract's operator.");
  }
  async function send(
    address: Hex,
    functionName: 'createRound' | 'commit' | 'reveal' | 'settle' | 'cancel',
    args: readonly unknown[],
    onHash: (hash: Hex) => void,
  ) {
    // Simulate before signing; the server only sends to the configured arena contract.
    const wallet = signer();
    const { request } = await rpc.simulateContract({
      address,
      abi,
      functionName,
      args,
      account: wallet.account,
    } as any);
    const hash = await wallet.writeContract({ ...request, account: wallet.account });
    onHash(hash);
    const receipt = await rpc.waitForTransactionReceipt({
      hash,
      confirmations: profile.transactionConfirmations,
      timeout: 120_000,
    });
    if (receipt.status !== 'success') throw new Error('Contract transaction reverted.');
    return hash;
  }
  async function recentStats() {
    await assertChain();
    const latest = await rpc.getBlock();
    const size = latest.number < 24n ? Number(latest.number) + 1 : 24;
    const blocks = [];
    const recent = await Promise.all(
      Array.from({ length: size }, (_, i) =>
        rpc.getBlock({ blockNumber: latest.number - BigInt(size - 1 - i) }),
      ),
    );
    for (const block of recent) {
      blocks.push({
        number: block.number.toString(),
        timestamp: Number(block.timestamp),
        transactions: block.transactions.length,
      });
    }
    const elapsed = Math.max(1, blocks.at(-1)!.timestamp - blocks[0].timestamp);
    const counts = blocks.slice(1).map((b) => b.transactions);
    const total = counts.reduce((a, b) => a + b, 0);
    const sorted = [...counts].sort((a, b) => a - b);
    return {
      blocks,
      blockNumber: latest.number.toString(),
      blockHash: latest.hash,
      blockTimestamp: Number(latest.timestamp),
      meanRate: total / elapsed,
      medianRate: ((sorted[Math.floor(sorted.length / 2)] || 0) * counts.length) / elapsed,
    };
  }

  async function lowerBoundTimestamp(
    target: number,
    latest: bigint,
    timestamp: (n: bigint) => Promise<number>,
  ): Promise<bigint> {
    let lo = 0n,
      hi = latest + 1n;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await timestamp(mid)) < target) lo = mid + 1n;
      else hi = mid;
    }
    return lo;
  }

  async function collectEvidence(start: number, end: number): Promise<Evidence> {
    await assertChain();
    const latest = await rpc.getBlock({ blockTag: 'latest' });
    const confirmations = BigInt(profile.confirmationsRequired);
    if (latest.number < confirmations)
      throw new Error(`Waiting for ${profile.confirmationsRequired} ${profile.name} confirmations.`);
    const safe = latest.number - confirmations;
    const safeBlock = await rpc.getBlock({ blockNumber: safe });
    if (Number(safeBlock.timestamp) < end)
      throw new Error(
        `Waiting for the observation end to have ${profile.confirmationsRequired} confirmations.`,
      );
    const timestamp = async (n: bigint) =>
      Number((await rpc.getBlock({ blockNumber: n })).timestamp);
    const [first, boundary] = await Promise.all([
      lowerBoundTimestamp(start, safe, timestamp),
      lowerBoundTimestamp(end, safe, timestamp),
    ]);
    if (boundary - first > 6000n)
      throw new Error('Observation range exceeds prototype limit of 6,000 blocks.');
    const previous = first > 0n ? await rpc.getBlock({ blockNumber: first - 1n }) : null;
    const endBlock = await rpc.getBlock({ blockNumber: boundary });
    const blocks: Evidence['blocks'] = [];
    let parent = previous?.hash;
    for (let n = first; n < boundary; n += 128n) {
      const batch = Array.from(
        { length: Number(boundary - n < 128n ? boundary - n : 128n) },
        (_, i) => n + BigInt(i),
      );
      const results = await Promise.all(batch.map((blockNumber) => rpc.getBlock({ blockNumber })));
      for (const b of results) {
        if (parent && b.parentHash !== parent)
          throw new Error('Chain changed during collection; retrying.');
        if (Number(b.timestamp) < start || Number(b.timestamp) >= end)
          throw new Error('Block timestamps changed; retrying.');
        blocks.push({
          number: b.number.toString(),
          hash: b.hash,
          timestamp: Number(b.timestamp),
          transactions: b.transactions.length,
        });
        parent = b.hash;
      }
    }
    if (parent && endBlock.parentHash !== parent)
      throw new Error('End boundary changed; retrying.');
    const recheck = await rpc.getBlock({ blockNumber: boundary });
    if (recheck.hash !== endBlock.hash) throw new Error('Canonical boundary changed; retrying.');
    return {
      schema: 'forecast-arena/outcome-v1',
      chainId: profile.chainId,
      observationStart: start,
      observationEnd: end,
      collectedAt: Math.floor(Date.now() / 1000),
      source:
        resolved.rpcUrl === profile.rpcUrl ? profile.rpcUrl : `Configured ${profile.name} RPC`,
      method:
        `Count every transaction in canonical blocks with start <= block.timestamp < end; reverted transactions included. End boundary has at least ${profile.confirmationsRequired} successor blocks.`,
      previousBlock: previous
        ? {
            number: previous.number.toString(),
            hash: previous.hash,
            timestamp: Number(previous.timestamp),
          }
        : null,
      endBoundary: {
        number: endBlock.number.toString(),
        hash: endBlock.hash,
        timestamp: Number(endBlock.timestamp),
      },
      blocks,
      outcome: blocks.reduce((sum, b) => sum + b.transactions, 0),
    };
  }
  return {
    profile,
    features,
    credentialsConfigured,
    arenaAddress: resolved.arenaContractAddress || null,
    botChain,
    botTestnet: botChain,
    rpc,
    abi,
    signer,
    contractAddress,
    assertChain,
    assertTestnet,
    assertOperator,
    send,
    recentStats,
    lowerBoundTimestamp,
    collectEvidence,
  };
}
