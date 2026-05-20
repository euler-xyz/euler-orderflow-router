ARG NODE_BASE_REPO

FROM ${NODE_BASE_REPO}:24-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

RUN HUSKY=0 pnpm install --frozen-lockfile

COPY . .

RUN pnpm run generate-config
RUN pnpm run build
RUN pnpm prune --prod --ignore-scripts

FROM ${NODE_BASE_REPO}:24-distroless AS runtime

ENV NODE_ENV=production
ENV PORT=3002
WORKDIR /app

COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/scripts/pnpm-runtime-shim.cjs ./pnpm
COPY --from=build --chown=nonroot:nonroot /app/tokenLists ./tokenLists

USER nonroot

EXPOSE 3002

ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/index.js"]
