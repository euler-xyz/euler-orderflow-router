import { SwapVerificationType, SwapperMode } from "@/swapService/interface"
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi"
import { InvalidAddressError, getAddress, isHex } from "viem"
import { z } from "zod"

extendZodWithOpenApi(z)

export type Meta = z.infer<typeof metaSchema>
export type SwapResponseSingle = z.infer<typeof swapResponseSchemaSingle>
export type SwapResponse = z.infer<typeof swapResponseSchema>

const addressSchema = z
  .string()
  .min(1)
  .transform((address, ctx) => {
    try {
      return getAddress(address)
    } catch (error) {
      if (error instanceof InvalidAddressError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid Ethereum address: ${address}`,
        })
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unexpected error validating address: ${error}`,
        })
      }
      return z.NEVER
    }
  })

const hexSchema = z
  .string()
  .min(1)
  .transform((hex, ctx) => {
    if (!isHex(hex)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid hex value: ${hex}`,
      })
      return z.NEVER
    }
    return hex
  })

// Define the Meta type using Zod
const metaSchema = z
  .object({
    isPendlePT: z.boolean().optional(),
    pendleMarket: addressSchema.optional(),
    poolId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.isPendlePT && !data.pendleMarket) {
        return false
      }
      return true
    },
    {
      message: "pendleMarket is required when isPendlePT is true",
      path: ["pendleMarket"],
    },
  )

const swapperModeSchema = z.nativeEnum(SwapperMode)

const swapRouteItemSchema = z.object({
  providerName: z.string(),
})

const swapVerificationTypeSchema = z.nativeEnum(SwapVerificationType)

const strategyConfigSchema = z.any()

const tokenListItemSchema = z.any()

const swapApiResponseVerifySchema = z.object({
  verifierAddress: addressSchema.openapi({
    description: "Address of the SwapVerifier contract",
  }),
  verifierData: hexSchema.openapi({
    description:
      "Already encoded swap verification payload to execute on the SwapVerifier contract",
  }),
  type: swapVerificationTypeSchema.openapi({
    description:
      "Type of swap verification call: 'skimMin' for a swap and deposit or 'debtMax' for swap and repay",
  }),
  vault: addressSchema.openapi({ description: "Receiver vault to verify" }),
  account: addressSchema.openapi({ description: "Account to verify" }),
  amount: z.string().openapi({
    description: "Amount to verify (minimum skimmable, or maximum debt)",
  }),
  deadline: z
    .number()
    .openapi({ description: "Check if the operation is expired" }),
})

const swapApiResponseMulticallItemSchema = z.object({
  functionName: z.string().openapi({ description: "Swapper function to call" }),
  args: z.any().openapi({ description: "Swapper function arguments" }),
  data: hexSchema.openapi({
    description: "Already encoded swapper function call",
  }),
})

const strategyMatchConfigSchema = z.object({
  swapperModes: z.array(swapperModeSchema).optional(),
  isRepay: z.boolean().optional(),
  isPendlePT: z.boolean().optional(),
  tokensInOrOut: z.array(addressSchema).optional(),
})

const routingItemSchema = z.object({
  strategy: z.string(),
  match: strategyMatchConfigSchema,
  config: strategyConfigSchema.optional(),
})

const chainRoutingConfigSchema = z.array(routingItemSchema)

const swapApiResponseSwapSchema = z.object({
  swapperAddress: addressSchema.openapi({
    description: "Swapper contract address",
  }),
  swapperData: hexSchema.openapi({
    description: "Already encodedd Swapper multicall payload",
  }),
  multicallItems: z
    .array(swapApiResponseMulticallItemSchema)
    .openapi({ description: "Raw Swapper multicall items" }),
})

const getSwapSchema = z.object({
  query: z.object({
    chainId: z
      .string()
      .transform(Number)
      .pipe(z.number().int().positive())
      .openapi({ example: "1", param: { description: "Chain id" } }),
    tokenIn: addressSchema.openapi({
      param: { description: "Address of the asset to sell" },
      example: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    }),
    tokenOut: addressSchema.openapi({
      param: { description: "Address of the asset to buy" },
      example: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    }),
    receiver: addressSchema.openapi({
      param: {
        description:
          "Address of the vault to deposit the bought assets or to repay debt",
      },
      example: "0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2",
    }),
    vaultIn: addressSchema.openapi({
      param: {
        description:
          "Address of the vault where to return unused input asset. Ignored in exact input mode.",
      },
      example: "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9",
    }),
    origin: addressSchema.openapi({
      param: { description: "Address of the EOA executing the transaction" },
      example: "0x8A54C278D117854486db0F6460D901a180Fff5aa",
    }),
    accountIn: addressSchema.openapi({
      param: {
        description:
          "Sub-account for which the unused input should be deposited. Ignored in exact input mode.",
      },
      example: "0x0000000000000000000000000000000000000000",
    }),
    accountOut: addressSchema.openapi({
      param: {
        description:
          "Sub-account to receive the deposit or repay of the bought asset",
      },
      example: "0x8A54C278D117854486db0F6460D901a180Fff5aa",
    }),
    amount: z
      .string()
      .transform((s) => BigInt(s || "0"))
      .pipe(z.bigint())
      .openapi({
        param: {
          description:
            "Exact input - amount to sell. Exact output - amount to buy. Target debt mode - estimated amount to buy (current debt - target debt)",
        },
        example: "100000000000",
      }),
    targetDebt: z
      .string()
      .transform((s) => BigInt(s || "0"))
      .pipe(z.bigint())
      .openapi({
        param: {
          description:
            "Amount of debt that should remain in the account after swap and repay. Only in target debt mode.",
        },
        example: "0",
      }),
    currentDebt: z
      .string()
      .transform((s) => BigInt(s || "0"))
      .pipe(z.bigint())
      .openapi({
        param: {
          description:
            "Current debt amount. Ignored if not in repay mode (isRepay = true)",
        },
        example: "0",
      }),
    swapperMode: z
      .string()
      .transform(Number)
      .pipe(z.nativeEnum(SwapperMode))
      .openapi({
        param: {
          description: "0 - exact input, 1 - exact output, 2 - target debt",
        },
        example: "0",
      }),
    slippage: z
      .string()
      .transform(Number)
      .pipe(z.number().nonnegative().max(50))
      .openapi({
        param: {
          description:
            "Maximum slippage allowed in percent (0.1 - 0.1%). Max 50%",
        },
        example: "0.1",
      }),
    deadline: z
      .string()
      .transform(Number)
      .pipe(z.number().int().nonnegative())
      .openapi({
        param: { description: "Quote expiry timestamp in seconds" },
        example: "1736263541",
      }),
    isRepay: z
      .string()
      .toLowerCase()
      .transform((s) => JSON.parse(s))
      .pipe(z.boolean())
      .openapi({
        param: {
          description:
            "If true, the tokens bought in exact input or exact output modes will be used to repay debt instead of depositing",
        },
        example: "false",
      }),
    dustAccount: addressSchema.optional().openapi({
      param: {
        description:
          "Account to receive dust deposits. Defaults to `accountOut`",
      },
      example: "0x8A54C278D117854486db0F6460D901a180Fff5aa",
    }),
    skipSweepDepositOut: z
      .string()
      .toLowerCase()
      .transform((s) => JSON.parse(s))
      .pipe(z.boolean())
      .optional()
      .openapi({
        param: {
          description:
            "Do not add a final deposit of the output token (sweep). Leave the assets in the swapper. Useful if receiver is the Swapper",
        },
        example: "false",
      }),
    routingOverride: z
      .string()
      .transform((s) => JSON.parse(s))
      .pipe(chainRoutingConfigSchema)
      .optional()
      .openapi({
        param: { description: "Optional override of the pipeline config" },
      }),
  }),
})

const swapResponseSchemaSingle = z.object({
  amountIn: z.string().openapi({
    description:
      "In exact output - the trade quote. In exact input - the exact sold amount",
  }),
  amountInMax: z.string().openapi({
    description:
      "In exact output - maximum sold amount accounting slippage. In exact input - the exact sold amount",
  }),
  amountOut: z.string().openapi({
    description:
      "In exact input - the trade quote. In exact output - estimated sold amount",
  }),
  amountOutMin: z.string().openapi({
    description:
      "In exact input - minimum amount bought accoounting slippage. In exact output - estimated sold amount",
  }),
  accountIn: addressSchema.openapi({
    description:
      "Sub-account for which the unused input will be deposited. Ignored in exact input mode.",
  }),
  accountOut: addressSchema.openapi({
    description:
      "Sub-account which will receive the deposit or repay of the bought asset",
  }),
  vaultIn: addressSchema.openapi({
    description:
      "Address of the vault which will receive unused input asset. Ignored in exact input mode.",
  }),
  receiver: addressSchema.openapi({
    description:
      "Address of the vault where the bought assets will be deposited or repaid",
  }),
  tokenIn: tokenListItemSchema.openapi({
    description: "Address of the sold asset",
  }),
  tokenOut: tokenListItemSchema.openapi({
    description: "Address of the bought asset",
  }),
  slippage: z.number().openapi({
    description: "Actual allowed slippage. Can be lower than requested.",
  }),
  swap: swapApiResponseSwapSchema.openapi({
    description:
      "Payload for the Swapper contract. Use either raw or encoded data",
  }),
  verify: swapApiResponseVerifySchema.openapi({
    description:
      "Payload for the SwapVerifier contract. Use either raw or encoded data",
  }),
  route: z
    .array(swapRouteItemSchema)
    .openapi({ description: "Swap route details" }),
})

const swapResponseSchema = z.array(swapResponseSchemaSingle)

export { getSwapSchema, swapResponseSchemaSingle, swapResponseSchema }
