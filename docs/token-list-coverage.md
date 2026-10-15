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

Requested tokens and inner assets resolve their metadata on-chain when absent from the catalog. The runtime contains no manually maintained custom-token overlay. Both listed and unlisted tokens need verified contract decimals before quoting.

## Deployment coverage

The default V3 endpoint returns HTTP 404 `CHAIN_NOT_SUPPORTED` for:

- Sonic: `146`
- TAC: `239`
- BOB: `60808`
- Berachain: `80094`

These four chains account for 110 snapshot tokens, including 23 metadata records. This audit cannot establish their V3 routing coverage.

The router can start on these configured chains without a V3 catalog. It tries generic discovery sources and resolves missing ERC-20 assets through RPC. Protocol routes still require authoritative metadata; generic list availability is not equivalent to complete protocol coverage.

Catalog coverage is not proof of swap execution. Live fork swaps were not run as part of this audit.

## Automatic source audit (2026-10-13)

DefiLlama publishes a usable per-chain catalog at `https://d3g10bzo9rdluh.cloudfront.net/tokenlists-{chainId}.json` for Sonic (105 entries) and Berachain (79 entries). The TAC and BOB URLs return HTTP 403. These payloads contain basic token details but no protocol routing metadata.

`https://tokens.uniswap.org` returns HTML in this audit. The official `@uniswap/default-token-list` npm publication serves JSON via `https://unpkg.com/@uniswap/default-token-list@latest/build/uniswap-default.tokenlist.json`, but its 1,784 tokens do not include Sonic, TAC, BOB or Berachain.

Pendle's current `/core/v2/markets/all?chainId={chainId}&limit=100&skip=0` API returns 17 Sonic markets and 14 Berachain markets, including expired markets. Protocol flags and market addresses must come from V3 or an authoritative protocol source; ordinary list names and symbols cannot establish that classification.

The runtime uses V3 first, supplements failed catalogs with generic sources, and resolves unknown input and inner tokens on-chain. All quote consumers require contract decimals, including the aggregator metadata source and Midas payment-token calculations. No static catalogs or custom token records are bundled.

Five of the eight Sonic snapshot PT-to-market mappings match the provider response. The remaining three PT addresses are absent from that response, so this source does not establish full routing parity. The Berachain snapshot PT-to-market mapping matches. A symbol prefix is not sufficient proof of a PT or its market.

## Built-loader checks (2026-10-13)

The built loader completed discovery for all 14 active configured chains. Sonic and Berachain used 104 and 78 normalized DefiLlama entries respectively; native zero-address placeholders were excluded. TAC and BOB completed initialization with empty catalogs and resolved requested tokens on-chain.

All three Monad wrapper exceptions resolved through the configured public RPC with their actual symbols and six decimals. BOB WETH and a TAC ERC-20 also resolved through RPC without usable catalogs. These checks validate metadata discovery and decimal reads, not signed swap execution.

## Sonic PT routing checks (2026-10-15)

Pendle's `/core/v1/assets/all?chainId=146&type=PT` response explicitly classifies the three PTs absent from the market catalog:

| PT | Address | Contract decimals |
| --- | --- | ---: |
| PT-wstkscETH-18DEC2025 | `0x7e52f587f5B870D4C2cac8559ac4c49742D31a28` | 18 |
| PT-wstkscUSD-18DEC2025 | `0x0Fb682C9692AddCc1769f4D4d938c54420D54fA3` | 6 |
| PT-stS-18DEC2025 | `0xE2BC30A4896Ff4c52ADCb180213666d2D6B21c6d` | 18 |

The runtime supplements market-derived metadata with these authoritative PT classifications. It retains known market mappings and leaves the market address unset for asset-only records. Generic token names and symbols cannot establish PT status. Asset-source failures preserve successful market discovery and cached asset-only PT classifications.

The updated loader resolved all three PTs using public Sonic RPC decimal reads, and the actual Pendle quote source returned positive output amounts and transaction calldata for each PT-to-underlying conversion. Each quote used one whole PT in its verified decimal units. All three transactions target Pendle's router at `0x888888888889758F76e7103c6CbF23ABbF58F946`.

These checks establish classification and quote construction for the three missing Sonic routes. They do not establish missing market mappings or signed swap execution.
