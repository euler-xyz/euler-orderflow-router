ARG NODE_BASE_REPO
ARG NODE_BUILD_IMAGE=${NODE_BASE_REPO}:24-slim
ARG NODE_RUNTIME_IMAGE=${NODE_BASE_REPO}:24-distroless

FROM ${NODE_BUILD_IMAGE} AS build

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
