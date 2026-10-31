import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChainProfile } from '../shared/chains.js';
import { resolveFeatureFlags } from '../shared/features.js';

test('chain profiles include verified BOT mainnet details and a 12-block policy threshold', () => {
  const { profile, rpcUrl } = resolveChainProfile({ CHAIN_PROFILE: 'mainnet' });
  assert.equal(profile.chainId, 677);
  assert.equal(profile.name, 'BOT Chain');
  assert.equal(profile.nativeCurrency.symbol, 'BOT');
  assert.equal(profile.explorerBaseUrl, 'https://scan.botchain.ai');
  assert.equal(profile.confirmationsRequired, 12);
  assert.equal(rpcUrl, 'https://rpc.botchain.ai');
});

test('testnet remains the default and keeps local RPC overrides', () => {
  const defaultProfile = resolveChainProfile({});
  assert.equal(defaultProfile.profile.id, 'testnet');
  assert.equal(defaultProfile.profile.chainId, 968);

  const localProfile = resolveChainProfile({
    CHAIN_PROFILE: 'testnet',
    BOT_RPC_URL: 'http://127.0.0.1:18545',
  });
  assert.equal(localProfile.rpcUrl, 'http://127.0.0.1:18545');
});

test('staging uses testnet chain settings without inheriting testnet secrets', () => {
  const resolved = resolveChainProfile({
    CHAIN_PROFILE: 'staging',
    DEPLOYER_PRIVATE_KEY: 'testnet-key',
    ARENA_CONTRACT_ADDRESS: 'testnet-contract',
  });
  assert.equal(resolved.profile.chainId, 968);
  assert.equal(resolved.deployerPrivateKey, undefined);
  assert.equal(resolved.arenaContractAddress, undefined);
});

test('profile parsing rejects unknown profiles and non-HTTP RPC URLs', () => {
  assert.throws(() => resolveChainProfile({ CHAIN_PROFILE: 'production' }), /Unsupported CHAIN_PROFILE/);
  assert.throws(() => resolveChainProfile({ BOT_RPC_URL: 'file:///tmp/rpc' }), /HTTP or HTTPS/);
  assert.throws(
    () => resolveChainProfile({ CHAIN_PROFILE: 'mainnet', MAINNET_CHAIN_CONFIRMATIONS: '0' }),
    /positive integer/,
  );
  assert.equal(
    resolveChainProfile({ CHAIN_PROFILE: 'mainnet', MAINNET_CHAIN_CONFIRMATIONS: '15' }).profile
      .confirmationsRequired,
    15,
  );
});

test('feature flags default off and allow profile-specific overrides', () => {
  assert.deepEqual(resolveFeatureFlags({}, 'mainnet'), {
    mainnetOnchain: false,
    walletAuth: false,
    userCreatedRounds: false,
    humanPredictions: false,
    d1Persistence: false,
  });
  const flags = resolveFeatureFlags(
    {
      FEATURE_MAINNET_ONCHAIN: 'true',
      FEATURE_WALLET_AUTH: 'true',
      FEATURE_MAINNET_WALLET_AUTH: 'false',
    },
    'mainnet',
  );
  assert.equal(flags.mainnetOnchain, true);
  assert.equal(flags.walletAuth, false);
});

test('feature flags reject ambiguous values', () => {
  assert.throws(
    () => resolveFeatureFlags({ FEATURE_TESTNET_D1_PERSISTENCE: 'yes' }, 'testnet'),
    /must be "true" or "false"/,
  );
});
