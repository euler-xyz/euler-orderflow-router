# Base image with corepack and pnpm enabled
FROM node:23.7.0-slim

ARG GITHUB_TOKEN
ARG GITHUB_USERNAME
ARG GIT_REPO_URL
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
ENV GITHUB_USERNAME=${GITHUB_USERNAME}
ENV GIT_REPO_URL=${GIT_REPO_URL}

ARG RAILWAY_GIT_BRANCH
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
ENV RAILWAY_GIT_BRANCH=${RAILWAY_GIT_BRANCH}

RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
# Setup doppler
RUN (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh ) | sh

# Set up pnpm environment
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Set working directory
WORKDIR /app

RUN test -n "$GITHUB_TOKEN" || (echo "Error: GITHUB_TOKEN is not set" && exit 1)
RUN test -n "$GITHUB_USERNAME" || (echo "Error: GITHUB_USERNAME is not set" && exit 1)
RUN test -n "$GIT_REPO_URL" || (echo "Error: GIT_REPO_URL is not set" && exit 1)

# Configure git authentication
RUN git config --global url."https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

# Clone repository
RUN git clone --depth=1 --single-branch --branch ${RAILWAY_GIT_BRANCH} ${GIT_REPO_URL} .

RUN pnpm i
RUN pnpm run generate-config
RUN pnpm run build

# Expose the application port
EXPOSE 3002

# Start the application
CMD ["pnpm", "start"]
