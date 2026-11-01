import { resolveChainProfile, type ChainProfileId } from '../shared/chains.js';
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
  type Hex,
} from 'viem';
import { apiUrl } from './api.js';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(
    event: 'accountsChanged' | 'chainChanged',
    listener: (value: string[] | string) => void,
  ): void;
  removeListener?(
    event: 'accountsChanged' | 'chainChanged',
    listener: (value: string[] | string) => void,
  ): void;
}

const humanPredictionAbi = parseAbi([
  'function humanCommitmentFor(uint256 id, address submitter, uint256 value, bytes32 salt) view returns (bytes32)',
  'function commitHuman(uint256 id, bytes32 commitment)',
  'function revealHuman(uint256 id, uint256 value, bytes32 salt)',
  'function humanPredictions(uint256, address) view returns (bytes32 commitment, uint256 value, bool revealed, bool missed)',
]);
const roundCreationAbi = parseAbi([
  'event RoundCreated(uint256 indexed roundId, address indexed creator, bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd)',
  'function createUserRound(bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd)',
]);
const predictionSecretPrefix = 'forecast-arena:human-prediction:v1';

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const walletConnectProjectId = import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID?.trim();
let activeProvider: Eip1193Provider | undefined;
let walletConnectProvider: Eip1193Provider | undefined;

export const walletConnectAvailable = Boolean(walletConnectProjectId);

export interface WalletLoginSession {
  address: `0x${string}`;
  expiresAt: number;
}

export interface HumanPredictionState {
  commitment: Hex;
  revealed: boolean;
  missed: boolean;
}

function predictionSecretKey(chainId: number, contract: string, roundId: string, address: string) {
  return `${predictionSecretPrefix}:${chainId}:${contract.toLowerCase()}:${roundId}:${address.toLowerCase()}`;
}

function walletProvider() {
  const provider = activeProvider ?? window.ethereum;
  if (!provider)
    throw new Error('No injected wallet was found. Install or unlock a BOT Chain-compatible wallet.');
  return provider;
}

async function getWalletConnectProvider(chainId: number): Promise<Eip1193Provider> {
  if (!walletConnectProjectId)
    throw new Error('WalletConnect is not configured for this deployment.');
  if (!walletConnectProvider) {
    const profile = resolveChainProfile({ CHAIN_PROFILE: chainId === 677 ? 'mainnet' : 'staging' }).profile;
    const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
    const provider = await EthereumProvider.init({
      projectId: walletConnectProjectId,
      chains: [chainId],
      rpcMap: { [chainId]: profile.rpcUrl },
      showQrModal: true,
      metadata: {
        name: 'Forecast Arena',
        description: 'Wallet sign-in and on-chain forecast rounds',
        url: window.location.origin,
        icons: [`${window.location.origin}/forecast-arena-logo.png`],
      },
    });
    walletConnectProvider = provider;
  }
  const provider = walletConnectProvider as Eip1193Provider & { connected: boolean; connect(): Promise<void> };
  if (!provider.connected) await provider.connect();
  activeProvider = provider;
  return provider;
}

export function subscribeWalletChanges(
  event: 'accountsChanged' | 'chainChanged',
  listener: (value: string[] | string) => void,
): () => void {
  const provider = activeProvider ?? window.ethereum;
  if (!provider?.on || !provider.removeListener) return () => undefined;
  provider.on(event, listener);
  return () => provider.removeListener?.(event, listener);
}

async function waitForTransaction(provider: Eip1193Provider, hash: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    });
    if (receipt && typeof receipt === 'object' && 'status' in receipt) {
      const status = (receipt as { status: unknown }).status;
      if (status === '0x1') return receipt;
      if (status === '0x0') throw new Error(`Transaction ${hash} reverted.`);
      throw new Error(`Wallet returned an invalid receipt for transaction ${hash}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Transaction ${hash} is still pending. Check the explorer before retrying.`);
}

export async function createWalletRound(
  profileId: ChainProfileId,
  chainId: number,
  contractAddress: `0x${string}`,
  address: `0x${string}`,
  titleValue: string,
  descriptionValue: string,
  observationSeconds: 60 | 300 | 600,
): Promise<{ id: string; roundId: string; txHash: Hex }> {
  const title = titleValue.trim();
  const description = descriptionValue.trim();
  if (title.length < 3 || title.length > 100)
    throw new Error('Round title must be between 3 and 100 characters.');
  if (description.length < 10 || description.length > 500)
    throw new Error('Round description must be between 10 and 500 characters.');
  if (![60, 300, 600].includes(observationSeconds))
    throw new Error('Choose an observation window of 1, 5, or 10 minutes.');
  const provider = await assertWalletContext(profileId, chainId, address);
  const block = await provider.request({
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
  });
  if (!block || typeof block !== 'object' || !('timestamp' in block) || typeof block.timestamp !== 'string')
    throw new Error('The wallet could not read the latest chain timestamp.');
  const chainTime = Number(BigInt(block.timestamp));
  const commitDeadline = chainTime + 300;
  const revealDeadline = commitDeadline + 120;
  const observationStart = revealDeadline;
  const observationEnd = observationStart + observationSeconds;
  const rulesJson = JSON.stringify({
    schema: 'forecast-arena/user-round-v1',
    title,
    description,
    chainId,
    contract: contractAddress,
    creator: address,
    commitDeadline,
    revealDeadline,
    observationStart,
    observationEnd,
    outcome: 'Count all transactions in canonical BOT Chain blocks from observationStart through (but excluding) observationEnd.',
  });
  const rulesHash = keccak256(toHex(rulesJson));
  const data = encodeFunctionData({
    abi: roundCreationAbi,
    functionName: 'createUserRound',
    args: [
      rulesHash,
      BigInt(commitDeadline),
      BigInt(revealDeadline),
      BigInt(observationStart),
      BigInt(observationEnd),
    ],
  });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: contractAddress, data }],
  });
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
    throw new Error('Wallet returned an invalid transaction hash.');
  let receipt: unknown;
  try {
    receipt = await waitForTransaction(provider, txHash);
  } catch (error) {
    throw new Error(
      `Round creation transaction ${txHash} did not confirm: ${(error as Error).message}`,
    );
  }
  if (!receipt || typeof receipt !== 'object' || !('logs' in receipt) || !Array.isArray(receipt.logs))
    throw new Error(`Round creation confirmed at ${txHash}, but its receipt had no logs.`);
  const eventTopic = keccak256(
    toHex('RoundCreated(uint256,address,bytes32,uint64,uint64,uint64,uint64)'),
  );
  let roundId: string | undefined;
  for (const rawLog of receipt.logs) {
    if (
      !rawLog ||
      typeof rawLog !== 'object' ||
      !('address' in rawLog) ||
      typeof rawLog.address !== 'string' ||
      rawLog.address.toLowerCase() !== contractAddress.toLowerCase() ||
      !('topics' in rawLog) ||
      !Array.isArray(rawLog.topics) ||
      rawLog.topics[0] !== eventTopic ||
      !('data' in rawLog) ||
      typeof rawLog.data !== 'string'
    )
      continue;
    const event = decodeEventLog({
      abi: roundCreationAbi,
      eventName: 'RoundCreated',
      data: rawLog.data as Hex,
      topics: rawLog.topics as [Hex, ...Hex[]],
    });
    if (
      event.args.creator.toLowerCase() !== address.toLowerCase() ||
      event.args.rulesHash.toLowerCase() !== rulesHash.toLowerCase()
    )
      throw new Error(`Round creation receipt did not match the submitted wallet or rules (${txHash}).`);
    roundId = event.args.roundId.toString();
    break;
  }
  if (!roundId) throw new Error(`Round creation confirmed at ${txHash}, but RoundCreated was missing.`);
  try {
    const indexed = await api<{ id: string }>('/api/rounds/user-created', {
      txHash,
      title,
      rulesJson,
    });
    return { id: indexed.id, roundId, txHash: txHash as Hex };
  } catch (error) {
    throw new Error(
      `Round ${roundId} was created on-chain (${txHash}), but indexing failed: ${(error as Error).message}`,
    );
  }
}

async function assertWalletContext(
  profileId: ChainProfileId,
  chainId: number,
  address: string,
) {
  const provider = walletProvider();
  const profile = resolveChainProfile({ CHAIN_PROFILE: profileId }).profile;
  if (profile.chainId !== chainId)
    throw new Error('The server network configuration is inconsistent. Refresh and try again.');
  const [accounts, selectedChain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }),
    provider.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string')
    throw new Error('Connect your wallet before submitting an on-chain prediction.');
  if (accounts[0].toLowerCase() !== address.toLowerCase())
    throw new Error('The connected wallet does not match your signed-in account.');
  if (typeof selectedChain !== 'string' || BigInt(selectedChain) !== BigInt(chainId))
    throw new Error(`Switch your wallet to ${profile.name} before continuing.`);
  return provider;
}

export async function readHumanPrediction(
  profileId: ChainProfileId,
  chainId: number,
  contractAddress: `0x${string}`,
  roundId: string,
  address: `0x${string}`,
): Promise<HumanPredictionState> {
  const provider = await assertWalletContext(profileId, chainId, address);
  const data = encodeFunctionData({
    abi: humanPredictionAbi,
    functionName: 'humanPredictions',
    args: [BigInt(roundId), address],
  });
  const encoded = await provider.request({
    method: 'eth_call',
    params: [{ to: contractAddress, data }, 'latest'],
  });
  if (typeof encoded !== 'string') throw new Error('Wallet returned an invalid contract response.');
  const [commitment, , revealed, missed] = decodeFunctionResult({
    abi: humanPredictionAbi,
    functionName: 'humanPredictions',
    data: encoded as Hex,
  });
  return { commitment, revealed, missed };
}

export async function submitHumanCommitment(
  profileId: ChainProfileId,
  chainId: number,
  contractAddress: `0x${string}`,
  roundId: string,
  address: `0x${string}`,
  value: number,
): Promise<{ txHash: Hex; commitment: Hex }> {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Enter a non-negative whole-number prediction.');
  const provider = await assertWalletContext(profileId, chainId, address);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [BigInt(chainId), contractAddress, BigInt(roundId), address, BigInt(value), salt],
    ),
  );
  const commitmentCheck = await provider.request({
    method: 'eth_call',
    params: [
      {
        to: contractAddress,
        data: encodeFunctionData({
          abi: humanPredictionAbi,
          functionName: 'humanCommitmentFor',
          args: [BigInt(roundId), address, BigInt(value), salt],
        }),
      },
      'latest',
    ],
  });
  if (
    typeof commitmentCheck !== 'string' ||
    commitmentCheck.toLowerCase() !== commitment.toLowerCase()
  )
    throw new Error('Local commitment does not match the deployed contract; no transaction was sent.');
  const storageKey = predictionSecretKey(chainId, contractAddress, roundId, address);
  try {
    localStorage.setItem(storageKey, JSON.stringify({ value, salt }));
  } catch {
    throw new Error('Could not securely retain the reveal secret in this browser; no transaction was sent.');
  }
  const data = encodeFunctionData({
    abi: humanPredictionAbi,
    functionName: 'commitHuman',
    args: [BigInt(roundId), commitment],
  });
  try {
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: contractAddress, data }],
    });
    if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
      throw new Error('Wallet returned an invalid transaction hash.');
    await waitForTransaction(provider, txHash);
    return { txHash: txHash as Hex, commitment };
  } catch (error) {
    if (providerErrorCode(error) === 4001) localStorage.removeItem(storageKey);
    throw error;
  }
}

export async function submitHumanReveal(
  profileId: ChainProfileId,
  chainId: number,
  contractAddress: `0x${string}`,
  roundId: string,
  address: `0x${string}`,
): Promise<Hex> {
  const provider = await assertWalletContext(profileId, chainId, address);
  const storageKey = predictionSecretKey(chainId, contractAddress, roundId, address);
  const serialized = localStorage.getItem(storageKey);
  if (!serialized)
    throw new Error('This browser does not have the saved reveal secret for your prediction.');
  let secret: { value: number; salt: Hex };
  try {
    secret = JSON.parse(serialized) as { value: number; salt: Hex };
  } catch {
    throw new Error('The saved reveal secret is invalid. Do not clear browser data before recovery.');
  }
  if (
    !Number.isSafeInteger(secret.value) ||
    secret.value < 0 ||
    !/^0x[0-9a-fA-F]{64}$/.test(secret.salt)
  )
    throw new Error('The saved reveal secret is invalid.');
  const data = encodeFunctionData({
    abi: humanPredictionAbi,
    functionName: 'revealHuman',
    args: [BigInt(roundId), BigInt(secret.value), secret.salt],
  });
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: contractAddress, data }],
  });
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash))
    throw new Error('Wallet returned an invalid transaction hash.');
  await waitForTransaction(provider, txHash);
  return txHash as Hex;
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error || `Wallet sign-in failed (${response.status}).`);
  return result;
}

function providerErrorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code: unknown }).code)
    : undefined;
}

async function ensureWalletChain(provider: Eip1193Provider, profileId: ChainProfileId) {
  const profile = resolveChainProfile({ CHAIN_PROFILE: profileId }).profile;
  const chainId = `0x${profile.chainId.toString(16)}`;
  const current = await provider.request({ method: 'eth_chainId' });
  if (typeof current !== 'string') throw new Error('Wallet returned an invalid chain ID.');
  if (BigInt(current) === BigInt(chainId)) return;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: profile.name,
          nativeCurrency: profile.nativeCurrency,
          rpcUrls: [profile.rpcUrl],
          blockExplorerUrls: [profile.explorerBaseUrl],
        },
      ],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  }
  const selected = await provider.request({ method: 'eth_chainId' });
  if (typeof selected !== 'string' || BigInt(selected) !== BigInt(chainId))
    throw new Error(`Switch your wallet to ${profile.name} to sign in.`);
}

export async function connectWalletAndSignIn(
  profileId: ChainProfileId,
  chainId: number,
  connector: 'injected' | 'walletconnect' = 'injected',
): Promise<WalletLoginSession> {
  const profile = resolveChainProfile({ CHAIN_PROFILE: profileId }).profile;
  if (profile.chainId !== chainId)
    throw new Error('The server network configuration is inconsistent. Refresh and try again.');
  const provider =
    connector === 'walletconnect'
      ? await getWalletConnectProvider(chainId)
      : (activeProvider = window.ethereum);
  if (!provider)
    throw new Error('No injected wallet was found. Install or unlock a BOT Chain-compatible wallet.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string')
    throw new Error('The wallet did not return an account.');
  const address = accounts[0];
  await ensureWalletChain(provider, profileId);

  const challenge = await api<{
    address: string;
    nonce: string;
    message: string;
  }>('/api/auth/nonce', { address });
  if (challenge.address.toLowerCase() !== address.toLowerCase())
    throw new Error('The sign-in challenge was issued for a different wallet.');
  const signature = await provider.request({
    method: 'personal_sign',
    params: [challenge.message, address],
  });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{128,130}$/.test(signature))
    throw new Error('The wallet returned an invalid signature.');
  const result = await api<{ session: WalletLoginSession }>('/api/auth/verify', {
    address,
    nonce: challenge.nonce,
    signature,
  });
  if (result.session.address.toLowerCase() !== address.toLowerCase())
    throw new Error('The wallet session does not match the connected account.');
  return result.session;
}

export async function restoreWalletSession() {
  return api<{ session: WalletLoginSession | null }>('/api/auth/session');
}

export async function logoutWalletSession() {
  return api<{ ok: boolean }>('/api/auth/logout', {});
}
