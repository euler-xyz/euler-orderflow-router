import { getAllTokenLists, getOrFetchToken } from "@/common/utils/tokenList"
import type {
  ChainId,
  FieldsRequirements,
  SupportInChain,
  TimeString,
  TokenAddress,
} from "@balmy/sdk"

import type {
  BaseTokenMetadata,
  IMetadataSource,
  MetadataInput,
  MetadataResult,
} from "@balmy/sdk/dist/services/metadata/types"
import type { Address } from "viem"

export class TokenlistMetadataSource
  implements IMetadataSource<BaseTokenMetadata>
{
  async getMetadata<
    Requirements extends FieldsRequirements<BaseTokenMetadata>,
  >(params: {
    tokens: MetadataInput[]
    config?: { timeout?: TimeString }
  }) {
    const result: Record<ChainId, Record<TokenAddress, BaseTokenMetadata>> = {}
    const tokenMetadata = await Promise.all(
      params.tokens.map(async ({ chainId, token }) => ({
        chainId,
        token,
        tokenListItem: await getOrFetchToken(chainId, token as Address),
      })),
    )

    for (const { chainId, token, tokenListItem } of tokenMetadata) {
      if (tokenListItem) {
        if (!result[chainId]) result[chainId] = {}
        result[chainId][token] = {
          decimals: tokenListItem.decimals,
          symbol: tokenListItem.symbol,
        }
      }
    }

    return result as Record<
      ChainId,
      Record<TokenAddress, MetadataResult<BaseTokenMetadata, Requirements>>
    >
  }

  supportedProperties() {
    const properties: SupportInChain<BaseTokenMetadata> = {
      symbol: "present",
      decimals: "present",
    }
    return Object.fromEntries(
      Object.keys(getAllTokenLists()).map((chainId) => [chainId, properties]),
    )
  }
}
