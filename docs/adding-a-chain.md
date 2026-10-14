# Adding a chain

This is the runbook for enabling a chain in the swap API and shipping it. Keep it current: a PR that changes any of these steps updates this file.

## 1. Add the chain config file

Each chain has one file, `src/swapService/config/<chain>.ts`. It holds the viem chain and the aggregators enabled on it:

```ts
import { example } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const exampleConfig: ChainConfig = {
  chain: example,
  aggregators: {
    kyberswap: { chainKey: "example" },
    nordstern: true,
    "open-ocean": true,
  },
}

export default exampleConfig
```

Register it in `chainConfigs` in `src/swapService/config/chains.ts`. Everything else is derived from that list:

| Derived | From |
|---|---|
| `RPC_URLS[<id>]` | the `RPC_URL_<id>` env var |
| `viemClients[<id>]` | `chain` |
| each aggregator's supported chains | the chains that list it under `aggregators` |

Notes:

- **viem chain.** It must be exported by the installed `viem`. If it isn't, upgrade `viem` first.
- **Aggregators.** Enable only aggregators whose API serves the chain; several sources in `src/swapService/strategies/aggregators/sources/` link to their vendor's network list. `AggregatorChainSettings` in `chainConfig.ts` gives each aggregator's per-chain settings: `true` when there are none, otherwise the vendor's chain key or network name, OpenOcean's native token address, Uniswap's router or Oku's permit2 adapter. Multiliquid and Oogabooga cover one chain each (Ethereum and Berachain).
- **Pendle.** Pendle sources are not listed here. `pnpm run generate-config` writes `pendleAggregators.json` from Pendle's API, and the image build runs it.
- **balmy SDK.** The quote service looks up the chain with `getChainByKeyOrFail` whenever a source reports a gas estimate. On a chain `@balmy/sdk` doesn't know, every such quote fails. Chains it lacks are added in `patches/@balmy__sdk@0.9.0.patch`; Unichain, Monad, TAC, HyperEVM, Plasma and BOB are there. To add one, run `pnpm patch @balmy/sdk@0.9.0`, add the entry to `dist/chains.js`, then run `pnpm patch-commit <printed dir>`.
- **`.env.template`.** Add `RPC_URL_<id>=""`. A test fails if the template's RPC names differ from the registered chains.

Then run the checks:

```sh
pnpm lint
pnpm exec vitest run --exclude 'src/__tests__/live/**'
pnpm build
```

## 2. Optional per-chain behaviour

- **Routing pipeline.** A chain without its own pipeline uses `src/swapService/config/routing/default.ts`: the global wrappers, then the aggregators. For special tokens (ERC-4626 wrappers, Midas, Pendle LP, CoW), add `src/swapService/config/routing/<chain>.ts` and register it in `src/swapService/config/index.ts`.
- **CoW.** Only where the CoW wrappers are deployed: add the chain to `COW_SUPPORTED_CHAINS` and `COW_CLOSE_POSITION_WRAPPERS` in `src/swapService/strategies/strategyCowSwap.ts`, and add `StrategyCowSwap` to the chain's pipeline.

## 3. Swapper and SwapVerifier

At startup, and on a timer after that, the service reads the Swapper and SwapVerifier addresses from euler-interfaces' `EulerChains.json`. It keeps only registered chains. The chain must be in that file before quotes can be built. The fallback map in `src/common/utils/contractBook.ts` is used when the feed can't be read; add the chain there too.

## 4. RPC

The service reads `RPC_URL_<chainId>`. The `add-chain` command in euler-infra-utils provisions the node and writes this variable into every consumer's Doppler project, `euler-swap-api` included. A registered chain without a value gets no token catalog. Quotes on that chain fail until it is set. Locally, set it in `.env` or run `pnpm run doppler:syncdev`.

## 5. Token list source

There are no token list files to add. Token metadata is discovered at runtime for every chain that has an RPC:

1. The primary catalog is V3: `https://v3.euler.finance/v3/tokens?chainId=<id>`. `TOKENLIST_URL` and `TOKENLIST_URL_<chainId>` override it. V3 must index the chain. It also supplies the protocol routing metadata (Pendle, ERC-4626 and similar hints).
2. If V3 fails or returns nothing, the DefiLlama and Uniswap lists are used.
3. Any token missing from the catalog resolves its name, symbol and decimals on-chain through the chain's RPC.

See [Token metadata](../README.md#token-metadata) and [token-list coverage](./token-list-coverage.md).

## 6. Build and deploy

The image is built from the `Dockerfile`. The build needs the `NODE_BASE_REPO` build arg: the repository that holds the `24-slim` and `24-distroless` Node base images. The build runs `generate-config` and `build`.

On every push to `master`, `.github/workflows/build-image.yml` builds the image and pushes it to ECR as `<ECR_REPOSITORY>:<commit SHA>`. It never runs on pull requests, and it runs only in `euler-xyz/euler-orderflow-router`, not in forks.

A deploy is a terraform apply of the swap API stack, with `docker_image_link` set to `<registry>/<ECR_REPOSITORY>:<commit SHA>`. Terraform reads the task's environment from Doppler at apply time. A newly provisioned `RPC_URL_<id>` reaches the service only at the next apply.

Order for a new chain:

1. The Swapper and SwapVerifier are in `EulerChains.json`, and V3 indexes the chain.
2. `add-chain` has written `RPC_URL_<id>`.
3. The config PR is merged and its image is built.
4. Terraform is applied with that image.
5. `GET /providers?chainId=<id>` lists the expected providers, and a quote on the chain succeeds.

### One-time setup for the image workflow

The workflow signs in to AWS with GitHub OIDC; there are no stored keys. A repository admin sets up:

1. **OIDC provider.** The AWS account trusts `token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. Skip this if the account already has it.
2. **IAM role** for the workflow, with this trust policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:euler-xyz/euler-orderflow-router:ref:refs/heads/master"
           }
         }
       }
     ]
   }
   ```

   The `sub` condition limits the role to pushes to `master` in this repository. If the organization customizes its OIDC subject claim, match that format instead. The role's permissions:
   - `ecr:GetAuthorizationToken` on `*`
   - on the swap API repository: `ecr:BatchCheckLayerAvailability`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` and `ecr:PutImage`
   - on the base image repository: `ecr:BatchCheckLayerAvailability`, `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`
3. **ECR repository.** Use the one the swap API stack deploys from. Set its tags to immutable: each tag is a commit SHA and never changes.
4. **Repository secret** `AWS_ROLE_ARN`, the ARN of the role from step 2, under Settings → Secrets and variables → Actions → Secrets. It's a secret, not a variable, so the account ID in it stays masked in this public repository's Actions logs.
5. **Repository variables**, under Settings → Secrets and variables → Actions → Variables:

   | Variable | Value |
   |---|---|
   | `AWS_REGION` | region of the ECR registry |
   | `ECR_REPOSITORY` | name of the repository from step 3 |
   | `NODE_BASE_REPO` | the base image repository URI, without a tag, as passed to `docker build --build-arg` |

The login step signs in to the role account's default registry. `NODE_BASE_REPO` must be in that registry, or the login step needs the base image's registry added under `registries`. Until all four variables are set, the workflow fails at its first step and names the missing ones.
