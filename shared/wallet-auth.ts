import { getAddress, isAddress, keccak256, recoverMessageAddress, toBytes } from 'viem';

export interface WalletChallenge {
  nonceHash: string;
  address: `0x${string}`;
  origin: string;
  chainId: number;
  message: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WalletSession {
  tokenHash: string;
  address: `0x${string}`;
  createdAt: number;
  expiresAt: number;
}

export interface WalletAuthStore {
  issueChallenge(
    challenge: WalletChallenge,
    limit: number,
    windowStart: number,
  ): boolean | Promise<boolean>;
  findChallenge(nonceHash: string): WalletChallenge | undefined | Promise<WalletChallenge | undefined>;
  completeLogin(
    nonceHash: string,
    address: string,
    now: number,
    session: WalletSession,
  ): boolean | Promise<boolean>;
  getSession(tokenHash: string, now: number): WalletSession | undefined | Promise<WalletSession | undefined>;
  deleteSession(tokenHash: string): void | Promise<void>;
}

export class WalletAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WalletAuthError';
  }
}

const challengeLifetime = 5 * 60_000;
const sessionLifetime = 7 * 24 * 60 * 60_000;
const rateWindow = 15 * 60_000;
const challengeLimit = 5;

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (part) => part.toString(16).padStart(2, '0')).join('');
}

export function hashWalletAuthToken(value: string): string {
  return keccak256(toBytes(value));
}

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-forecast_arena_session' : 'forecast_arena_session';
}

export function walletSessionCookie(token: string, secure: boolean, clear = false): string {
  const name = sessionCookieName(secure);
  return [
    `${name}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${clear ? 0 : sessionLifetime / 1000}`,
  ].join('; ');
}

export function readWalletSessionCookie(cookie: string | null, secure: boolean): string | undefined {
  const name = sessionCookieName(secure);
  for (const part of cookie?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name && value.length === 1 && /^[0-9a-f]{64}$/.test(value[0]))
      return value[0];
  }
  return undefined;
}

export function createWalletAuth(
  store: WalletAuthStore,
  chainId: number,
  allowedOrigins: string[],
  development = false,
) {
  function assertOrigin(originValue: string): string {
    let origin: URL;
    try {
      origin = new URL(originValue);
    } catch {
      throw new WalletAuthError('A valid browser origin is required.', 400);
    }
    if (
      origin.origin !== originValue ||
      origin.username ||
      origin.password ||
      !['https:', ...(development ? ['http:'] : [])].includes(origin.protocol)
    )
      throw new WalletAuthError('The browser origin is invalid.', 400);
    const localOrigin =
      development &&
      origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(origin.hostname);
    if (!localOrigin && !allowedOrigins.includes(origin.origin))
      throw new WalletAuthError('This website is not allowed to start wallet sign-in.', 403);
    return origin.origin;
  }

  async function issueChallenge(addressValue: string, originValue: string, now = Date.now()) {
    if (!isAddress(addressValue))
      throw new WalletAuthError('Connect a valid EVM wallet address.', 400);
    const address = getAddress(addressValue);
    const origin = assertOrigin(originValue);
    const nonce = randomHex(32);
    const issuedAt = now;
    const expiresAt = now + challengeLifetime;
    const message = [
      `${new URL(origin).host} wants you to sign in to Forecast Arena.`,
      '',
      'Sign in with your BOT Chain wallet. This signature does not send a transaction.',
      '',
      `Address: ${address}`,
      `URI: ${origin}`,
      'Version: 1',
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(issuedAt).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');
    const challenge: WalletChallenge = {
      nonceHash: hashWalletAuthToken(nonce),
      address,
      origin,
      chainId,
      message,
      issuedAt,
      expiresAt,
    };
    if (!(await store.issueChallenge(challenge, challengeLimit, now - rateWindow)))
      throw new WalletAuthError('Too many sign-in requests. Wait 15 minutes and try again.', 429);
    return { address, nonce, message, expiresAt };
  }

  async function verify(
    addressValue: string,
    nonce: string,
    signature: `0x${string}`,
    originValue: string,
    now = Date.now(),
  ) {
    if (!isAddress(addressValue) || !/^[0-9a-f]{64}$/.test(nonce))
      throw new WalletAuthError('The wallet sign-in challenge is invalid.', 400);
    const address = getAddress(addressValue);
    const origin = assertOrigin(originValue);
    const nonceHash = hashWalletAuthToken(nonce);
    const challenge = await store.findChallenge(nonceHash);
    if (
      !challenge ||
      challenge.address !== address ||
      challenge.origin !== origin ||
      challenge.expiresAt <= now
    )
      throw new WalletAuthError('The sign-in challenge expired or is no longer valid.', 401);

    let recovered: string;
    try {
      recovered = getAddress(await recoverMessageAddress({ message: challenge.message, signature }));
    } catch {
      throw new WalletAuthError('The wallet signature could not be verified.', 401);
    }
    if (recovered !== address)
      throw new WalletAuthError('The signature does not match the connected wallet.', 401);

    const token = randomHex(32);
    const session: WalletSession = {
      tokenHash: hashWalletAuthToken(token),
      address,
      createdAt: now,
      expiresAt: now + sessionLifetime,
    };
    if (!(await store.completeLogin(nonceHash, address, now, session)))
      throw new WalletAuthError('This sign-in challenge has already been used.', 401);
    return { token, address: session.address, expiresAt: session.expiresAt };
  }

  async function session(token: string | undefined, now = Date.now()) {
    if (!token) return undefined;
    const record = await store.getSession(hashWalletAuthToken(token), now);
    return record ? { address: record.address, expiresAt: record.expiresAt } : undefined;
  }

  async function logout(token: string | undefined) {
    if (token) await store.deleteSession(hashWalletAuthToken(token));
  }

  return { issueChallenge, verify, session, logout, validateOrigin: assertOrigin };
}
