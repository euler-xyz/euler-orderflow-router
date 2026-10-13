# Token-list coverage

Coverage was checked against the production `https://v3.euler.finance/v3/tokens` catalog on 2026-10-12. The comparison used the complete paginated catalogs, including address-filtered queries for custom-token exceptions.

## Routing metadata

| Chain | V3 tokens | Routing records checked | Field differences |
| --- | ---: | ---: | ---: |
| 1 | 2171 | 97 | 0 |
| 56 | 453 | 2 | 0 |
| 130 | 136 | 1 | 0 |
| 143 | 303 | 2 | 0 |
| 999 | 144 | 1 | 0 |
| 8453 | 1010 | 8 | 0 |
| 9745 | 359 | 14 | 0 |
| 42161 | 432 | 11 | 0 |
| 43114 | 552 | 2 | 0 |
| 59144 | 194 | 0 | 0 |

All 138 routing records on these ten chains match the snapshot metadata. The comparison includes Pendle PT/LP flags and market addresses, along with `poolId` where present. No Spectra or cross-chain Pendle metadata records were present in the snapshots, so those integrations were not independently covered by this comparison.

The runtime retains all upstream metadata. ERC-20 on-chain lookup supplies name, symbol and decimals; it cannot reconstruct protocol routing metadata.

## Custom Monad tokens

| Address | Token | V3 coverage |
| --- | --- | --- |
| `0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b` | Balancer BPT wnAUSD / wnUSDC / wnUSDT0 | Present; upstream name and symbol take priority |
| `0x4e8aaecCE10ad9394e96fE5f2bd4e587A7B04298` | wnUSDT0 | Absent |
| `0x82c370ba90E38ef6Acd8b1b078d34fD86FC6bAC9` | wnAUSD | Absent |
| `0x8d5c2Df3Eef09088Fcccf3376D8EcD0Dd505f642` | wnUSDC | Absent |

The four-entry compiled custom overlay preserves these assets without filesystem access. It applies only after a configured Monad catalog loads, and does not override V3 entries. The three absent wrappers are also the only snapshot tokens missing from the ten supported V3 catalogs. Cache-only inner-token lookups in routing are a reason to keep this overlay while those tokens are absent upstream.

## Deployment coverage

The default V3 endpoint returns HTTP 404 `CHAIN_NOT_SUPPORTED` for:

- Sonic: `146`
- TAC: `239`
- BOB: `60808`
- Berachain: `80094`

These four chains account for 110 snapshot tokens, including 23 metadata records. This audit cannot establish their V3 routing coverage.

Before deployment, compare the configured RPC chains with the deployed token-list source coverage. A configured chain using an unsupported endpoint prevents startup. Each such chain needs upstream catalog support or a suitable per-chain endpoint. Changing which chains the service supports is an explicit deployment decision.

Catalog coverage is not proof of swap execution. Live fork swaps were not run as part of this audit.

## Automatic source audit (2026-10-13)

DefiLlama publishes a usable per-chain catalog at `https://d3g10bzo9rdluh.cloudfront.net/tokenlists-{chainId}.json` for Sonic (105 entries) and Berachain (79 entries). The TAC and BOB URLs return HTTP 403. These payloads contain basic token details but no protocol routing metadata.

`https://tokens.uniswap.org` returns HTML in this audit. The official `@uniswap/default-token-list` npm publication serves JSON via `https://unpkg.com/@uniswap/default-token-list@latest/build/uniswap-default.tokenlist.json`, but its 1,784 tokens do not include Sonic, TAC, BOB or Berachain.

Pendle's current `/core/v2/markets/all?chainId={chainId}&limit=100&skip=0` API returns 17 Sonic markets and 14 Berachain markets, including expired markets. Protocol flags and market addresses must come from V3 or an authoritative protocol source; ordinary list names and symbols cannot establish that classification.

The present runtime still uses the V3-only cache with the custom overlay. A broader automatic fallback requires contract-verified decimals on every input and inner-token lookup, including the aggregator metadata source. A failed RPC read must reject quoting rather than use a list value or assume 18 decimals. The two Midas payment-token calculations that default missing decimals to 18 also need attention in that refactor.

The eight Sonic snapshot PTs all need their market mappings checked against live provider data before adopting automatic enrichment; some returned mappings differ from the recorded snapshot market. A symbol prefix is not sufficient proof of a PT or its market.
