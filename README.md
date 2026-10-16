# Euler Orderflow Router API

API for fetching swap quotes and payloads from multiple DEX aggregators for use with Euler V2.

## Instalation

Install npm packages
```
pnpm i
```

Copy `.env.template` to `.env` and set configuration. Alternatively use:
```
pnpm run doppler:syncdev # local development
pnpm run doppler:syncstg # staging
pnpm run doppler:syncprd # production 
```

## Running

Dev server
``` 
pnpm run dev
```

Prod
```
pnpm run build
pnpm run start
```

## Lint
```
pnpm run lint       # check 
pnpm run lint:fix   # fix 
```

## Tests

Run unit tests without RPC endpoints or provider credentials:

```sh
pnpm run test:unit
```

`pnpm test` runs the live mainnet fork suite and requires Anvil and the RPC/provider configuration used by the test cases.

## Docker and CI

The [Build workflow](./.github/workflows/build.yml) runs on pull requests, pushes to `master` and `development`, and manual dispatch. It uses Node 24 and the pnpm version pinned in `package.json`, runs lint, unit tests, and the production build, and builds the Linux AMD64 runtime image. The image check loads the server with production dependencies as a nonroot user with networking disabled. Images are built for validation without being pushed to a registry.

Build locally with the public base images used by CI:

```sh
docker build \
  --build-arg NODE_BUILD_IMAGE=node:24-trixie-slim \
  --build-arg NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot \
  -t euler-orderflow-router .
docker run --rm --env-file .env -e PORT=3002 -p 3002:3002 euler-orderflow-router
```

Deployment builds can supply `--build-arg NODE_BASE_REPO=<repository>` to use that repository's `24-slim` and `24-distroless` tags. `NODE_BUILD_IMAGE` and `NODE_RUNTIME_IMAGE` override those defaults individually.

The router discovers Pendle aggregators at startup for configured chains, with a five-second timeout shared across discovery requests. Successful responses replace each chain's provider list; failed requests retain its committed fallback. Startup waits for discovery alongside token loading before accepting requests. Provider changes require a restart. Docker builds do not contact Pendle. Refresh the fallback with `pnpm run generate-config`, review the generated JSON, and commit it.

## Swagger API docs

Swagger UI is served at the root, it is also available at [swap.euler.finance](https://swap.euler.finance). Request and response schemas are also available [here](./src/api/routes/swap/swapModel.ts)

## Fetching quotes and executing trades

The `/swaps` endpoint fetches token trade quotes which can be used with the swapping peripheries in the Euler Vault Kit [periphery contracts](https://github.com/euler-xyz/evk-periphery/tree/master/src/Swaps). See [periphery docs](https://github.com/euler-xyz/evk-periphery/blob/master/docs/swaps.md) for detailed description of the swapping architecture in Euler V2. The API response includes both encoded payloads as well as raw data for calls to the `Swapper` (`swap` field of the response) and `SwapVerifier` (`verify` field) contracts. These payloads can be used directly in EVC batches.

Example of fetching a swap and repay quote to use e.g. in liquidation:

```js 
const collateralVault = EUSDC_ADDRESS
const liabilityVault = EWETH_ADDRESS

const currentDebtAmount = parseUnits('100', 6).toString()

// Fetch a quote to repay WETH liability by selling USDC from the collateral vault.
// Use target debt mode, which will attempt to buy exactly enough of the liability asset
// to repay the debt down to `targetDebt` amount. The target here is 0, meaning all
// of the debt should be repaid.

const queryParams = {
  chainId: "1",
  tokenIn: USDC_ADDRESS,
  tokenOut: WETH_ADDRESS,
  amount: currentDebtAmount,
  targetDebt: "0",
  currentDebt: currentDebtAmount,
  receiver: liabilityVault,
  vaultIn: collateralVault,
  origin: connectedAccount,
  accountIn: connectedAccount,
  accountOut: connectedAccount,
  slippage: "0.1", // 0.1%
  deadline: String(Math.floor(Date.now() / 1000) + 10 * 60), // 10 minutes from now
  swapperMode: "2", // target debt mode
  isRepay: "true",
}

const { data: response } = await axios.get(
  `${SWAP_API_URL}/swap`,
  {
    params: queryParams,
  },
)

// Encode EVC batch
const batchItems = [
  // Withdraw collateral to the Swapper contract
  {
    targetContract: collateralVault,
    onBehalfOfAccount: connectedAccount,
    value: 0,
    data: encodeFunctionData({
      abi: EVAULT_ABI,
      functionName: "withdraw",
      args: [response.data.amountInMax, response.data.swap.swapperAddress, connectedAccount]
    })
  },
  // execute Swapper payload from the API response
  {
    targetContract: response.data.swap.swapperAddress,
    onBehalfOfAccount: connectedAccount,
    value: 0,
    data: response.data.swap.swapperData
  },
  // execute SwapVerifier payload from the API response
  {
    targetContract: response.data.verify.verifierAddress,
    onBehalfOfAccount: connectedAccount,
    value: 0,
    data: response.data.verify.verifierData
  },
]

const evcBatch = encodeFunctionData({
  abi: EVC_ABI,
  functionName: "batch",
  args: [batchItems]
})

// send tx

```

## Configuration

Use the [chain onboarding checklist](./docs/adding-a-chain.md) when registering a network, configuring contracts and providers, or disabling chain support.

To handle an incoming swap request, the API processes the query through a series of strategies until one of them provides a valid response. The strategy pipelines are defined per chain in `/swapService/config` folder. The strategies can handle requests in multiple ways. The basic one is the balmy SDK strategy, which queries multiple DEXes and aggregators for a swap quote and picks the best one. Strategies can themselves run the pipelines recursively. ERC4626 wrapper can be configured for assets which are vault shares and are not supported by aggregators. The strategy will deposit or redeem vault shares and run the pipeline again, this time using the underlying asset of the vault. For a list of available strategies see `swapService/strategies` folder.

The pipeline definition consits of an array of objects, each of which designates a strategy with its configuration and an optional matching logic. In the following example, the pipeline is configured to query Pendle and LI.FI for swap of the Pendle PT tokens, and 1Inch and LI.FI for all other tokens. There's also a repay wrapper strategy, which processes a regular exact input quote to include a repay on the receiver vault.

```js
const pipeline = [
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyAggregators.name(),
    config: {
      sourcesFilter: {
        includeSources: ["pendle", "li-fi"],
      },
    },
    match: { isPendlePT: true },
  },
  {
    strategy: StrategyAggregators.name(),
    config: {
      sourcesFilter: {
        includeSources: ["1inch", "li-fi"],
      },
    },
  },
]
```
 
`pnpm run generate-config` refreshes the committed [Pendle aggregator fallback](./src/swapService/strategies/aggregators/sources/pendle/pendleAggregators.json). Review its output and the JSON diff before committing: an upstream failure can leave the existing file unchanged. The startup loader checks configured chains from Pendle's chain list and the fallback, including known chains omitted by the chain-list endpoint.

## Selecting providers
Instead of fetching all quotes in a single call, which is as fast as the slowest provider's response, clients can send parallel requests with providers preselected in the optional `provider` query param. The endpoint `\providers` lists available providers per chain. The list is rarely updated so it can be cached on the client.

## Token metadata

The primary token catalog defaults to `https://v3.euler.finance/v3/tokens`. `TOKENLIST_URL` overrides it; `TOKENLIST_URL_<chainId>` can override it for an individual chain. Only chains with a configured `RPC_URL_<chainId>` are loaded.

If a primary catalog fails or is empty, the router supplements its last successful data with DefiLlama and the official Uniswap list. Discovery data stays in memory and refreshes every `TOKENLIST_CACHE_TIMEOUT_SECONDS` (default 300). Overlapping refreshes share one request. The timeout (`TOKENLIST_FETCH_TIMEOUT_SECONDS`, default 30) bounds each upstream load.

Startup waits for the initial discovery attempts. List outages do not prevent startup: even with an empty catalog, requested ERC-20 tokens and inner routing assets can resolve their name, symbol and decimals through the configured RPC. Missing RPC configuration prevents startup. Native zero-address list placeholders are excluded.

Before quoting, both input tokens and inner routing assets use contract-verified decimals, memoized by chain and address for the process. Failed or invalid reads reject token resolution; list decimals and an assumed 18 are not used as substitutes. ERC-20 metadata reads have a 10-second RPC timeout and support string or bytes32 name/symbol responses.

Protocol routing metadata comes from V3. For tokens absent from that catalog, the router can identify Pendle PT and LP addresses from Pendle's paginated market API. It does not classify tokens from their symbols or accept protocol flags from generic lists. A missing or ambiguous market mapping does not produce a fabricated market address.

Optional source overrides are `DEFILLAMA_TOKEN_LIST_URL` (per-chain list base), `UNISWAP_TOKEN_LIST_URL` (global published list) and `PENDLE_MARKETS_URL` (paginated market endpoint). The default Uniswap source is its official npm publication; `tokens.uniswap.org` currently serves HTML.

See [token-list coverage](./docs/token-list-coverage.md) for the source audit and protocol coverage limits.
