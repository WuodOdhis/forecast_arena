import { test, expect } from '@playwright/test';
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  encodeAbiParameters,
  parseAbi,
} from 'viem';

const address = '0x1111111111111111111111111111111111111111' as const;
const contract = '0x2222222222222222222222222222222222222222' as const;
const abi = parseAbi([
  'function humanCommitmentFor(uint256 id, address submitter, uint256 value, bytes32 salt) view returns (bytes32)',
  'function commitHuman(uint256 id, bytes32 commitment)',
  'function revealHuman(uint256 id, uint256 value, bytes32 salt)',
  'function humanPredictions(uint256, address) view returns (bytes32 commitment, uint256 value, bool revealed, bool missed)',
]);

test('signed-in user commits and reveals a prediction from their wallet', async ({ page }) => {
  let authenticated = false;
  let phase: 'COMMIT' | 'REVEAL' = 'COMMIT';
  let commitment = `0x${'0'.repeat(64)}` as `0x${string}`;
  let revealed = false;
  const methods: string[] = [];

  await page.exposeFunction(
    '__walletRequest',
    async (method: string, params?: unknown[]) => {
      methods.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address];
      if (method === 'eth_chainId') return '0x3c8';
      if (method === 'personal_sign') return `0x${'11'.repeat(65)}`;
      if (method === 'eth_call') {
        const request = params?.[0] as { data: `0x${string}` };
        const decoded = decodeFunctionData({ abi, data: request.data });
        if (decoded.functionName === 'humanCommitmentFor') {
          const [roundId, submitter, value, salt] = decoded.args;
          const computed = keccak256(
            encodeAbiParameters(
              [
                { type: 'uint256' },
                { type: 'address' },
                { type: 'uint256' },
                { type: 'address' },
                { type: 'uint256' },
                { type: 'bytes32' },
              ],
              [968n, contract, roundId, submitter, value, salt],
            ),
          );
          return encodeFunctionResult({
            abi,
            functionName: 'humanCommitmentFor',
            result: computed,
          });
        }
        return encodeFunctionResult({
          abi,
          functionName: 'humanPredictions',
          result: [commitment, revealed ? 7n : 0n, revealed, false],
        });
      }
      if (method === 'eth_sendTransaction') {
        const transaction = params?.[0] as { data: `0x${string}` };
        const decoded = decodeFunctionData({ abi, data: transaction.data });
        if (decoded.functionName === 'commitHuman') commitment = decoded.args[1];
        if (decoded.functionName === 'revealHuman') revealed = true;
        return `0x${'ab'.repeat(32)}`;
      }
      if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
      throw new Error(`Unexpected wallet method ${method}`);
    },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: ({ method, params }: { method: string; params?: unknown[] }) =>
          (window as Window & { __walletRequest: (method: string, params?: unknown[]) => Promise<unknown> })
            .__walletRequest(method, params),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
  });

  const session = { address, expiresAt: Date.now() + 60_000 };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          network: { connected: true, blockNumber: '1234' },
          configured: { groq: true, wallet: true, contract: true },
          features: {
            mainnetOnchain: false,
            walletAuth: true,
            userCreatedRounds: false,
            humanPredictions: true,
            d1Persistence: false,
          },
          authRequired: true,
          permissions: { operator: false },
          publicRounds: { enabled: false, mode: 'onchain', duration: 60, dailyLimit: 12, remaining: 12, retryAt: null },
          contract,
          chainId: 968,
          networkName: 'BOT Testnet',
          chainProfile: 'staging',
          explorer: 'https://scan.bohr.life',
          serverTime: Date.now(),
          samples: [],
        },
      });
    if (path === '/api/rounds')
      return route.fulfill({
        json: [
          {
            id: 'user-round-1',
            mode: 'onchain',
            createdAt: 1_800_000_000,
            commitDeadline: 1_800_000_120,
            revealDeadline: 1_800_000_210,
            observationStart: 1_800_000_210,
            observationEnd: 1_800_000_270,
            rules: '{}',
            rulesHash: `0x${'01'.repeat(32)}`,
            forecasts: [],
            cancelled: false,
            chainRoundId: '7',
            contractAddress: contract,
            activity: [],
            phase,
          },
        ],
      });
    if (path === '/api/auth/session')
      return route.fulfill({ json: { session: authenticated ? session : null } });
    if (path === '/api/auth/nonce')
      return route.fulfill({
        json: {
          address,
          nonce: 'a'.repeat(64),
          message: 'Forecast Arena sign-in test',
          expiresAt: Date.now() + 300_000,
        },
      });
    if (path === '/api/auth/verify') {
      authenticated = true;
      return route.fulfill({ json: { session } });
    }
    if (path === '/api/auth/logout') {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request.' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText('Signed in as 0x111111...111111')).toBeVisible();
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Commit prediction' })).toBeVisible();
  await page.getByLabel('Predicted transaction count').fill('7');
  await page.getByRole('button', { name: 'Commit prediction' }).click();
  await expect(page.getByText('Prediction committed. Reveal is available during the reveal window.')).toBeVisible();
  expect(methods).toContain('eth_sendTransaction');

  phase = 'REVEAL';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reveal prediction' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal prediction' }).click();
  await expect(page.getByText('Your prediction has been revealed on-chain.')).toBeVisible();
  expect(methods.filter((method) => method === 'eth_sendTransaction')).toHaveLength(2);
});
