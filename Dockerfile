ARG NODE_BASE_REPO
ARG NODE_BUILD_IMAGE=${NODE_BASE_REPO}:24-slim
ARG NODE_RUNTIME_IMAGE=${NODE_BASE_REPO}:24-distroless

FROM node:24.22.1-trixie-slim AS patched-node

FROM ${NODE_BUILD_IMAGE} AS build

# Keep custom base images while selecting the security-patched Node executable.
COPY --from=patched-node /usr/local/bin/node /usr/local/bin/node

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

RUN HUSKY=0 pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build
RUN pnpm prune --prod --ignore-scripts

FROM ${NODE_RUNTIME_IMAGE} AS runtime

COPY --from=patched-node /usr/local/bin/node /nodejs/bin/node
RUN ["/nodejs/bin/node", "-e", "if (process.versions.node !== '24.22.1') throw new Error('Unexpected Node.js runtime')"]

ENV NODE_ENV=production
ENV PORT=3002
WORKDIR /app

COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/scripts/pnpm-runtime-shim.cjs ./pnpm

USER nonroot

EXPOSE 3002

ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/index.js"]
