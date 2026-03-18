import { type Address, getAddress } from "viem"

export type MainnetErc4626Case = {
  protocol: string
  vault: Address
  asset: Address
  assetDustEVault: Address
}

const rawCases = [
  {
    protocol: "wstUSR",
    vault: "0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055",
    asset: "0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110",
    assetDustEVault: "0x3a8992754e2ef51d8f90620d2766278af5c59b90",
  },
  {
    protocol: "eUSDe",
    vault: "0x90D2af7d622ca3141efA4d8f1F24d86E5974Cc8F",
    asset: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    assetDustEVault: "0x537469D2219Bf28EAc0B1199d142969163309969",
  },
  {
    protocol: "sUSDf",
    vault: "0xc8CF6D7991f15525488b2A83Df53468D682Ba4B0",
    asset: "0xFa2B947eEc368f42195f24F36d2aF29f7c24CeC2",
    assetDustEVault: "0x7aC81B3172870397496bD30502a07Cc9BfBB25eE",
  },
  {
    protocol: "sUSP",
    vault: "0x271C616157e69A43B4977412A64183Cf110Edf16",
    asset: "0x97cCC1C046d067ab945d3CF3CC6920D3b1E54c88",
    assetDustEVault: "0x15bdfb8701b40E2AC3C7e432801329159A54eBc8",
  },
  {
    protocol: "pUSDe",
    vault: "0xA62B204099277762d1669d283732dCc1B3AA96CE",
    asset: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    assetDustEVault: "0x537469D2219Bf28EAc0B1199d142969163309969",
  },
  {
    protocol: "stcUSD",
    vault: "0x88887bE419578051FF9F4eb6C858A951921D8888",
    asset: "0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC",
    assetDustEVault: "0xe0695883730ddd5eb322A601e08890c301fFcc71",
  },
  {
    protocol: "lstRZR",
    vault: "0xB33f4B9C6f0624EdeAE8881c97381837760D52CB",
    asset: "0xb4444468e444f89e1c2CAc2F1D3ee7e336cBD1f5",
    assetDustEVault: "0x9d289DE828E7616B062818aBCd3f9b0eE6df6e44",
  },
  {
    protocol: "sUSDS",
    vault: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
    asset: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
    assetDustEVault: "0x98238Ee86f2c571AD06B0913bef21793dA745F57",
  },
] as const

export const MAINNET_ERC4626_CASES: MainnetErc4626Case[] = rawCases.map(
  (entry) => ({
    protocol: entry.protocol,
    vault: getAddress(entry.vault),
    asset: getAddress(entry.asset),
    assetDustEVault: getAddress(entry.assetDustEVault),
  }),
)
