# Production image. Coolify builds this file. The patch matches .nvmrc.
# Node 25 and later do not ship Corepack.
FROM node:26.13.1-bookworm-slim AS base

# set for base and all layers that inherit from it
ENV NODE_ENV=production
ENV HUSKY=0

# openssl for Prisma. python/make/g++ build native modules such as sharp.
RUN apt-get update && apt-get install -y openssl wget python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global corepack@0.36.0 \
  && corepack enable \
  && corepack prepare pnpm@10.27.0 --activate

# Install all node_modules, including dev dependencies
FROM base AS deps

WORKDIR /myapp

COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY patches ./patches
COPY prisma ./prisma
# prisma.config.ts imports this module, and postinstall runs prisma generate.
COPY app/lib/prisma-command-url.ts ./app/lib/prisma-command-url.ts
# HUSKY=0 skips the git hooks. The schema is here so postinstall can generate the client.
RUN pnpm install --frozen-lockfile --prod=false

# Setup production node_modules
FROM base AS production-deps

WORKDIR /myapp

COPY --from=deps /myapp/node_modules /myapp/node_modules
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm prune --prod --ignore-scripts

# Build the app
FROM base AS build

WORKDIR /myapp

COPY --from=deps /myapp/node_modules /myapp/node_modules

COPY . .
RUN pnpm exec prisma generate && pnpm run build

# Finally, build the production image with minimal footprint
FROM base

WORKDIR /myapp

COPY --from=production-deps /myapp/node_modules /myapp/node_modules

COPY --from=build /myapp/build /myapp/build
COPY --from=build /myapp/public /myapp/public
COPY --from=build /myapp/scripts /myapp/scripts
COPY --from=build /myapp/prisma /myapp/prisma
COPY --from=build /myapp/package.json /myapp/package.json
COPY --from=build /myapp/prisma.config.ts /myapp/prisma.config.ts
# prisma.config.ts imports this at migrate time. The rest of app/ is bundled.
COPY --from=build /myapp/app/lib/prisma-command-url.ts /myapp/app/lib/prisma-command-url.ts

EXPOSE 3000

CMD ["pnpm", "start"]
