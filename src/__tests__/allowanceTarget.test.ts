import { zeroAddress } from "viem"
import { describe, expect, it } from "vitest"
import { getAllowanceTarget } from "../swapService/strategies/strategyAggregators"

const swapTarget = "0x0000000000001fF3684f28c67538d4D072C22734"
const spender = "0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f"

describe("aggregator allowance target", () => {
  it("skips the approve step when the source returns the zero address", () => {
    expect(getAllowanceTarget(zeroAddress, swapTarget)).toBeUndefined()
  })

  it("skips the approve step when the spender is the swap target", () => {
    expect(
      getAllowanceTarget(swapTarget.toLowerCase(), swapTarget),
    ).toBeUndefined()
  })

  it("skips the approve step when the source returns no valid address", () => {
    expect(getAllowanceTarget("", swapTarget)).toBeUndefined()
  })

  it("approves a separate spender", () => {
    expect(getAllowanceTarget(spender.toLowerCase(), swapTarget)).toBe(spender)
  })
})
