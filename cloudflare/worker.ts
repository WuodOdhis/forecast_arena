import type {
  D1Database,
  DurableObjectNamespace,
  DurableObjectState,
  Request as WorkerRequest,
} from '@cloudflare/workers-types';
import { createD1WalletAuthStore } from '../shared/d1-wallet-store.js';
import { createD1AccountStore } from '../shared/d1-account-store.js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createArena, type RoundStore } from '../shared/arena.js';
import { createChain, type ChainConfig } from '../shared/chain.js';
import { digest, phase, publicRound, type Round } from '../shared/domain.js';
import { askModel } from '../shared/models.js';
import {
  PublicAccessError,
  publicRoundStatus,
  readRoundJson,
  reservePublicRound,
  type PublicUsage,
} from '../shared/public-access.js';
import {
  createWalletAuth,
  readWalletSessionCookie,
  walletSessionCookie,
  type WalletAuthStore,
  type WalletChallenge,
  type WalletSession,
  WalletAuthError,
} from '../shared/wallet-auth.js';

interface Env extends ChainConfig {
  ARENA: DurableObjectNamespace;
  DB?: D1Database;
  GROQ_API_KEY?: string;
  GROQ_MODEL_A?: string;
  GROQ_MODEL_B?: string;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
}

function authorized(request: Request, token?: string) {
  if (!token) return false;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const a = Buffer.from(supplied),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const roundInput = z
  .object({
    mode: z.enum(['practice', 'onchain']),
    duration: z.union([z.literal(60), z.literal(300), z.literal(600)]),
  })
  .strict();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    const requestId = crypto.randomUUID();
    const headers = new Headers({
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Request-ID': requestId,
    });
    if (origin && allowed.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Expose-Headers', 'X-Request-ID');
    } else if (origin) {
      return Response.json(
        { error: 'This website is not an allowed origin.' },
        { status: 403, headers },
      );
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST'].includes(request.method))
      return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
    const path = new URL(request.url).pathname;
    const publicCreation =
      path === '/api/rounds' ||
      path.startsWith('/api/account/') ||
      path === '/api/rounds/user-created' ||
      path.startsWith('/api/rounds/user-created/');
    const walletAuthRoute = path.startsWith('/api/auth/');
    if (
      request.method === 'POST' &&
      !publicCreation &&
      !walletAuthRoute &&
      !authorized(request, env.ADMIN_TOKEN)
    ) {
      return Response.json(
        { error: 'Enter the operator access token in Settings.' },
        { status: 401, headers },
      );
    }
    const object = env.ARENA.get(env.ARENA.idFromName('predictbot-arena-v1'));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('X-Request-ID', requestId);
    const forwarded = new Request(request, { headers: requestHeaders });
    const response = await object.fetch(forwarded as unknown as WorkerRequest);
    response.headers.forEach((value, key) => headers.set(key, value));
    return new Response(response.body as unknown as ReadableStream, {
      status: response.status,
      headers,
    });
  },
};

export class ArenaWorker {
  private store: RoundStore;
  private chain: ReturnType<typeof createChain>;
  private arena: ReturnType<typeof createArena>;
  private walletAuthStore: WalletAuthStore;
  private accountStore?: ReturnType<typeof createD1AccountStore>;
  private walletAuth: ReturnType<typeof createWalletAuth>;
  private samples: { block: string; timestamp: number; transactions: number }[] = [];
  private network: {
    connected: boolean;
    blockNumber?: string;
    timestamp?: number;
    checkedAt?: number;
  } = { connected: false };
  private checking?: Promise<void>;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    const sql = ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS public_usage (id INTEGER PRIMARY KEY CHECK(id = 1), body TEXT NOT NULL)',
    );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS wallet_challenges (
        nonce_hash TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        origin TEXT NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    const challengeColumns = sql
      .exec<{ name: string }>('PRAGMA table_info(wallet_challenges)')
      .toArray();
    if (!challengeColumns.some((column) => column.name === 'chain_id'))
      sql.exec('ALTER TABLE wallet_challenges ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 0');
    sql.exec(`
      CREATE TABLE IF NOT EXISTS wallet_auth_attempts (
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS wallet_sessions (
        token_hash TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    const durableWalletAuthStore: WalletAuthStore = {
      issueChallenge: (challenge, limit, windowStart) => {
        sql.exec('DELETE FROM wallet_auth_attempts WHERE created_at < ?', windowStart);
        sql.exec('DELETE FROM wallet_challenges WHERE expires_at <= ?', challenge.issuedAt);
        const attempts = sql
          .exec<{ count: number }>(
            'SELECT COUNT(*) AS count FROM wallet_auth_attempts WHERE address = ? AND created_at >= ?',
            challenge.address,
            windowStart,
          )
          .toArray()[0]?.count ?? 0;
        if (attempts >= limit) return false;
        sql.exec(
          'INSERT INTO wallet_auth_attempts (address, created_at) VALUES (?, ?)',
          challenge.address,
          challenge.issuedAt,
        );
        sql.exec(
          `INSERT INTO wallet_challenges
           (nonce_hash, address, origin, chain_id, message, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          challenge.nonceHash,
          challenge.address,
          challenge.origin,
          challenge.chainId,
          challenge.message,
          challenge.issuedAt,
          challenge.expiresAt,
        );
        return true;
      },
      findChallenge: (nonceHash) => {
        const row = sql
          .exec<{
            nonceHash: string;
            address: string;
            origin: string;
            chainId: number;
            message: string;
            issuedAt: number;
            expiresAt: number;
          }>(
            `SELECT nonce_hash AS nonceHash, address, origin, chain_id AS chainId, message,
                    issued_at AS issuedAt, expires_at AS expiresAt
             FROM wallet_challenges WHERE nonce_hash = ?`,
            nonceHash,
          )
          .toArray()[0];
        return row as WalletChallenge | undefined;
      },
      completeLogin: (nonceHash, address, now, session) => {
        const challenge = sql
          .exec(
            'SELECT nonce_hash FROM wallet_challenges WHERE nonce_hash = ? AND address = ? AND expires_at > ?',
            nonceHash,
            address,
            now,
          )
          .toArray()[0];
        if (!challenge) return false;
        sql.exec('DELETE FROM wallet_challenges WHERE nonce_hash = ?', nonceHash);
        sql.exec('DELETE FROM wallet_sessions WHERE expires_at <= ?', now);
        sql.exec(
          'INSERT INTO wallet_sessions VALUES (?, ?, ?, ?)',
          session.tokenHash,
          session.address,
          session.createdAt,
          session.expiresAt,
        );
        return true;
      },
      getSession: (tokenHash, now) => {
        const session = sql
          .exec<{
            tokenHash: string;
            address: string;
            createdAt: number;
            expiresAt: number;
          }>(
            'SELECT token_hash AS tokenHash, address, created_at AS createdAt, expires_at AS expiresAt FROM wallet_sessions WHERE token_hash = ? AND expires_at > ?',
            tokenHash,
            now,
          )
          .toArray()[0];
        if (!session) sql.exec('DELETE FROM wallet_sessions WHERE token_hash = ?', tokenHash);
        return session as WalletSession | undefined;
      },
      deleteSession: (tokenHash) => {
        sql.exec('DELETE FROM wallet_sessions WHERE token_hash = ?', tokenHash);
      },
    };
    this.chain = createChain(env);
    if (this.chain.features.d1Persistence) {
      if (!env.DB) throw new Error('D1 persistence is enabled but the DB binding is missing.');
      this.walletAuthStore = createD1WalletAuthStore(env.DB);
      this.accountStore = createD1AccountStore(env.DB);
    } else {
      this.walletAuthStore = durableWalletAuthStore;
    }
    this.store = {
      save: (round) => {
        sql.exec(
          'INSERT INTO rounds VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
          round.id,
          round.createdAt,
          JSON.stringify(round),
        );
      },
      all: () =>
        sql
          .exec<{ body: string }>('SELECT body FROM rounds ORDER BY created_at DESC, rowid DESC')
          .toArray()
          .map((r) => JSON.parse(r.body)),
      get: (id) => {
        const row = sql
          .exec<{ body: string }>('SELECT body FROM rounds WHERE id = ?', id)
          .toArray()[0];
        return row ? JSON.parse(row.body) : undefined;
      },
    };
    this.walletAuth = createWalletAuth(
      this.walletAuthStore,
      this.chain.profile.chainId,
      (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
      true,
    );
    this.arena = createArena(
      this.store,
      this.chain,
      { ...env, deferSettlement: true },
      (model, context, seconds) =>
        askModel(model, context, seconds, env.GROQ_API_KEY, this.chain.profile.name),
    );
  }

  private publicUsage(): PublicUsage | undefined {
    const row = this.ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM public_usage WHERE id = 1')
      .toArray()[0];
    return row ? JSON.parse(row.body) : undefined;
  }

  private publicEnabled() {
    return Boolean(
      this.env.GROQ_API_KEY &&
        this.chain.credentialsConfigured.wallet &&
        this.chain.credentialsConfigured.contract &&
        (this.chain.profile.id !== 'mainnet' || this.chain.features.mainnetOnchain),
    );
  }

  private async refreshNetwork() {
    if (this.checking) return this.checking;
    if (this.network.checkedAt && Date.now() - this.network.checkedAt < 15_000) return;
    this.checking = (async () => {
      try {
        const [chainId, block] = await Promise.all([
          this.chain.rpc.getChainId(),
          this.chain.rpc.getBlock(),
        ]);
        this.network = {
          connected: chainId === this.chain.profile.chainId,
          blockNumber: block.number.toString(),
          timestamp: Number(block.timestamp),
          checkedAt: Date.now(),
        };
        if (this.samples.at(-1)?.block !== block.number.toString()) {
          this.samples.push({
            block: block.number.toString(),
            timestamp: Number(block.timestamp),
            transactions: block.transactions.length,
          });
          if (this.samples.length > 40) this.samples.shift();
        }
      } catch {
        this.network = { connected: false, checkedAt: Date.now() };
      }
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async schedule() {
    const active = this.store.all().find((r) => !['SETTLED', 'CANCELLED'].includes(phase(r)));
    if (!active) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const state = phase(active);
    let wake = now + 5000;
    if (state === 'COMMIT' && active.forecasts.every((f) => f.committedAt))
      wake = active.commitDeadline * 1000;
    else if (state === 'REVEAL' && active.forecasts.every((f) => f.revealedAt || f.failure))
      wake = active.observationEnd * 1000 + 12_000;
    else if (state === 'OBSERVING') wake = active.observationEnd * 1000 + 12_000;
    await this.ctx.storage.setAlarm(Math.max(now + 1000, wake));
  }

  async alarm() {
    // Schedule recovery before doing network work so an interrupted invocation can resume.
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    try {
      await this.arena.exclusive(() => this.arena.tick());
    } finally {
      await this.schedule();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === 'GET' && path === '/api/health') {
        await this.refreshNetwork();
        const ready = this.network.connected;
        return Response.json(
          {
            status: ready ? 'ready' : 'degraded',
            network: this.network,
            chainId: this.chain.profile.chainId,
            networkName: this.chain.profile.name,
          },
          { status: ready ? 200 : 503 },
        );
      }
      if (path.startsWith('/api/auth/')) {
        if (!this.chain.features.walletAuth)
          return Response.json(
            { error: 'Wallet sign-in is disabled in this environment.' },
            { status: 404 },
          );
        const secure = new URL(request.url).protocol === 'https:';
        const cookieToken = () =>
          readWalletSessionCookie(request.headers.get('cookie'), secure);
        const origin = () => {
          const value = request.headers.get('origin');
          if (!value) throw new WalletAuthError('A browser origin is required.', 403);
          return this.walletAuth.validateOrigin(value);
        };
        if (request.method === 'GET' && path === '/api/auth/session') {
          return Response.json({ session: (await this.walletAuth.session(cookieToken())) ?? null });
        }
        if (request.method === 'POST' && path === '/api/auth/nonce') {
          const input = z.object({ address: z.string().min(1).max(64) }).strict().parse(
            await readRoundJson(request),
          );
          return Response.json(await this.walletAuth.issueChallenge(input.address, origin()));
        }
        if (request.method === 'POST' && path === '/api/auth/verify') {
          const input = z
            .object({
              address: z.string().min(1).max(64),
              nonce: z.string().regex(/^[0-9a-f]{64}$/),
              signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/),
            })
            .strict()
            .parse(await readRoundJson(request));
          const { token, address, expiresAt } = await this.walletAuth.verify(
            input.address,
            input.nonce,
            input.signature as `0x${string}`,
            origin(),
          );
          return Response.json(
            { session: { address, expiresAt } },
            {
              headers: {
                'Set-Cookie': walletSessionCookie(token, secure),
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        if (request.method === 'POST' && path === '/api/auth/logout') {
          origin();
          await this.walletAuth.logout(cookieToken());
          return Response.json(
            { ok: true },
            {
              headers: {
                'Set-Cookie': walletSessionCookie('', secure, true),
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        return Response.json({ error: 'Not found.' }, { status: 404 });
      }
      if (path.startsWith('/api/account/')) {
        if (!this.chain.features.walletAuth || !this.accountStore)
          return Response.json(
            { error: 'Persistent wallet accounts are disabled in this environment.' },
            { status: 404 },
          );
        const secure = new URL(request.url).protocol === 'https:';
        const token = readWalletSessionCookie(request.headers.get('cookie'), secure);
        const session = await this.walletAuth.session(token);
        if (!session)
          return Response.json({ error: 'Sign in with your wallet to manage account data.' }, { status: 401 });
        if (request.method === 'GET' && path === '/api/account/export') {
          const account = await this.accountStore.export(session.address);
          if (!account)
            return Response.json({ error: 'Wallet account was not found.' }, { status: 404 });
          return Response.json(account, {
            headers: {
              'Content-Disposition': `attachment; filename="forecast-arena-account-${session.address.toLowerCase()}.json"`,
              'Cache-Control': 'no-store',
            },
          });
        }
        if (request.method === 'POST' && path === '/api/account/delete') {
          const value = request.headers.get('origin');
          if (!value) throw new WalletAuthError('A browser origin is required.', 403);
          this.walletAuth.validateOrigin(value);
          z.object({ confirm: z.literal(true) }).strict().parse(await readRoundJson(request));
          if (!(await this.accountStore.delete(session.address)))
            return Response.json({ error: 'Wallet account was not found.' }, { status: 404 });
          return Response.json(
            { deleted: true, publicChainRecordsRetained: true },
            {
              headers: {
                'Set-Cookie': walletSessionCookie('', secure, true),
                'Cache-Control': 'no-store',
              },
            },
          );
        }
        return Response.json({ error: 'Not found.' }, { status: 404 });
      }
      if (request.method === 'GET' && path === '/api/status') {
        await this.refreshNetwork();
        return Response.json({
          network: this.network,
          samples: this.samples,
          configured: {
            groq: Boolean(this.env.GROQ_API_KEY),
            ...this.chain.credentialsConfigured,
          },
          authRequired: true,
          permissions: { operator: authorized(request, this.env.ADMIN_TOKEN) },
          publicRounds: { ...publicRoundStatus(this.publicUsage()), enabled: this.publicEnabled() },
          chainId: this.chain.profile.chainId,
          networkName: this.chain.profile.name,
          chainProfile: this.chain.profile.id,
          explorer: this.chain.profile.explorerBaseUrl,
          features: this.chain.features,
          contract: this.chain.arenaAddress,
          serverTime: Date.now(),
          hosting: 'cloudflare',
        });
      }
      if (request.method === 'GET' && path === '/api/rounds')
        return Response.json(this.store.all().map((r) => publicRound(r)));
      const match = /^\/api\/rounds\/([^/]+)\/(rules|evidence)$/.exec(path);
      if (request.method === 'GET' && match) {
        const round = this.store.get(match[1]);
        if (!round || (match[2] === 'evidence' && (round.outcome === undefined || !round.evidence)))
          return Response.json({ error: 'Record not available.' }, { status: 404 });
        return new Response(match[2] === 'rules' ? round.rules : JSON.stringify(round.evidence), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (request.method === 'POST') {
        if (path === '/api/rounds') {
          const input = roundInput.parse(await readRoundJson(request));
          const round = await this.arena.exclusive(async () => {
            if (!authorized(request, this.env.ADMIN_TOKEN)) {
              const usage = reservePublicRound(
                input,
                this.publicUsage(),
                this.store.all().some((r) => !['SETTLED', 'CANCELLED'].includes(phase(r))),
                this.publicEnabled(),
              );
              // Reserve before model calls; failed attempts still consume the bounded public budget.
              this.ctx.storage.sql.exec(
                'INSERT INTO public_usage VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
                JSON.stringify(usage),
              );
            }
            await this.ctx.storage.setAlarm(Date.now() + 30_000);
            try {
              return await this.arena.createRound(input.mode, input.duration);
            } finally {
              await this.schedule();
            }
          });
          return Response.json(publicRound(round), { status: 201 });
        }
        if (!authorized(request, this.env.ADMIN_TOKEN))
          return Response.json({ error: 'Operator authentication required.' }, { status: 401 });
        const cancel = /^\/api\/rounds\/([^/]+)\/cancel$/.exec(path);
        if (cancel) {
          await this.arena.exclusive(async () => {
            await this.arena.cancelRound(cancel[1]);
            await this.schedule();
          });
          return Response.json({ ok: true });
        }
        if (path === '/api/worker/retry') {
          await this.arena.exclusive(async () => {
            await this.arena.tick();
            await this.schedule();
          });
          return Response.json({ ok: true });
        }
        if (path === '/api/operator/import') {
          const records = z
            .array(
              z
                .object({
                  id: z.string(),
                  mode: z.enum(['practice', 'onchain']),
                  createdAt: z.number().int(),
                  cancelled: z.boolean(),
                  rules: z.string(),
                  rulesHash: z.string(),
                  forecasts: z.array(z.unknown()),
                  activity: z.array(z.unknown()),
                })
                .passthrough(),
            )
            .max(100)
            .parse(await request.json()) as unknown as Round[];
          await this.arena.exclusive(async () => {
            for (const round of records) {
              if (
                !['SETTLED', 'CANCELLED'].includes(phase(round)) ||
                digest(round.rules) !== round.rulesHash
              )
                throw new Error('Only closed rounds with matching rules can be imported.');
              if (round.evidence && digest(JSON.stringify(round.evidence)) !== round.evidenceHash)
                throw new Error('Evidence hash mismatch.');
            }
            for (const round of records) if (!this.store.get(round.id)) this.store.save(round);
          });
          return Response.json({ imported: records.length });
        }
      }

      return Response.json({ error: 'Not found.' }, { status: 404 });
    } catch (error) {
      if (error instanceof PublicAccessError) {
        const headers = new Headers();
        if (error.retryAt)
          headers.set(
            'Retry-After',
            String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))),
          );
        return Response.json(
          { error: error.message, retryAt: error.retryAt },
          { status: error.status, headers },
        );
      }
      if (error instanceof WalletAuthError)
        return Response.json({ error: error.message }, { status: error.status });
      if (!(error instanceof z.ZodError))
        console.error(
          JSON.stringify({
            event: 'worker_request_failed',
            requestId: request.headers.get('x-request-id'),
            route: path,
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      const message =
        error instanceof z.ZodError
          ? 'Invalid request.'
          : error instanceof Error
            ? error.message.split('\n')[0].slice(0, 240)
            : 'Request failed.';
      return Response.json({ error: message }, { status: 400 });
    }
  }

}

export class StagingArenaWorker extends ArenaWorker {}

export class MainnetArenaWorker extends ArenaWorker {}
