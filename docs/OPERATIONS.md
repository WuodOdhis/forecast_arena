# Operations and Recovery

## Current readiness

The authorized Cloudflare account has separate staging and production D1
databases, and a testnet staging Worker has completed a verified round lifecycle.
Staging wallet sign-in and D1 authentication are enabled; human prediction
transactions remain disabled there until the frontend/API flow is isolated and
tested. The existing Vercel site still proxies to its original Worker; a live
read-only check currently reports BOT Testnet (chain ID 968), not mainnet.
There is no mainnet deployment, hosted alert destination, or automated cloud
backup/restore. Do not treat staging or the current public site as production
readiness.

## Local SQLite backup

The local database contains round salts and wallet session hashes. Store backups
outside the repository on encrypted storage and restrict access:

```powershell
npm run backup:local -- C:\secure-backups\arena-2026-11-01.sqlite
```

The command refuses to overwrite an existing path and applies owner-only
permissions where the operating system supports them. Never upload an unencrypted
database backup to a public location.

To restore, stop the API, preserve the current `data\arena.sqlite` under a new
name, place a verified backup at `data\arena.sqlite`, and restart the API. Check
`/api/status`, round history, and wallet session behavior before reopening access.
Do not restore a stale copy over a newer database without reviewing the records
that would be lost.

## Cloudflare data and recovery

The Worker continues to store rounds and alarms in Durable Object SQLite so its
serialized round processing is preserved. D1 is bound separately in staging
and mainnet, and migrations `0001_wallet_accounts.sql` and
`0002_wallet_auth_store.sql` define the account/auth schema. A typed D1 adapter
for wallet challenges, rate-limit attempts, and sessions is implemented and
covered by local SQLite-backed adapter tests. It is selected only when
`FEATURE_D1_PERSISTENCE=true`; it is enabled in staging and has passed a live
sign-in, restore, logout, and revocation check. D1 does not yet store rounds,
predictions, settlements, or leaderboard data.

Apply and verify D1 migrations only for the corresponding environment:

```powershell
npx wrangler d1 migrations apply forecast-arena-staging --remote --env staging
npx wrangler d1 migrations list forecast-arena-staging --remote --env staging
```

Never point staging at the production database. Continue testing sign-in,
session restore, logout, expiry, and retry behavior against the staging Worker.
Production D1 remains feature-disabled.

Create a dated D1 SQL export outside the repository and store it on encrypted
storage:

```powershell
npm run backup:d1 -- staging C:\secure-backups\forecast-arena-staging-2026-11-01.sql
```

The command refuses to overwrite a file and rejects paths inside the repository.
Treat the export as sensitive account data. A restore drill must import into a
separate temporary database or local SQLite instance, verify expected tables
and row counts, and preserve the source export; do not test restoration by
overwriting either remote database.

Durable Object alarms schedule recovery checks for active rounds. The alarm is
scheduled before network work and then rescheduled after each run; settlement
operations are guarded by existing round state. This is not a substitute for
testing provider outages, transaction replacement, database recovery, and
reorganization scenarios on staging.

## Staging checks

Use the staging chain profile and separate secrets. These commands validate a
bundle and the contract tests without broadcasting transactions or deploying a
Worker:

```powershell
npm run contracts:test
npm run build
npm run worker:check:staging
```

A staging deployment and operator-driven testnet round have been verified.
Wallet-signed human predictions are implemented locally but are not yet enabled
or tested against the deployed Worker. Never point staging credentials at a
mainnet signer.

## Incident response checklist

1. Disable the affected feature flag and stop public round creation.
2. Record the UTC time, request/round IDs, transaction hashes, RPC endpoint, and
   observed error without copying secrets or wallet private keys into tickets.
3. Preserve database and Worker state before attempting recovery.
4. Verify canonical block hashes, transaction receipts, contract state, and
   evidence independently before retrying settlement.
5. Rotate exposed operator/API credentials using the hosting secret manager.
6. Re-enable access only after a reviewed recovery and a successful staging test.

The CI workflow includes 15-minute checks for the staging Worker and the
unchanged Vercel API proxy; the latter checks `/api/status` because the current
Worker returns 404 for `/api/health`. The Vercel proxy check expects BOT Testnet
chain ID 968 and is availability monitoring only, not a mainnet production
alert. These checks become active only after the workflow is pushed to GitHub.
No independent alert destination is configured. Before a mainnet launch,
provision an external HTTPS monitor for the actual production API, alert on
non-200 or incorrect-chain responses, and retain `X-Request-ID` when reporting
an issue.
