# Adding a chain

Chain registration, deployed contracts, routing, and provider support have separate responsibilities. Use this checklist when enabling a network.

## Registration and RPCs

- [ ] Add the viem chain definition to `SUPPORTED_CHAINS` in [viemClients.ts](../src/common/utils/viemClients.ts). Both `RPC_URLS` and `createClients()` derive from this list. Each RPC setting is named `RPC_URL_<chainId>`.
- [ ] Add that setting to [.env.template](../.env.template) and configure it in each deployment's environment or Doppler project. Verify `eth_chainId` against the intended chain. Token metadata and decimal verification require an explicitly configured RPC, even when viem has a public default endpoint.
- [ ] Include the chain ID in the expected supported IDs in [viemClients.test.ts](../src/__tests__/viemClients.test.ts). The tests check client registration, transport URLs, empty overrides, and isolation between networks.

## Contract addresses from SDK deployments

- [ ] Add or verify the network's `chainId` entry in the [EulerChains deployment feed](https://github.com/euler-xyz/euler-interfaces/blob/master/EulerChains.json), or the feed configured by `DEPLOYMENTS_URL`. Set `addresses.peripheryAddrs.swapper` and `addresses.peripheryAddrs.swapVerifier` to the verified deployed contract addresses.
- [ ] Confirm that `getSwapperAddress(chainId)` and `getSwapVerifierAddress(chainId)` in `src/common/utils/deployments.ts` resolve both addresses through `@eulerxyz/euler-v2-sdk`'s `DeploymentService`. The chain must be registered in `RPC_URLS` and present in the feed; missing chains or contract addresses cause lookup errors.
- [ ] Restart the router after changing the feed or `DEPLOYMENTS_URL`. The SDK loads deployments once before the server listens. A failed deployment load stops startup and logs `Server startup failed`.

## Routing and SDK metadata

- [ ] Decide whether [default.ts](../src/swapService/config/default.ts) provides the required pipeline. For custom routing, add `src/swapService/config/<chain>.ts` and register it in [config/index.ts](../src/swapService/config/index.ts). Check strategy order, source filters, repay handling, and wrapper asset addresses. The shared wrappers are in [global.ts](../src/swapService/config/global.ts).
- [ ] Check that `@balmy/sdk` recognizes the chain, its wrapped native asset, public RPCs, and explorer. Additional definitions are maintained in [the SDK patch](../patches/@balmy__sdk@0.9.0.patch), registered by [pnpm-workspace.yaml](../pnpm-workspace.yaml). Use pnpm's patch workflow when changing it, commit the resulting lockfile hash, and verify a frozen install.
- [ ] Check any strategy-specific chain restrictions and contract maps used by the pipeline. For example, [strategyCombinedUniswap.ts](../src/swapService/strategies/strategyCombinedUniswap.ts) has `chainsSupported`; [strategyCowSwap.ts](../src/swapService/strategies/strategyCowSwap.ts) has chain slugs and close-position wrapper addresses. Enable a strategy only when its contracts and upstream service support the chain.

## Provider coverage

Each provider declares its own supported networks. Confirm support with the provider and update the relevant definitions under [aggregators/sources](../src/swapService/strategies/aggregators/sources). A router registration does not automatically enable a provider.

| Provider | Configuration to review |
| --- | --- |
| 0x, OKX, Nordstern | `SUPPORTED_CHAINS` in `0xMatchaQuoteSource.ts`, `okxDexQuoteSource.ts`, `nordsternQuoteSource.ts` |
| KyberSwap, Magpie, Spectra | Chain-to-network mappings in `kyberswapQuoteSource.ts`, `magpieQuoteSource.ts`, `spectraQuoteSource.ts` |
| OpenOcean | `SUPPORTED_CHAINS` and native-asset overrides in `openOceanQuoteSource.ts` |
| Binance Wallet | `DEFAULT_SUPPORTED_CHAINS` in `binanceWalletQuoteSource.ts` |
| 1inch, LI.FI, Enso, Velora, Ooga Booga, Multiliquid | Metadata `supports.chains` in `oneInchQuoteSource.ts`, `lifiQuoteSource.ts`, `ensoQuoteSource.ts`, `paraswapQuoteSource.ts`, `oogaboogaQuoteSource.ts`, `multiliquidQuoteSource.ts` |
| Uniswap | `ROUTER_ADDRESS` in `uniswapQuoteSource.ts`; verify the installed routing SDK supports the chain |
| Oku | `CHAINS`, market identifiers, and Permit2 adapters in `okuQuoteSource.ts`, plus per-market registrations in `customSourceList.ts` |
| Pendle | Generated `pendle/pendleAggregators.json` consumed by `pendleQuoteSource.ts` and `customSourceList.ts` |

- [ ] For a new source or market, register it in [customSourceList.ts](../src/swapService/strategies/aggregators/customSourceList.ts), configure required credentials in [strategyAggregators.ts](../src/swapService/strategies/strategyAggregators.ts), and document the environment keys in `.env.template`.
- [ ] For Pendle changes, run `pnpm run generate-config` and review and commit `pendleAggregators.json`. Docker builds consume this committed file. Check the command output as well as the diff: the generator can retain the existing file on an upstream failure.

## Token discovery and verification

- [ ] Check discovery through the primary V3 catalog and the fallback sources in [tokenSources.ts](../src/common/utils/tokenSources.ts). [tokenList.ts](../src/common/utils/tokenList.ts) automatically includes registered chains. Ordinary missing ERC-20s can resolve through the configured RPC.
- [ ] Verify representative assets' on-chain decimals and protocol metadata. Pendle PT/LP and other specialized routes require authoritative market or pool metadata; ERC-20 name, symbol, and decimals alone do not enable them. Record coverage gaps in [token-list-coverage.md](./token-list-coverage.md).

## Validation

Run the checks used by CI:

```sh
HUSKY=0 pnpm install --frozen-lockfile
pnpm run lint
pnpm run test:unit
pnpm run build
```

- [ ] Build the runtime image using the [Docker instructions](../README.md#docker-and-ci).
- [ ] Start the service with the new chain's RPC and provider credentials. Verify both SDK-resolved contract addresses, then check `/health-check` and `/providers?chainId=<chainId>`; verify the provider list matches the intended routing configuration.
- [ ] Request representative `/swaps` quotes and simulate their returned payloads on a fork of the new chain. Include exact-input, exact-output, repay, and any specialized wrapper routes the chain enables. Check the response chain, Swapper and SwapVerifier addresses, token amounts, approvals, and recipients. The existing `pnpm test` suite exercises mainnet fork cases and requires Anvil and RPC configuration; extend it or add chain-specific coverage for the new network.

## Disabling a chain

Remove its registry entry, RPC environment configuration, custom routing, and provider/market registrations. Remove a local SDK chain patch if it only serves that network. Search for the chain's name, numeric ID, and source aliases across the repository, and keep regression tests that reject its token resolution and deployment-address lookups even if the chain remains in the shared deployment feed.
