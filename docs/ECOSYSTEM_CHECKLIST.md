# BOT Chain ecosystem eligibility checklist

This checklist tracks the seven general criteria supplied by the project owner.
Passing code checks alone does not establish social, real-user, or uptime
eligibility. A prototype contract is deployed on mainnet, but no public product
launch, qualifying announcement, or qualifying user activity is claimed here.

| # | Requirement | Current evidence | Status |
|---|---|---|---|
| 1 | Official Twitter and promotion channels; visible day-to-day activity and at least five valid posts in the last 30 days | The repository does not yet link a verified official account or provide human-reviewed activity evidence. | Not verified |
| 2 | Human-verified Twitter/publicity link whose mainnet-launch announcement explicitly says the project officially launched on BOT Chain mainnet | A prototype contract is deployed, but the product is not launched and no announcement has been published. Publishing requires a verified live product and account-owner approval. | Not met |
| 3 | Working website/DApp footer or ecosystem section with BOT Chain name/logo and links to [BOT Chain](https://botchain.ai) and [BOT Chain Explorer](https://scan.botchain.ai) | The shared application footer and About view now include the links and BOT Chain mark; the mocked Playwright reviewer test asserts the rendered links. Deployment and live-site verification remain outstanding. | In progress |
| 4 | Usable product: connect a BOT Chain wallet and complete the core product action | Current product supports public browsing and testnet/local rounds, but does not support a user wallet login or user-submitted core actions. | Not met |
| 5 | Original, independent design, product, copy, contracts, and operations; no mass-produced/repackaged project | Forecast Arena has an existing product, contract, custom UI, and operations. An independent similarity assessment is external and has not been performed. | Needs independent review |
| 6 | Within seven days of launch, at least three distinct real wallets and five valid core-product on-chain interactions, without bots, batch wallets, self-transfers, or wash activity | One operator-only E2E test round was created, committed, revealed, and settled to validate the contract. It is explicitly test activity, does not involve three real user wallets, and does not qualify. The mainnet product is not launched. | Not met |
| 7 | Website and product remain reachable after launch, with ongoing updates to Twitter, community, and product | Existing README identifies a Vercel website and Cloudflare Worker. A mainnet uptime/monitoring history and ongoing channel updates have not been established here. | Not verified |

## Separate conditional rule

The supplied policy also describes an internal-market graduation route for
community, meme, and token-led projects. Forecast Arena is a prediction
experiment with no token payments, betting, or prize pool; this route is
currently marked not applicable.

## Chain facts used by this project

- BOT Chain mainnet: chain ID `677`, RPC `https://rpc.botchain.ai`, explorer
  `https://scan.botchain.ai`, native token `BOT`.
- BOT Chain testnet: chain ID `968`, RPC `https://rpc.bohr.life`.
- The app's 12-block evidence confirmation buffer is an application policy, not
  a BOT Chain finality guarantee.

These settings are backed by the [official BOT Chain JSON-RPC endpoint
documentation](https://dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint/)
and the [official quick guide](https://dev-docs.botchain.ai/docs/Developers/quick-guide/).
The official RPC documentation says mainnet `eth_getLogs` is disabled.

## Verification commands

Local project checks, once dependencies and Foundry are available:

```powershell
npm run build
npm test
npm run contracts:test
```

External eligibility evidence must be added only after it exists: verified
account URLs and post dates, the human-verified announcement URL, the live
website and contract links, public transaction hashes from distinct real
wallets, and monitoring history. Never insert example activity as if it were
real.
