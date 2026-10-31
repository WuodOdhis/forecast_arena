import type { ChainProfileId } from './chains.js';

type FeatureName =
  | 'WALLET_AUTH'
  | 'USER_CREATED_ROUNDS'
  | 'HUMAN_PREDICTIONS'
  | 'D1_PERSISTENCE';
type SharedFeatureKey = `FEATURE_${FeatureName}`;
type ProfileFeatureKey = `FEATURE_${Uppercase<ChainProfileId>}_${FeatureName}`;

export type FeatureFlagEnvironment = Partial<
  Record<SharedFeatureKey | ProfileFeatureKey, string>
> & {
  FEATURE_MAINNET_ONCHAIN?: string;
};

export interface FeatureFlags {
  mainnetOnchain: boolean;
  walletAuth: boolean;
  userCreatedRounds: boolean;
  humanPredictions: boolean;
  d1Persistence: boolean;
}

function parseFlag(value: string | undefined, key: string): boolean {
  if (value === undefined || value === '') return false;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`${key} must be "true" or "false".`);
}

function readFlag(
  env: FeatureFlagEnvironment,
  profile: ChainProfileId,
  name: FeatureName,
): boolean {
  const profileKey = `FEATURE_${profile.toUpperCase()}_${name}` as ProfileFeatureKey;
  const sharedKey = `FEATURE_${name}` as SharedFeatureKey;
  const value = env[profileKey] ?? env[sharedKey];
  return parseFlag(value, `${profileKey} or ${sharedKey}`);
}

export function resolveFeatureFlags(
  env: FeatureFlagEnvironment,
  profile: ChainProfileId,
): FeatureFlags {
  return {
    mainnetOnchain: parseFlag(env.FEATURE_MAINNET_ONCHAIN, 'FEATURE_MAINNET_ONCHAIN'),
    walletAuth: readFlag(env, profile, 'WALLET_AUTH'),
    userCreatedRounds: readFlag(env, profile, 'USER_CREATED_ROUNDS'),
    humanPredictions: readFlag(env, profile, 'HUMAN_PREDICTIONS'),
    d1Persistence: readFlag(env, profile, 'D1_PERSISTENCE'),
  };
}
