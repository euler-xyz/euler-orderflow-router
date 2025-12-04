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
 
Additionally there is a script to generate auxiliary config files, executed by `pnpm run generate-config`. Currently it fetches the list of supported [Pendle aggregators](./src/swapService/strategies/aggregators/sources/pendle/pendleAggregators.json) for all chains

## Selecting providers
Instead of fetching all quotes in a single call, which is as fast as the slowest provider's response, clients can send parallel requests with providers preselected in the optional `provider` query param. The endpoint `\providers` lists available providers per chain. The list is rarely updated so it can be cached on the client.

## Tokenlists
The router relies on tokenlists for all swapped tokens. They can be fetched from `TOKENLIST_URL` or read from JSON files in `tokenLists` folder if the configuration is missing. Note the files are not updated currently. Please reach out on [Euler discord](https://discord.com/invite/pTTnr7b4mT) if you need access to the tokenlist endpoint.