export type ChainProfileId = 'testnet' | 'staging' | 'mainnet';

export interface ChainProfile {
  id: ChainProfileId;
  chainId: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
  rpcUrl: string;
  explorerBaseUrl: string;
  confirmationsRequired: number;
  transactionConfirmations: number;
  testnet: boolean;
}

const profiles: Record<ChainProfileId, ChainProfile> = {
  testnet: {
    id: 'testnet',
    chainId: 968,
    name: 'BOT Testnet',
    nativeCurrency: { name: 'Test BOT', symbol: 'tBOT', decimals: 18 },
    rpcUrl: 'https://rpc.bohr.life',
    explorerBaseUrl: 'https://scan.bohr.life',
    confirmationsRequired: 12,
    transactionConfirmations: 2,
    testnet: true,
  },
  staging: {
    id: 'staging',
    chainId: 968,
    name: 'BOT Testnet',
    nativeCurrency: { name: 'Test BOT', symbol: 'tBOT', decimals: 18 },
    rpcUrl: 'https://rpc.bohr.life',
    explorerBaseUrl: 'https://scan.bohr.life',
    confirmationsRequired: 12,
    transactionConfirmations: 2,
    testnet: true,
  },
  mainnet: {
    id: 'mainnet',
    chainId: 677,
    name: 'BOT Chain',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    rpcUrl: 'https://rpc.botchain.ai',
    explorerBaseUrl: 'https://scan.botchain.ai',
    confirmationsRequired: 12,
    transactionConfirmations: 2,
    testnet: false,
  },
};

export interface ChainEnvironment {
  CHAIN_PROFILE?: string;
  CHAIN_CONFIRMATIONS?: string;
  STAGING_CHAIN_CONFIRMATIONS?: string;
  MAINNET_CHAIN_CONFIRMATIONS?: string;
  BOT_RPC_URL?: string;
  STAGING_BOT_RPC_URL?: string;
  BOT_MAINNET_RPC_URL?: string;
  DEPLOYER_PRIVATE_KEY?: string;
  STAGING_DEPLOYER_PRIVATE_KEY?: string;
  MAINNET_DEPLOYER_PRIVATE_KEY?: string;
  ARENA_CONTRACT_ADDRESS?: string;
  STAGING_ARENA_CONTRACT_ADDRESS?: string;
  MAINNET_ARENA_CONTRACT_ADDRESS?: string;
}

export interface ResolvedChainProfile {
  profile: ChainProfile;
  rpcUrl: string;
  deployerPrivateKey?: string;
  arenaContractAddress?: string;
}

function confirmationOverride(value: string | undefined, profile: ChainProfile): ChainProfile {
  if (value === undefined || value.trim() === '') return profile;
  const confirmationsRequired = Number(value);
  if (!Number.isSafeInteger(confirmationsRequired) || confirmationsRequired < 1)
    throw new Error(`Confirmation count for ${profile.id} must be a positive integer.`);
  return { ...profile, confirmationsRequired };
}

function profileId(value: string | undefined): ChainProfileId {
  if (value === undefined || value === '') return 'testnet';
  if (value === 'testnet' || value === 'staging' || value === 'mainnet') return value;
  throw new Error(`Unsupported CHAIN_PROFILE "${value}". Use testnet, staging, or mainnet.`);
}

export function resolveChainProfile(env: ChainEnvironment): ResolvedChainProfile {
  const id = profileId(env.CHAIN_PROFILE);
  const profile = confirmationOverride(
    id === 'testnet'
      ? env.CHAIN_CONFIRMATIONS
      : id === 'staging'
        ? env.STAGING_CHAIN_CONFIRMATIONS
        : env.MAINNET_CHAIN_CONFIRMATIONS,
    profiles[id],
  );
  const rpcOverride =
    id === 'testnet'
      ? env.BOT_RPC_URL
      : id === 'staging'
        ? env.STAGING_BOT_RPC_URL
        : env.BOT_MAINNET_RPC_URL;
  const rpcUrl = rpcOverride?.trim() || profile.rpcUrl;
  let parsedRpcUrl: URL;
  try {
    parsedRpcUrl = new URL(rpcUrl);
  } catch {
    throw new Error(`Invalid RPC URL for ${id} profile.`);
  }
  if (!['http:', 'https:'].includes(parsedRpcUrl.protocol))
    throw new Error(`RPC URL for ${id} profile must use HTTP or HTTPS.`);

  return {
    profile,
    rpcUrl,
    deployerPrivateKey:
      id === 'testnet'
        ? env.DEPLOYER_PRIVATE_KEY
        : id === 'staging'
          ? env.STAGING_DEPLOYER_PRIVATE_KEY
          : env.MAINNET_DEPLOYER_PRIVATE_KEY,
    arenaContractAddress:
      id === 'testnet'
        ? env.ARENA_CONTRACT_ADDRESS
        : id === 'staging'
          ? env.STAGING_ARENA_CONTRACT_ADDRESS
          : env.MAINNET_ARENA_CONTRACT_ADDRESS,
  };
}

export function explorerTransactionUrl(profile: ChainProfile, hash: string): string {
  return `${profile.explorerBaseUrl}/tx/${hash}`;
}

export function explorerAddressUrl(profile: ChainProfile, address: string): string {
  return `${profile.explorerBaseUrl}/address/${address}`;
}
