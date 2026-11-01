import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { privateKeyToAccount } from 'viem/accounts';
import { ArenaWorker, default as workerEntry } from '../cloudflare/worker.js';
import type { DurableObjectState } from '@cloudflare/workers-types';

const appOrigin = 'https://forecast.example';
const otherOrigin = 'https://attacker.example';

function makeSql() {
  const database = new DatabaseSync(':memory:');
  return {
    exec(query: string, ...values: (string | number | null)[]) {
      if (!values.length && !/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)) {
        database.exec(query);
        return { toArray: () => [] };
      }
      const statement = database.prepare(query);
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query))
        return { toArray: () => statement.all(...values) };
      statement.run(...values);
      return { toArray: () => [] };
    },
  };
}

test('Cloudflare auth routes enforce origin, issue sessions, restore and logout', async () => {
  const sql = makeSql();
  const durable = new ArenaWorker(
    {
      storage: {
        sql,
        setAlarm: async () => undefined,
        deleteAlarm: async () => undefined,
      },
    } as unknown as DurableObjectState,
    {
      ARENA: {} as never,
      CHAIN_PROFILE: 'testnet',
      FEATURE_WALLET_AUTH: 'true',
      ALLOWED_ORIGINS: appOrigin,
    },
  );
  const healthState = durable as unknown as {
    network: { connected: boolean; blockNumber?: string; timestamp?: number; checkedAt?: number };
    refreshNetwork: () => Promise<void>;
  };
  healthState.refreshNetwork = async () => {
    healthState.network = { connected: true, blockNumber: '123', timestamp: 100, checkedAt: 100 };
  };
  const env = {
    ARENA: {
      idFromName: () => 'auth-test-object',
      get: () => ({ fetch: (request: Request) => durable.fetch(request) }),
    },
    CHAIN_PROFILE: 'testnet',
    FEATURE_WALLET_AUTH: 'true',
    ALLOWED_ORIGINS: appOrigin,
  } as never;

  const preflight = await workerEntry.fetch(
    new Request('https://api.example/api/auth/nonce', {
      method: 'OPTIONS',
      headers: { Origin: appOrigin },
    }),
    env,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), appOrigin);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(preflight.headers.get('Access-Control-Expose-Headers'), 'X-Request-ID');
  assert.match(preflight.headers.get('X-Request-ID') || '', /^[0-9a-f-]{36}$/);

  const health = await workerEntry.fetch(
    new Request('https://api.example/api/health', { headers: { Origin: appOrigin } }),
    env,
  );
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ready');

  const blocked = await workerEntry.fetch(
    new Request('https://api.example/api/auth/nonce', {
      method: 'POST',
      headers: { Origin: otherOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x1111111111111111111111111111111111111111' }),
    }),
    env,
  );
  assert.equal(blocked.status, 403);

  const account = privateKeyToAccount(`0x${'66'.repeat(32)}`);
  const nonceResponse = await workerEntry.fetch(
    new Request('https://api.example/api/auth/nonce', {
      method: 'POST',
      headers: { Origin: appOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address }),
    }),
    env,
  );
  assert.equal(nonceResponse.status, 200);
  const challenge = (await nonceResponse.json()) as {
    address: string;
    nonce: string;
    message: string;
  };
  const signature = await account.signMessage({ message: challenge.message });
  const verify = await workerEntry.fetch(
    new Request('https://api.example/api/auth/verify', {
      method: 'POST',
      headers: { Origin: appOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    }),
    env,
  );
  assert.equal(verify.status, 200);
  const cookie = verify.headers.get('Set-Cookie');
  assert.ok(cookie?.startsWith('__Host-forecast_arena_session='));

  const restored = await workerEntry.fetch(
    new Request('https://api.example/api/auth/session', {
      headers: { Origin: appOrigin, Cookie: cookie!.split(';')[0]! },
    }),
    env,
  );
  assert.deepEqual((await restored.json()).session.address, account.address);

  const rejectedLogout = await workerEntry.fetch(
    new Request('https://api.example/api/auth/logout', {
      method: 'POST',
      headers: { Origin: otherOrigin, Cookie: cookie!.split(';')[0]! },
    }),
    env,
  );
  assert.equal(rejectedLogout.status, 403);

  const logout = await workerEntry.fetch(
    new Request('https://api.example/api/auth/logout', {
      method: 'POST',
      headers: { Origin: appOrigin, Cookie: cookie!.split(';')[0]! },
    }),
    env,
  );
  assert.equal(logout.status, 200);
  const expired = await workerEntry.fetch(
    new Request('https://api.example/api/auth/session', {
      headers: { Origin: appOrigin, Cookie: cookie!.split(';')[0]! },
    }),
    env,
  );
  assert.equal((await expired.json()).session, null);
});
