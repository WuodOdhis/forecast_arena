# Forecast Arena Mainnet Migration Plan

## Status

Milestones 0 and 1 are complete. Milestone 5's website-compliance work has
started. Contract migration, wallet authentication, D1 persistence, user-driven
on-chain actions, production operations, and independent verification remain
open. A standalone prototype contract has been deployed on BOT Chain mainnet for
validation; this is not a product launch. Announcements and creation of
real-user activity remain outside this plan's autonomous execution.

## Verified repository baseline

- The project is a Vite/React/TypeScript frontend, a shared round engine, a
  Cloudflare Worker with one SQLite-backed Durable Object, a local Express/SQLite
  server, Foundry contracts, and Playwright end-to-end tests.
- `shared/chain.ts` and `shared/arena.ts` currently hardcode BOT testnet chain ID
  968. The local and hosted paths share round logic; transactions are signed by
  the server-side operator.
- `contracts/ForecastArena.sol` is operator-controlled and does not custody
  funds. It has commit/reveal and cancellation, but no user-created rounds,
  user-submitted predictions, role separation, pause controls, or reorg-aware
  settlement.
- The frontend has public browsing and local practice mode, but no injected or
  WalletConnect wallet integration, user identity, or wallet-authenticated
  history.
- Local storage is SQLite; hosted on-chain state is stored as serialized round
  records in a Durable Object. There are no D1 migrations or per-wallet records.
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

**Still open:** The website has not been redeployed or verified live; the official
BOT logo asset has not been obtained; ecosystem announcements and Twitter account
verification remain external; other visual/accessibility/compliance checks remain
open.

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
reveal/settle and reconnect. Mainnet usage criteria require independently
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

### Milestone 8 — CI, staging, and launch documentation

- Configure CI for lint/typecheck, unit/worker tests, Foundry, local-chain e2e,
  secret scan, dependency audit, and production build. Gate deployment on green CI.
- Complete a testnet staging lifecycle that mirrors the final contract and worker
  configuration without creating synthetic mainnet activity.
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
