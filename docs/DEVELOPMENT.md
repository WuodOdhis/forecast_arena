# Developer Guide

This guide covers running, configuring, and verifying Forecast Arena. For a description of the application, see the [README](../README.md).

## Run locally

Requires Node.js 20+, npm, and Foundry for contracts. Backend tests also use Foundry's `anvil` to verify signed transactions on an isolated local EVM.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API listens on http://127.0.0.1:3001. Both servers are local-only by default.

Without credentials, choose **Local practice**. Two clearly labelled statistical baselines forecast from real recent BOT testnet blocks. Commitments are recorded locally, while outcomes are collected from the real testnet. These are not AI or on-chain rounds.

An initial one-minute practice round takes about two minutes: 20 seconds for commits, 20 seconds for reveals, 60 seconds for observation, then block confirmations and evidence collection. Keep the backend running through the reveal deadline. SQLite preserves rounds and secrets across restarts, but a restart cannot recover a missed deadline.

## Experimental wallet sign-in

The injected-wallet sign-in flow is experimental and disabled by default. It
proves control of an EVM address for the configured chain; it does not grant
operator access. WalletConnect is not implemented.

For local development only, set `FEATURE_WALLET_AUTH=true` in `.env`, restart
the app, and use **Settings → Connect wallet** with a BOT Chain-compatible
injected wallet. The server issues a five-minute, single-use challenge bound to
the address, browser origin, and configured chain ID. It verifies the personal
signature and stores only a hash of the seven-day session token. The browser
receives an HttpOnly, SameSite=Lax cookie; HTTPS deployments add the Secure
attribute. Challenges are limited to five per address per 15 minutes.

Direct human commit/reveal controls for an existing on-chain round are also
experimental and disabled by default. For local testing, enable both
`FEATURE_WALLET_AUTH=true` and `FEATURE_HUMAN_PREDICTIONS=true`. The wallet signs
the contract transactions directly; the app checks the connected address and
chain, verifies the commitment against the contract, and waits for transaction
receipts. The reveal value and salt are stored in that browser's local storage,
not sent to the server. Keep the same browser profile until reveal; clearing
site data before reveal can make the prediction unrevealable. These controls do
not yet support WalletConnect, user-created rounds, cross-device recovery,
human scoring, or a human leaderboard.

The Cloudflare D1 adapter is selected only when
`FEATURE_D1_PERSISTENCE=true`. It persists wallet challenges, address rate-limit
attempts, and wallet sessions; round processing and round records remain in
Durable Object SQLite. The staging Worker has wallet sign-in and D1 persistence
enabled and has passed a live sign-in/restore/logout test. Human prediction
controls are still local code and remain disabled in staging. Production remains
gated: do not enable wallet features until the deployed origin allowlist, HTTPS
cookie behavior, storage, backup/recovery, and contract have been reviewed.

## Enable on-chain AI rounds

Create `.env` using the variable names in [`.env.example`](../.env.example):

- `GROQ_API_KEY`: generate your own free-plan key at https://console.groq.com/keys.
- `DEPLOYER_PRIVATE_KEY`: a dedicated BOT **testnet** account, prefixed with `0x`. Fund its public address at https://faucet.botchain.ai/basic.
- `ARENA_CONTRACT_ADDRESS`: the address produced by deployment below.
- `ADMIN_TOKEN`: optional operator token for authenticated controls. Required before exposing controls through a remote proxy. The Settings screen accepts this access token, not provider or wallet secrets.

The default competitors are `openai/gpt-oss-120b` and `openai/gpt-oss-20b`. Override with `GROQ_MODEL_A` / `GROQ_MODEL_B` if your account's catalog changes. Both receive identical context, a versioned prompt, and temperature 0. API responses identify the reported model; this is operator-attributed provenance, not cryptographic proof of model execution.

```bash
npm run contracts:build
npm run deploy:testnet
```

The testnet command signs a transaction on chain **968 only** and prints its explorer link and contract address. Set `ARENA_CONTRACT_ADDRESS` locally, then restart the backend. The wallet must match the contract's immutable operator. Deployment is not performed automatically at startup.

## Mainnet deployment preflight

The current contract is an operator-controlled prototype: the operator creates
rounds, submits commitments, reports outcomes, and can cancel rounds. It does
not implement wallet-connected human actions, role separation, or the full
production migration described in [PLAN.md](../PLAN.md). Do not treat deploying
this prototype as completing the mainnet launch requirements.

Build and test the reviewed contract before any deployment attempt. A dry run
estimates deployment gas and cost from the selected RPC without signing or
broadcasting:

```powershell
npm run contracts:build
$env:CHAIN_PROFILE = 'mainnet'
$env:MAINNET_DEPLOYER_PRIVATE_KEY = '<load securely in this local shell; never paste it into chat or commit it>'
npm run deploy:check
```

Only after contract review, tests, and an explicit deployment decision, the
separate broadcast command requires an additional exact confirmation phrase:

```powershell
$env:CONFIRM_MAINNET_DEPLOYMENT = 'I understand this deploys ForecastArena on BOT Chain mainnet'
npm run deploy:mainnet
```

The script checks that the selected RPC reports chain ID 677, validates the
build artifact, estimates gas, verifies the configured wallet balance against
the estimated fee, waits for the profile confirmation threshold, and verifies
that code exists at the resulting contract address. The estimate is not a
guaranteed maximum: gas price and execution conditions can change before
broadcast. Use a fresh, dedicated deployment key supplied through a local
secret manager or shell environment; never use a key disclosed in chat.

The operator-controlled prototype contract was deployed on 2026-10-31:

- Address: [`0xcd033df00ecf939247c9bcb3c79b7f27ed616c8a`](https://scan.botchain.ai/address/0xcd033df00ecf939247c9bcb3c79b7f27ed616c8a)
- Deployment transaction: [`0x003f6df2c84104076d6e6c39b4ef69c7dc9b0c9a56682489a12cf89295738e82`](https://scan.botchain.ai/tx/0x003f6df2c84104076d6e6c39b4ef69c7dc9b0c9a56682489a12cf89295738e82)
- Receipt: successful on chain 677 with the app's 12-confirmation buffer met.

The working tree now contains a revised contract implementation with separated
pauser/round-creator controls, pause behavior, bounded public user rounds,
wallet-submitted human commitments, missed-reveal records, and idempotent
settlement. Foundry tests cover these transitions. This is a new artifact; it
does not modify the already deployed prototype. Do not point the running app at a
new contract until a reviewed testnet deployment and end-to-end migration test
have passed.

After a completed on-chain round is published by a reachable API, independently
recompute its rules/evidence hashes and compare every canonical block and
settlement record with the configured RPC:

```powershell
$env:ARENA_API_URL = 'https://your-reviewed-staging-api.example'
$env:CHAIN_PROFILE = 'staging'
npm run verify:round -- '<round-id>'
```

The verifier checks the configured chain ID, observation boundaries, canonical
block hashes and transaction counts, configured confirmation depth, committed
rules/evidence hashes, settlement receipt, and contract state. It requires the
round API and a matching RPC profile to be reachable.

This is a contract deployment for validation, not a public product launch.
Mainnet round creation remains disabled pending completion of the wallet,
persistence, contract, and operations milestones.

### Mainnet contract E2E validation

On 2026-10-31, round `1` was exercised directly against the mainnet contract
with the operator account to validate the supported contract lifecycle. The
round was explicitly marked as a test in its hashed rules; it is not product,
human-wallet, or ecosystem-eligibility activity. All four transactions
confirmed successfully:

| Action | Transaction |
|---|---|
| Create test round | [0x6a477e359add86ffa0f6b96e2da0869202dd7a0ac9b7d7e50e5f063dfe0ec001](https://scan.botchain.ai/tx/0x6a477e359add86ffa0f6b96e2da0869202dd7a0ac9b7d7e50e5f063dfe0ec001) |
| Commit forecast | [0x157613273ef0e90d4fddc5a4517d74995944b2a7c746f6ad75e20a7b3c0a953b](https://scan.botchain.ai/tx/0x157613273ef0e90d4fddc5a4517d74995944b2a7c746f6ad75e20a7b3c0a953b) |
| Reveal forecast | [0x74545089eebe580a0a5e35cedb29ef854dfd6b90ddc9b229c4ebff2d43d45819](https://scan.botchain.ai/tx/0x74545089eebe580a0a5e35cedb29ef854dfd6b90ddc9b229c4ebff2d43d45819) |
| Settle test round | [0x9d057b03af726c3763fa02b428b2ba86a2693dbd979b9dd87e0a7b086a3c88fe](https://scan.botchain.ai/tx/0x9d057b03af726c3763fa02b428b2ba86a2693dbd979b9dd87e0a7b086a3c88fe) |

Final on-chain reads confirmed the forecast was revealed and round `1` was
settled with the test outcome. Total transaction fees were `0.00664676 BOT`.
This validates only the existing operator-controlled contract calls; fresh
wallets cannot create or commit because those methods are restricted to the
operator. The test does not enable mainnet rounds in the application.

The project's current testnet deployment is [`0xcd8da7961c607ad246dfb4a74ba2d07de38df346`](https://scan.bohr.life/address/0xcd8da7961c607ad246dfb4a74ba2d07de38df346). A different operator wallet needs its own contract deployment.

## Chain profiles

`CHAIN_PROFILE` selects `testnet`, `staging`, or `mainnet`; it defaults to
`testnet`. Staging uses BOT testnet chain ID 968 but has separate
`STAGING_DEPLOYER_PRIVATE_KEY`, `STAGING_ARENA_CONTRACT_ADDRESS`, and
`STAGING_BOT_RPC_URL` settings. It does not fall back to the testnet signing key
or contract address.

The verified BOT mainnet profile uses chain ID 677, RPC
[`https://rpc.botchain.ai`](https://dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint/),
explorer [`https://scan.botchain.ai`](https://scan.botchain.ai), and native token
BOT. Its contract and signing key are separately configured through
`MAINNET_ARENA_CONTRACT_ADDRESS` and `MAINNET_DEPLOYER_PRIVATE_KEY`; no mainnet
contract address is configured by this repository. An RPC chain-ID mismatch
fails closed.

Outcome collection waits for 12 confirmations in each profile. This is the
application's configurable safety buffer, not a BOT Chain finality guarantee.
Mainnet on-chain rounds and all new wallet/persistence features are disabled by
default. Feature flags accept only `true` or `false`; profile-specific
`FEATURE_MAINNET_*`, `FEATURE_STAGING_*`, or `FEATURE_TESTNET_*` values override
shared `FEATURE_*` values. Do not enable a mainnet capability until its contract,
storage, and operational prerequisites have passed their launch gates.

Cloudflare deployments have isolated `testnet` (default), `staging`, and
`mainnet` environments. Staging and mainnet use distinct Durable Object classes
and storage namespaces. Set credentials as environment-specific Cloudflare
secrets; never put them in `wrangler.jsonc`:

```powershell
npx wrangler secret put DEPLOYER_PRIVATE_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put STAGING_DEPLOYER_PRIVATE_KEY --env staging
npx wrangler secret put STAGING_ARENA_CONTRACT_ADDRESS --env staging
npx wrangler secret put MAINNET_DEPLOYER_PRIVATE_KEY --env mainnet
npx wrangler secret put MAINNET_ARENA_CONTRACT_ADDRESS --env mainnet
```

Configure `ALLOWED_ORIGINS` and provider secrets independently for each named
environment as required. The provided mainnet environment deliberately has no
contract address or signing secret and sets `FEATURE_MAINNET_ONCHAIN=false`.
Validate the bundles without deploying:

```powershell
npm run worker:check
npm run worker:check:staging
npm run worker:check:mainnet
```

Open an **On-chain AI** round. The backend requests both forecasts before opening the round, then allows 120 seconds to commit and 90 seconds to reveal. Observation starts after reveal closes. A single worker serializes operator transactions. Run one backend instance against the database and operator wallet.

```bash
npm run build
npm start
```

This serves the built interface and API together at http://127.0.0.1:3001.

## Rules and verification

- A round's rules fix its chain, deadlines, observation interval, model metadata, shared input sample, prompt version, evaluator, and scoring.
- Outcomes count **all transactions, including reverted ones**, in canonical blocks whose timestamps satisfy `observationStart <= timestamp < observationEnd`.
- Collection waits until the end boundary has at least 12 successor blocks. This is a confirmation buffer, not an independently verified finality guarantee.
- The prototype's observation window is limited to 1, 5, or 10 minutes, and collection is capped at 6,000 blocks.
- Lowest absolute error wins each round. Ties share wins. The leaderboard separates statistical baselines from AI rounds, groups reported model versions separately, and displays scored rounds and missed reveals.
- Missing reveals are unscored, counted as misses, and remain visible. Cancelled rounds remain in history and do not count toward scores. This first leaderboard is descriptive, not a manipulation-resistant reputation mechanism.

Commitments use:

```text
keccak256(abi.encode(chainId, contractAddress, roundId, agentId, submitter, prediction, randomSalt))
agentId = keccak256(UTF8(agent identifier))
```

`GET /api/rounds` hides prediction values, reasoning, and salts until a successful reveal is recorded. Afterwards, it exposes `revealSalt` and the commitment domain for independent recomputation. Secrets are never placed in rules or frontend configuration.

`GET /api/rounds/:id/rules` returns the exact JSON bytes hashed into `rulesHash`. `GET /api/rounds/:id/evidence` returns the exact settled evidence JSON bytes hashed into `evidenceHash`. Hash UTF-8 response bytes using keccak256. Evidence lists block numbers, hashes, timestamps, transaction counts, boundary blocks, and the total. Verify against an independent RPC if needed.

**Trust model:** the operator submits outcomes and can cancel unsettled rounds. A hash anchors a record; it does not prove its contents are true. RPC counts, model attribution, execution, and outcome publication rely on the operator. There is no trustless oracle or dispute mechanism in this prototype. The contract does not hold funds.

## Checks

```bash
npm test
npm run contracts:test
npm run build
```

With `npm run dev` running, `npm run test:e2e` exercises a real testnet practice round, verifies commitments and evidence digests, checks desktop/mobile rendering, and tests cancellation. It uses system Chrome at `/usr/bin/google-chrome`; override with `CHROME_PATH`. Run it only with no active round, since it creates persistent practice records.

## Storage and hosting

Persist and back up `data/arena.sqlite` together with its WAL files when applicable. It contains unrevealed forecast secrets. Never publish `data/`, `.env`, or wallet keys. A public deployment also needs durable hosting, backups, provider-quota monitoring, HTTPS, and operator authentication.

### Hosted deployment

- Website: https://forecast-arena-flax.vercel.app (Vercel).
- Backend: https://predictbot-api.newtonesila.workers.dev (Cloudflare Workers).
- A single SQLite-backed Durable Object stores rounds and serializes the operator's transactions. Alarms wake it for reveal and settlement; it does not depend on browser polling.
- The local server and hosted worker use the same round engine in `shared/`. The hosted worker collects evidence and submits settlement in separate invocations to stay within the free request budget.
- The Vercel website proxies `/api/*` to Cloudflare. No signing key or model API key is uploaded to Vercel. `.vercelignore` excludes local credentials, databases, and generated artifacts.
- Public `POST /api/rounds` accepts only `{ "mode": "onchain", "duration": 60 }` without a token. It reserves a durable daily quota before model calls, permits one active round, enforces a 60-second cooldown, and caps anonymous attempts at 12 per UTC day across all visitors. Failure does not refund an attempt. Validation failures and requests blocked by an existing active round do not consume quota. The server reports `Retry-After` for exhausted quota or cooldown.
- Other Cloudflare mutations require `ADMIN_TOKEN`, including cancellation, worker retry, and data import. An authenticated operator can use all round modes and durations without spending the public allowance. The token is stored in the local `.env`; enter it in Settings for administrative controls. Never use a wallet private key or Groq API key in that field.
- Public quota is stored in the Durable Object's `public_usage` SQL table, so restarts and deployments do not reset it. The local server uses the same policy and stores its own quota in SQLite.
- Only listed `ALLOWED_ORIGINS` may make browser requests. Public reads do not require an operator token.
- Cloudflare's free tier has usage limits. It does not provide unlimited resources; exceeding free quotas stops the affected operations.

To deploy your own backend, authenticate with `npx wrangler login`, initialize your free `workers.dev` subdomain in the Cloudflare dashboard, and run:

```bash
npm run worker:deploy
ALLOWED_ORIGINS=https://your-website.vercel.app npx tsx scripts/configure-worker.ts
```

The configuration script uploads only the model key, testnet signing key, operator token, and allowed origins to Cloudflare's secret store. It generates an operator token locally if needed without printing it.

Update the API destination in `vercel.json` to your worker URL, then deploy the frontend through your Vercel account. Deploying the source with Vercel does not deploy or update the Cloudflare worker; run `npm run worker:deploy` for backend changes.

`scripts/migrate-rounds.ts` imports closed local rounds into the hosted backend using the operator token. `scripts/check-hosted.ts` creates a real one-minute on-chain round and verifies its automated reveal, outcome evidence, and on-chain settlement. Set `PUBLIC_REVIEW=1` to verify anonymous creation and protected admin endpoints without sending an operator token. The check spends one public attempt in that mode. Both scripts default to this project's worker URL; override with `HOSTED_API_URL` for your own deployment.
