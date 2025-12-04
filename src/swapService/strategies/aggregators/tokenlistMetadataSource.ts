import { getAllTokenLists } from "@/common/utils/tokenList"
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
import { type Address, isAddressEqual } from "viem"

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
    const allTokens = getAllTokenLists()
    for (const { chainId, token } of params.tokens) {
      const tokenListItem = allTokens[chainId]?.find((t) =>
        isAddressEqual(t.address, token as Address),
      )
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
