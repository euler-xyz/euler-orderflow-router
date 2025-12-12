import type {
  ChainId,
  FieldsRequirements,
  IProviderService,
  SupportRecord,
  TimeString,
} from "@balmy/sdk"
import type {
  GasPriceResult,
  GasValueForVersions,
  IGasPriceSource,
} from "@balmy/sdk/dist/services/gas/types"

// Stub out gas price calculations to make sure not to hit RPCs
type GasValues = GasValueForVersions<"standard">
export class StubGasPriceSource implements IGasPriceSource<GasValues> {
  constructor(private readonly providerService: IProviderService) {}

  supportedSpeeds() {
    const support: SupportRecord<GasValues> = { standard: "present" }
    return Object.fromEntries(
      this.providerService
        .supportedChains()
        .map((chainId) => [Number(chainId), support]),
    )
  }

  getGasPrice<Requirements extends FieldsRequirements<GasValues>>() {
    console.log("GET GAS PRICE");
    console.trace();
    return Promise.resolve({
      standard: {
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
        gasPrice: 0,
      },
    }) as unknown as Promise<GasPriceResult<GasValues, Requirements>>
  }
}
