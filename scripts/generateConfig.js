const fs = require("node:fs")
const path = require("node:path")

const PENDLE_CONFIG_PATH = path.join(
  __dirname,
  "../src/swapService/strategies/aggregators/sources/pendle/pendleAggregators.json",
)

async function run() {
  // fetch pendle aggregators per chain

  const response = await fetch("https://api-v2.pendle.finance/core/v1/chains")
  if (!response.ok) {
    console.log("Failed to fetch pendle chains!")
    return
  }
  const { chainIds } = await response.json()
  // TODO REMOVE
  if (!chainIds.includes(130)) chainIds.push(130)
  try {
    const aggregators = await Promise.all(
      chainIds.map(async (chainId) => {
        const response = await fetch(
          `https://api-v2.pendle.finance/core/v1/sdk/${chainId}/supported-aggregators`,
        )
        if (!response.ok) {
          throw new Error("fetch failed")
        }

        const { aggregators } = await response.json()
        return [chainId, aggregators.map((a) => a.name)]
      }),
    )

    fs.writeFileSync(
      PENDLE_CONFIG_PATH,
      JSON.stringify(Object.fromEntries(aggregators), null, 2),
    )
  } catch (err) {
    console.error("error generating config", err)
  }
}

run()
