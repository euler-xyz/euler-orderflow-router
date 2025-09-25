import * as chains from "viem/chains"

const contractBook: any = {
  swapper: {
    abi: require("./abi/Swapper.json"),
    address: {
      [chains.mainnet.id]: "0x2Bba09866b6F1025258542478C39720A09B728bF",
      [chains.base.id]: "0x0D3d0F97eD816Ca3350D627AD8e57B6AD41774df",
      [chains.polygon.id]: "0x3e43F3CE1C364722df6470381Fa1F15ffbFB37E3",
      [chains.avalanche.id]: "0x6E1C286e888Ab5911ca37aCeD81365d57eC29a06",
      [chains.bsc.id]: "0xAE4043937906975E95F885d8113D331133266Ee4",
      [1923]: "0x05Eb1A647265D974a1B0A57206048312604Ac6C3",
      [146]: "0xbAf5B12c92711a3657DD4adA6b3C7801e83Bb56a",
      [80094]: "0x4A35e6A872cf35623cd3fD07ebECEDFc0170D705",
      [130]: "0x319E8ecd3BaB57fE684ca1aCfaB60c5603087B3A",
      [60808]: "0x697Ca30D765c1603890D88AAffBa3BeCCe72059d",
      [239]: "0x5ff07e50D83769861db40C5087753124D389c1c0",
      [chains.arbitrum.id]: "0x6eE488A00A2ef1E2764cD7245F8a77C40060A7C7",
      [chains.linea.id]: "0x1480Cfff566f27BbB2AEAd6eeABEc4BA068e5405",
      [9745]: "0x419730b755c6e76B42D2CaD9a2674a8DC748dA38",
    },
  },
  swapVerifier: {
    abi: require("./abi/SwapVerifier.json"),
    address: {
      [chains.mainnet.id]: "0xae26485ACDDeFd486Fe9ad7C2b34169d360737c7",
      [chains.base.id]: "0x30660764A7a05B84608812C8AFC0Cb4845439EEe",
      [chains.polygon.id]: "0x50C5ca05E916459F32c517932f1b4D78fb11018F",
      [chains.avalanche.id]: "0x0d7938D9c31Cd7dD693752074284af133c1142de",
      [chains.bsc.id]: "0xA8a4f96EC451f39Eb95913459901f39F5E1C068B",
      [1923]: "0x392C1570b3Bf29B113944b759cAa9a9282DA12Fe",
      [146]: "0x003ef4048b45a5A79D4499aaBd52108B3Bc9209f",
      [80094]: "0x6fFf8Ac4AB123B62FF5e92aBb9fF702DCBD6C939",
      [130]: "0x7eaf8C22480129E5D7426e3A33880D7bE19B50a7",
      [60808]: "0x296041DbdBC92171293F23c0a31e1574b791060d",
      [239]: "0x5a8610DB17CfF800C8abEb6Da31B9bB1fF51843f",
      [chains.arbitrum.id]: "0x7b16DAaFa76CfeC8C08D7a68aF31949B37ebfdF5",
      [chains.linea.id]: "0x77C9B0E7Ac0405797F04E5230Ed0A54DB39f98f0",
      [9745]: "0xB695C0aC484F46dD8f279452209b8C53674974bD",
    },
  },
}

export default contractBook
