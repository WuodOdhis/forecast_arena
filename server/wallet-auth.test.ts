import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletAuth,
  readWalletSessionCookie,
  walletSessionCookie,
  type WalletAuthStore,
  type WalletChallenge,
  type WalletSession,
} from '../shared/wallet-auth.js';

function memoryStore(): WalletAuthStore {
  const challenges = new Map<string, WalletChallenge>();
  const sessions = new Map<string, WalletSession>();
  const attempts = new Map<string, number[]>();
  return {
    issueChallenge(challenge, limit, windowStart) {
      const recent = (attempts.get(challenge.address) || []).filter((time) => time >= windowStart);
      if (recent.length >= limit) return false;
      attempts.set(challenge.address, [...recent, challenge.issuedAt]);
      challenges.set(challenge.nonceHash, challenge);
      return true;
    },
    findChallenge: (nonceHash) => challenges.get(nonceHash),
    completeLogin(nonceHash, address, now, session) {
      const challenge = challenges.get(nonceHash);
      if (!challenge || challenge.address !== address || challenge.expiresAt <= now) return false;
      challenges.delete(nonceHash);
      sessions.set(session.tokenHash, session);
      return true;
    },
    getSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      return session && session.expiresAt > now ? session : undefined;
    },
    deleteSession: (tokenHash) => void sessions.delete(tokenHash),
  };
}

const origin = 'https://forecast.example';
const alternateOrigin = 'https://other.example';
const developmentOrigin = 'http://localhost:5173';

test('wallet challenge binds address, origin, chain and expiry, then creates a revocable session', async () => {
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const auth = createWalletAuth(memoryStore(), 677, [origin]);
  const now = 1_800_000_000_000;
  const challenge = await auth.issueChallenge(account.address, origin, now);
  assert.match(challenge.message, /Chain ID: 677/);
  assert.match(challenge.message, new RegExp(`URI: ${origin}`));
  assert.match(challenge.message, /Expiration Time:/);

  const signature = await account.signMessage({ message: challenge.message });
  const result = await auth.verify(
    account.address,
    challenge.nonce,
    signature,
    origin,
    now + 1000,
  );
  assert.equal((await auth.session(result.token, now + 2000))?.address, account.address);

  auth.logout(result.token);
  assert.equal(await auth.session(result.token, now + 2000), undefined);
});

test('wallet challenge is single-use, expires, and rejects signatures from another wallet', async () => {
  const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const other = privateKeyToAccount(`0x${'33'.repeat(32)}`);
  const auth = createWalletAuth(memoryStore(), 677, [origin]);
  const now = 1_800_000_000_000;
  const challenge = await auth.issueChallenge(account.address, origin, now);
  const signature = await account.signMessage({ message: challenge.message });
  const result = await auth.verify(account.address, challenge.nonce, signature, origin, now);
  await assert.rejects(
    auth.verify(account.address, challenge.nonce, signature, origin, now),
    /expired or is no longer valid|already been used/,
  );
  assert.ok(result.token);

  const expired = await auth.issueChallenge(account.address, origin, now + 1000);
  const expiredSignature = await account.signMessage({ message: expired.message });
  await assert.rejects(
    auth.verify(account.address, expired.nonce, expiredSignature, origin, now + 301_001),
    /expired or is no longer valid/,
  );

  const mismatched = await auth.issueChallenge(account.address, origin, now + 2000);
  const wrongSignature = await other.signMessage({ message: mismatched.message });
  await assert.rejects(
    auth.verify(account.address, mismatched.nonce, wrongSignature, origin, now + 2000),
    /does not match/,
  );
});

test('wallet auth enforces allowlisted origins and per-address challenge rate limits', async () => {
  const account = privateKeyToAccount(`0x${'44'.repeat(32)}`);
  const auth = createWalletAuth(memoryStore(), 968, [origin, alternateOrigin], true);
  await assert.rejects(
    auth.issueChallenge(account.address, 'https://attacker.example'),
    /not allowed/,
  );
  const originBound = await auth.issueChallenge(account.address, origin);
  const originSignature = await account.signMessage({ message: originBound.message });
  await assert.rejects(
    auth.verify(account.address, originBound.nonce, originSignature, alternateOrigin),
    /expired or is no longer valid/,
  );
  const localAuth = createWalletAuth(memoryStore(), 968, [], true);
  assert.equal(
    (await localAuth.issueChallenge(account.address, developmentOrigin)).address,
    account.address,
  );
  for (let attempt = 1; attempt < 5; attempt++)
    await localAuth.issueChallenge(account.address, developmentOrigin);
  await assert.rejects(
    localAuth.issueChallenge(account.address, developmentOrigin),
    /Too many sign-in requests/,
  );
});

test('session cookies are HttpOnly, SameSite protected and use Secure in production', () => {
  const token = 'ab'.repeat(32);
  const secure = walletSessionCookie(token, true);
  assert.match(secure, /^__Host-forecast_arena_session=/);
  assert.match(secure, /HttpOnly/);
  assert.match(secure, /SameSite=Lax/);
  assert.match(secure, /Secure/);
  assert.equal(
    readWalletSessionCookie(`other=ignored; ${secure.split(';')[0]}`, true),
    token,
  );
  assert.equal(readWalletSessionCookie(`${secure.split(';')[0]}`, false), undefined);
  assert.match(walletSessionCookie('', true, true), /Max-Age=0/);
});
