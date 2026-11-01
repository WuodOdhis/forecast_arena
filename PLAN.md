# Forecast Arena Mainnet Migration Plan

## Status

Milestones 0 and 1 are complete. A revised contract is deployed on BOT Testnet,
and a staging AI round has completed commit, reveal, settlement, and independent
evidence verification. Experimental injected-wallet sign-in remains
default-off in production. The Worker-side D1 wallet-session adapter and wallet
sign-in are now enabled and live-tested in staging; wallet-signed human
commit/reveal controls remain local only and feature-gated. WalletConnect,
user-created-round UI and indexing, D1-backed round/account history, production
monitoring and recovery drills, and an independent contract review remain open.
The revised contract is not a production release; mainnet user actions remain
disabled.
Announcements and creation of real-user activity remain outside this plan's
autonomous execution.

The authorized Cloudflare account has isolated staging and production D1
databases with migrations 0001 and 0002 applied. The staging Worker is deployed
and health-checked on BOT Testnet. Its successful round was independently
verified against canonical chain data. The live Vercel API proxy still points
to the existing Worker and was not switched.

## Verified repository baseline

- The project is a Vite/React/TypeScript frontend, a shared round engine, a
  Cloudflare Worker with one SQLite-backed Durable Object, a local Express/SQLite
  server, Foundry contracts, and Playwright end-to-end tests.
- `shared/chain.ts` and `shared/arena.ts` currently hardcode BOT testnet chain ID
  968. The local and hosted paths share round logic; transactions are signed by
  the server-side operator.
- `contracts/ForecastArena.sol` does not custody funds. The revised testnet
  contract has separated operator, pauser, and round-creator roles; bounded
  user-created rounds; human commit/reveal; pause controls; and idempotent
  settlement. Outcomes remain operator-reported.
- The frontend has public browsing, local practice, experimental injected-wallet
  sign-in, and local-only wallet commit/reveal controls for existing rounds.
  WalletConnect, user-created-round UI, and persistent human history are not
  implemented.
- Hosted rounds and alarm scheduling remain in Durable Object SQLite. D1 stores
  wallet authentication data in staging; D1 schema also defines account and
  round-related tables, but the application does not yet use them for rounds,
  predictions, settlements, or leaderboards.
- Existing project checks include `npm test`, `npm run contracts:test`,
  `npm run build`, and Playwright tests. Existing e2e includes testnet activity;
  it must not be used to manufacture mainnet activity.
- Existing project documentation is `README.md` and `docs/DEVELOPMENT.md`.

## Verified BOT Chain information

| Network field | Verified value | Evidence |
| --- | --- | --- |
| Mainnet chain ID | `677` (`0x2a5`) | [Official BOT Chain JSON-RPC endpoint documentation](https://dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint/) identifies BOT Mainnet as chain 677; a read-only `eth_chainId` request to the documented RPC returned `0x2a5`. |
| Mainnet RPC | `https://rpc.botchain.ai` | Listed for mainnet in the same [official endpoint documentation](https://dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint/). |
| Mainnet explorer | `https://scan.botchain.ai` | The requested explorer is reachable and identifies itself as the BOT Chain explorer. Its page did not return usable live chain data in this discovery pass. |
| Native token | `BOT` | [Official BOT Chain Quick Guide](https://dev-docs.botchain.ai/docs/Developers/quick-guide/) identifies BOT as the native utility token. |
| Existing testnet | Chain ID `968`; RPC `https://rpc.bohr.life` | Existing repository configuration and the official endpoint documentation. Existing code also uses `tBOT`. |
| Confirmation threshold | 12 blocks, selected as the application's configurable policy | This is not a BOT Chain-published finality guarantee. Keep it configurable per chain and describe it only as the application's confirmation buffer. |

The official RPC documentation says `eth_getLogs` is disabled on mainnet. Mainnet
event indexing and user activity discovery must therefore be designed without
assuming that this RPC can serve logs. Use block/transaction verification or a
separately verified provider only where needed; never silently treat an unavailable
index as empty activity.

## Ecosystem eligibility rules supplied by the user

The user supplied the following general eligibility criteria for projects deployed
from September 1 onward. These requirements are external acceptance conditions,
not facts established by this repository:

1. **Official Twitter and promotion channels:** visible day-to-day activity, with
   at least five valid posts in the last 30 days.
2. **PR link on Twitter (human verified):** the project's own media must publish
   a mainnet-launch announcement explicitly saying it has officially launched on
   BOT Chain mainnet.
3. **Website showcase:** a usable website/DApp footer or ecosystem section shows
   BOT Chain name/logo and links to `https://botchain.ai` and
   `https://scan.botchain.ai`.
4. **Usable product:** people can connect a BOT Chain wallet and complete the
   product's core action.
5. **Independence:** the project must be original, not a mass-produced or
   substantially repackaged template.
6. **Real on-chain activity:** within seven days of launch, at least three
   distinct wallets and five valid core-product interactions; no bots, batch
   wallets, self-transfers, or wash activity.
7. **Continuous operation:** website and product remain reachable and the
   project's social, community, and product channels keep updating.

The supplied policy also states a separate graduation-based eligibility route
for community, meme, and token-led projects. Forecast Arena is a no-betting,
no-token-payment product, so this route is not assumed to apply. The policy's
summary refers to seven criteria while its supplied text also numbers this
conditional eighth item; the checklist will track the seven general criteria and
clearly mark the conditional route as not applicable unless the project category
changes.

## Implementation sequence

Each milestone is gated by focused tests and a short summary of completed work,
remaining risks, and exact reviewer commands. Testnet and local practice behavior
must remain working throughout.

### Milestone 0 — Discovery, plan, and configuration decisions

- Keep this plan as the migration roadmap.
- Record verified chain profiles and explicit application-level confirmation
  policy; keep deployment addresses unset until deployed and verified.
- Preserve the user-supplied ecosystem criteria above and create a checklist
  mapping each general requirement to concrete repo evidence and external proof.
- Inventory required secrets, hosting configuration, and external services before
  enabling production features.

**Gate:** No mainnet profile or launch claim is enabled unless its chain settings
are verified; no external eligibility claim is made without its required evidence.

### Milestone 1 — Typed chain profiles, environments, and feature flags

- Introduce one typed source of truth for testnet and mainnet chain ID, RPC,
  explorer, native currency, and configurable confirmation policy.
- Keep testnet/staging/mainnet settings isolated; fail closed on RPC chain-ID
  mismatch.
- Add environment-scoped feature flags. Mainnet-facing features remain disabled
  until the corresponding contract and service are verified.
- Remove scattered testnet literals by wiring the shared chain client, API,
  worker, deployment tooling, and UI to the profile.
- Preserve testnet and local practice mode.

**Gate:** Type-check/build and unit tests prove both profiles select correctly and
reject a mismatched chain; no mainnet deployment is performed.

**Completed:** `shared/chains.ts` now owns verified testnet, staging, and mainnet
profiles; RPC chain IDs are checked before on-chain operations; confirmation
counts are per-profile configurable (12 by default); mainnet on-chain rounds are
off by default. The Cloudflare environments use separate Durable Object classes.
Deployment tooling now has an explicit mainnet command with an exact confirmation
phrase and a dry-run gas estimate. On 2026-10-31, the operator-controlled
prototype contract was deployed to BOT Chain mainnet at
`0xcd033df00ecf939247c9bcb3c79b7f27ed616c8a` (transaction
`0x003f6df2c84104076d6e6c39b4ef69c7dc9b0c9a56682489a12cf89295738e82`).
Receipt, bytecode, operator, and confirmation count were verified against the
mainnet RPC. This deployment does not enable mainnet rounds or complete the
wallet-driven product migration.

An operator-only E2E test then created, committed, revealed, and settled a
test-labeled round directly on the deployed contract. All four transactions
confirmed and final contract state was checked. The records are explicitly
test activity and do not qualify as real user interactions or satisfy ecosystem
usage criteria. See the transaction links in `docs/DEVELOPMENT.md`.

### Milestone 5 — Initial website compliance work

**Completed:** The app footer and About view show BOT Chain and both required
official links. The About view distinguishes on-chain records, off-chain
processing, and what the chain does not prove. Metadata, canonical URL, SVG
favicon/social card, manifest, robots, and sitemap are present. The mocked
Playwright reviewer test asserts the rendered links, title, About disclosure,
and footer across the app views.

**Still open:** This working tree has not been redeployed. Ecosystem
announcements and Twitter account verification remain external; other
visual/accessibility/compliance checks remain open. The existing public website
and testnet API were checked live on 2026-11-01; those checks do not deploy this
working tree or establish mainnet readiness. The bundled logo was visually
compared with the official BOT Chain site asset.

### Milestone 2 — Contract and deployment tooling

- Design a versioned, non-custodial contract with immutable deployment semantics,
  explicit operator/pauser/round-creator authority, bounded reveal windows,
  permanent missed-reveal/cancel records, and idempotent settlement.
- Bind commitments to round, model, prediction, salt, submitter, and timestamp
  before outcomes are knowable; prohibit replacement.
- Add events and Foundry coverage for authorization, replay, double settlement,
  pause, cancellation, missed reveal, and commit/reveal deadlines.
- Make deployment scripts chain-profile-aware and idempotent; log addresses and
  transaction hashes, write per-chain deployment artifacts, and verify deployed
  bytecode/contract on the correct explorer.
- Add operator transaction retry/replacement handling and a durable dead-letter
  path before settlement automation is enabled.

**Partially implemented locally:** The current contract source adds independent
pauser and round-creator roles, a pause control, bounded public user-round
creation, direct human commit/reveal, missed-reveal records, and idempotent
settlement. Foundry lifecycle and authorization tests pass. This remains an
undeployed prototype: formal review, robust transaction recovery, staging
deployment, and a human-reviewed deployment are still required. The existing
mainnet prototype is unchanged.

**Gate:** Local-chain tests pass; testnet staging lifecycle passes. Mainnet
deployment requires explicit operator approval, a funded operator account, and a
final human review of the exact deployment artifact and transaction.

### Milestone 3 — Measurement evidence and independent verification

- Define observation boundaries using block numbers, persist boundary and included
  block hashes and transaction hashes, and settle only after the configured
  confirmation threshold.
- Make collection reorg-aware and settlement re-runnable without duplicate state.
- Add `npm run verify:round <id>` to independently fetch public RPC data and
  reproduce the outcome; document RPC-only usage and known provider constraints.
- Do not rely on `eth_getLogs` from the official mainnet RPC because BOT Chain
  documentation says it is disabled there.

**Partially implemented locally:** `npm run verify:round -- <round-id>` checks
the published rules/evidence hashes, canonical RPC block hashes and counts,
confirmation depth, settlement receipt, and contract state. It passed against a
settled public BOT Testnet round on 2026-11-01. Independent reorganization
fixtures and repeatable verification on the final staging deployment remain
required.

**Gate:** Deterministic fixtures, local reorg tests, and an independent
verification run against a completed testnet round agree byte-for-byte on the
evidence and outcome.

### Milestone 4 — Wallet authentication and account persistence

- Add wallet connection for injected providers and WalletConnect, including
  wrong-network add/switch flows and explicit disconnect, account-change,
  rejected-signature, locked-wallet, and expired-session states.
- Implement nonce-based, domain/chain/expiry-bound signature authentication,
  single-use replay protection, address rate limits, secure HttpOnly session
  cookies, CSRF defenses, and short-lived API tokens.
- Add D1 schema migrations for users, sessions, rounds, commitments, reveals,
  settlements, evidence, user-created rounds, predictions, leaderboard snapshots,
  and audit records. Use Durable Objects/alarms for per-round serialization and
  recovery.
- Persist every on-chain user action server-side keyed by validated wallet
  address. Support reconnect and cross-device reads; provide wallet-authenticated
  JSON export and account deletion.
- Keep practice data local unless the user explicitly imports it once; imported
  practice records remain distinct from on-chain records and leaderboards.

**Partially completed:** Injected-wallet sign-in remains default-off and
EOA-only. It uses origin-, address-, chain-, and expiry-bound challenges,
single-use signatures, rate limits, revocable HttpOnly cookies, and account
change handling. A typed D1 adapter now persists wallet challenges, rate-limit
attempts, and sessions when `FEATURE_D1_PERSISTENCE=true`; local adapter tests
cover replay, expiry, revocation, and rate limits. The adapter is enabled in the
staging Worker and has passed a live sign-in, session-restore, logout, and
revocation check against D1. Production remains disabled. WalletConnect,
cross-device round/account history, account export/deletion, contract-wallet
signatures, and full browser-to-hosted-Worker verification remain open.

**Partially completed:** Direct injected-wallet human prediction commit/reveal
is implemented locally behind `FEATURE_HUMAN_PREDICTIONS`; it verifies the
connected account and configured chain, checks the commitment against the
contract, stores the reveal secret in browser local storage, submits transactions
from the user's wallet, and waits for receipts. It is not deployed or enabled.
User-created-round UI, durable indexing/history for user rounds, scoring and
leaderboards for human predictions, and live-wallet end-to-end testing remain
open. The D1 schema is a foundation, not a complete D1 application data layer.

**Gate:** Worker/server tests cover auth, replay, CSRF, account changes, persistence,
export/deletion, and restoration across simulated sessions.

### Milestone 5 — Genuine user-driven on-chain activity

- Let connected users create supported experiment rounds and submit their own
  human challenger predictions directly from their wallets.
- Record creator/submitter addresses and score humans on a separate leaderboard.
- Never relay core actions through the operator wallet; do not generate wallets,
  seed activity, or create test usage on mainnet.
- Validate user actions on server and contract, reject duplicate/spam actions, and
  persist and surface rejected attempts without hiding failures.

**Gate:** Local-chain and testnet staging e2e cover wallet-signed create/commit/
reveal/settle and reconnect. Current verified staging evidence covers the
operator-driven AI round lifecycle, not human wallet actions. Mainnet usage criteria require independently
verifiable, voluntary actions by real users and cannot be fabricated or guaranteed
by code changes.

### Milestone 6 — Website compliance and product UX

- Add the BOT Chain name/logo and required `botchain.ai` and `scan.botchain.ai`
  links to every route/footer; test the rendered DOM.
- Add per-chain contract/explorer links and exact transaction links for every
  contract interaction.
- Add the ecosystem section, honest experiment/about page, social metadata,
  favicon assets, robots.txt, sitemap, and canonical URLs.
- Preserve the original product identity and local practice mode. Add accessible
  wallet states, keyboard/focus behavior, reduced motion, responsive layouts, and
  explicit empty/loading/error states.

**Gate:** Build and Playwright checks validate all routes, footer links, wallet
states, metadata, mobile layout, and absence of dead/loading-forever states.

### Milestone 7 — Operations, security, and resilience

- Add website/worker health endpoints, structured request/round IDs, actionable
  error reporting, uptime alert routing, and public status information.
- Use Durable Object alarms with documented backoff/retry and idempotent
  settlement recovery.
- Add Groq budgets/timeouts/fallback policy, per-wallet/global limits, D1 backup
  and tested restore procedures, and operator key rotation runbooks.
- Add strict CORS allowlists, security headers, server-side validation, committed
  secret scanning, dependency audit/lockfile policy, and a threat model.
- Review access control, replay, double settlement, pause/cancel paths, and data
  integrity.

**Gate:** Security-relevant tests, CI checks, backup restore, and documented
incident drills pass before production deployment.

**Partially implemented locally:** A local SQLite backup command, health
endpoints, request IDs, recovery notes, dependency audit, secret scanning, and CI
checks exist. A 15-minute staging health-check workflow and a D1 SQL export
command with an in-memory schema restore rehearsal are included locally. The
workflow is not active on GitHub until pushed. Production alert routing,
data-bearing restore drills, structured operational telemetry, incident drills,
and an independent contract security review remain open.

### Milestone 8 — CI, staging, and launch documentation

- Configure CI for lint/typecheck, unit/worker tests, Foundry, local-chain e2e,
  secret scan, dependency audit, and production build. Gate deployment on green CI.
- Keep the successful BOT Testnet staging lifecycle reproducible as the worker
  and wallet-action changes are deployed; never create synthetic mainnet activity.
- Update README and add DEPLOY, OPERATIONS, ECOSYSTEM_CHECKLIST, LAUNCH, RUNBOOK,
  and SECURITY documentation with claims backed by code and evidence.
- The launch copy, official social posts, actual deployments, and operation of
  the public service require human-controlled credentials and explicit review.

**Gate:** All automated checks pass; staging verification is reproducible; every
public launch statement is true at the time it is published.

## Acceptance evidence and limits

- Mainnet reachability, verified contract address, and end-to-end wallet actions
  can only be claimed after an approved deployment and live verification.
- Three distinct real wallets, five valid interactions, regular official Twitter
  activity, continuous monitoring, and post-launch reachability are external,
  real-world acceptance conditions. The implementation must provide verifiable
  evidence surfaces but must not simulate or promise those outcomes.
- The seven supplied ecosystem criteria can be mapped to repository and external
  evidence, but social posting, human verification, real users, and uptime must be
  demonstrated in the real service rather than inferred from code.
- Do not publish a mainnet URL/address, launch announcement, or claim mainnet
  status until verified against the live network and explorer.
