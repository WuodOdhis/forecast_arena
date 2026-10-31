import { test, expect } from '@playwright/test';

test('mainnet status is labeled correctly and does not show testnet faucet actions', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/status') {
      return route.fulfill({
        json: {
          network: { connected: true, blockNumber: '1234' },
          configured: { groq: false, wallet: false, contract: false },
          features: {
            mainnetOnchain: false,
            walletAuth: false,
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
          samples: [{ block: '1234', timestamp: 1_798_900_000, transactions: 2 }],
        },
      });
    }
    if (path === '/api/rounds') return route.fulfill({ json: [] });
    return route.fulfill({ status: 405 });
  });

  await page.goto('/');
  await expect(page.getByText('Latest BOT Chain block')).toBeVisible();
  await expect(page.getByText('TRANSACTION COUNT / BOT CHAIN')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Transactions per sampled BOT Chain block' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Mainnet operator (server-managed)')).toBeVisible();
  await expect(page.getByText('Missing MAINNET_DEPLOYER_PRIVATE_KEY')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open testnet faucet' })).toHaveCount(0);
});

test('reviewer opens a fixed AI round without credentials; admin controls require verified permission', async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000);
  let round: unknown;
  let submitted: unknown;
  let creationAuthorization: string | undefined;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/status') {
      return route.fulfill({
        json: {
          network: { connected: true, blockNumber: '1234' },
          configured: { groq: true, wallet: true, contract: true },
          features: {
            mainnetOnchain: false,
            walletAuth: false,
            userCreatedRounds: false,
            humanPredictions: false,
            d1Persistence: false,
          },
          authRequired: true,
          permissions: { operator: request.headers().authorization === 'Bearer test-admin' },
          publicRounds: {
            enabled: true,
            mode: 'onchain',
            duration: 60,
            dailyLimit: 12,
            remaining: round ? 11 : 12,
            retryAt: null,
          },
          contract: '0x1111111111111111111111111111111111111111',
          chainId: 968,
          networkName: 'BOT Testnet',
          chainProfile: 'testnet',
          explorer: 'https://scan.bohr.life',
          serverTime: Date.now(),
          samples: [{ block: '1234', timestamp: now, transactions: 2 }],
        },
      });
    }
    if (path === '/api/rounds' && request.method() === 'POST') {
      submitted = request.postDataJSON();
      creationAuthorization = request.headers().authorization;
      round = {
        id: 'test-round',
        mode: 'onchain',
        createdAt: now,
        commitDeadline: now + 120,
        revealDeadline: now + 210,
        observationStart: now + 210,
        observationEnd: now + 270,
        rules: '{}',
        rulesHash: `0x${'11'.repeat(32)}`,
        cancelled: false,
        phase: 'COMMIT',
        lastError: 'Test worker status',
        activity: [],
        forecasts: ['gpt-oss-120b', 'gpt-oss-20b'].map((name, i) => ({
          id: String(i),
          name,
          kind: 'model',
          committedAt: now,
          commitment: `0x${'22'.repeat(32)}`,
        })),
      };
      return route.fulfill({ status: 201, json: round });
    }
    if (path === '/api/rounds') return route.fulfill({ json: round ? [round] : [] });
    return route.fulfill({ status: 401, json: { error: 'Operator authentication required.' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Forecast Arena', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'BOT Chain', exact: true })).toHaveAttribute(
    'href',
    'https://botchain.ai',
  );
  await expect(page.getByRole('img', { name: 'BOT Chain', exact: true })).toHaveAttribute(
    'src',
    '/botchain-logo.png',
  );
  await expect(page.getByRole('link', { name: 'Explorer', exact: true })).toHaveAttribute(
    'href',
    'https://scan.botchain.ai',
  );
  await expect(page).toHaveTitle('Forecast Arena | BOT Chain Experiment');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Forecast Arena | BOT Chain Experiment',
  );
  await page.getByRole('button', { name: 'About the experiment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What this experiment measures' })).toBeVisible();
  await expect(
    page.getByText(/They do not prove which AI generated a forecast/),
  ).toBeVisible();
  for (const route of ['Arena', 'Round history', 'Leaderboard', 'Settings']) {
    await page.getByRole('button', { name: route, exact: true }).click();
    await expect(page.getByRole('link', { name: 'BOT Chain', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explorer', exact: true })).toBeVisible();
  }
  await expect(page.getByText('12 / 12')).toBeVisible();
  await page.getByRole('button', { name: 'New round', exact: true }).click();
  await expect(page.getByText('On-chain AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toBeDisabled();
  await expect(page.getByRole('combobox')).toHaveValue('60');
  await expect(page.getByRole('button', { name: /Local practice/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open round', exact: true }).click();
  await expect(page.getByText('Sealed forecast')).toHaveCount(2);
  await expect(page.getByText('Round in progress', { exact: true })).toBeVisible();
  expect(submitted).toEqual({ mode: 'onchain', duration: 60 });
  expect(creationAuthorization).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Cancel round', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry round worker', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Operator access token').fill('not-an-admin');
  await page
    .getByRole('button', { name: 'Save access token for this session', exact: true })
    .click();
  await expect(page.getByText('Token not recognized')).toBeVisible();
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel round', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Operator access token').fill('test-admin');
  await page
    .getByRole('button', { name: 'Save access token for this session', exact: true })
    .click();
  await expect(page.getByText('Operator verified')).toBeVisible();
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel round', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry round worker', exact: true })).toBeVisible();
});
