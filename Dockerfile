# Base image with corepack and pnpm enabled
FROM 310118226683.dkr.ecr.eu-west-1.amazonaws.com/node:23.7.0-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
# Setup doppler
RUN (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh ) | sh

# Set up pnpm environment
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Set working directory
WORKDIR /app
COPY . .

RUN pnpm i
RUN pnpm run generate-config
RUN pnpm run build

# Expose the application port
EXPOSE 3002

# Start the application
CMD ["pnpm", "start"]
