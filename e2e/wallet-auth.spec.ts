import { test, expect } from '@playwright/test';

test('injected wallet signs in, restores the session, and signs out', async ({ page }) => {
  const address = '0x1111111111111111111111111111111111111111';
  const session = { address, expiresAt: Date.now() + 60_000 };
  let authenticated = false;
  const calls: { method: string; params?: unknown[] }[] = [];
  await page.addInitScript(() => {
    let chainId = '0x1';
    const calls: { method: string; params?: unknown[] }[] = [];
    const listeners = new Map<string, (...args: unknown[]) => void>();
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          calls.push({ method, params });
          if (method === 'eth_chainId') return chainId;
          if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
          if (method === 'personal_sign') return `0x${'11'.repeat(65)}`;
          if (method === 'wallet_switchEthereumChain') {
            const requestedChain = (params?.[0] as { chainId: string }).chainId;
            if (chainId !== requestedChain) {
              const error = new Error('Unrecognized chain') as Error & { code: number };
              error.code = 4902;
              throw error;
            }
            return undefined;
          }
          if (method === 'wallet_addEthereumChain') {
            chainId = (params?.[0] as { chainId: string }).chainId;
            return null;
          }
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener);
        },
        removeListener: (event: string) => {
          listeners.delete(event);
        },
      },
    });
    Object.defineProperty(window, '__walletCalls', { value: calls });
    Object.defineProperty(window, '__emitWalletEvent', {
      value: (event: string, value: unknown) => listeners.get(event)?.(value),
    });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/status')
      return route.fulfill({
        json: {
          network: { connected: true, blockNumber: '1234' },
          configured: { groq: false, wallet: false, contract: false },
          features: {
            mainnetOnchain: false,
            walletAuth: true,
            userCreatedRounds: false,
            humanPredictions: false,
            d1Persistence: false,
          },
          authRequired: true,
          permissions: { operator: false },
          publicRounds: {
            enabled: false,
            mode: 'onchain',
            duration: 60,
            dailyLimit: 12,
            remaining: 12,
            retryAt: null,
          },
          contract: null,
          chainId: 677,
          networkName: 'BOT Chain',
          chainProfile: 'mainnet',
          explorer: 'https://scan.botchain.ai',
          serverTime: Date.now(),
          samples: [],
        },
      });
    if (path === '/api/rounds') return route.fulfill({ json: [] });
    if (path === '/api/auth/session')
      return route.fulfill({ json: { session: authenticated ? session : null } });
    if (path === '/api/auth/nonce' && request.method() === 'POST')
      return route.fulfill({
        json: {
          address,
          nonce: 'a'.repeat(64),
          message: 'Forecast Arena sign-in test challenge',
          expiresAt: Date.now() + 300_000,
        },
      });
    if (path === '/api/auth/verify' && request.method() === 'POST') {
      authenticated = true;
      calls.push(request.postDataJSON());
      return route.fulfill({ json: { session } });
    }
    if (path === '/api/auth/logout' && request.method() === 'POST') {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request.' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connect injected wallet' }).click();
  await expect(page.getByText('Signed in as 0x111111...111111')).toBeVisible();
  const walletCalls = await page.evaluate(
    () => (window as Window & { __walletCalls: { method: string }[] }).__walletCalls,
  );
  expect(walletCalls.map((call) => call.method)).toEqual([
    'eth_requestAccounts',
    'eth_chainId',
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain',
    'eth_chainId',
    'personal_sign',
  ]);
  expect(calls).toHaveLength(1);
  expect((calls[0] as { address: string }).address).toBe(address);

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Signed in as 0x111111...111111')).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __emitWalletEvent: (event: string, value: unknown) => void })
      .__emitWalletEvent('accountsChanged', ['0x2222222222222222222222222222222222222222']);
  });
  await expect(page.getByRole('button', { name: 'Connect injected wallet' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('account changed');
  await page.getByRole('button', { name: 'Connect injected wallet' }).click();
  await expect(page.getByText('Signed in as 0x111111...111111')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Connect injected wallet' })).toBeVisible();
});
