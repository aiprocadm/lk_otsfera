# syntax=docker/dockerfile:1
# Single production image for BOTH processes:
#   web    → npm run start  (next start)
#   worker → npm run worker (tsx src/worker/index.ts)  [overridden in compose]

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip the `prepare`→husky lifecycle (husky is a devDep, absent
# under --omit=dev → exit 127); Prisma client is generated explicitly below, and
# esbuild/tsx ship their platform binary via optionalDependencies (not a script).
RUN npm ci --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build

# Production node_modules (no devDeps) WITH a Prisma client generated against
# the schema. prisma CLI + tsx are in `dependencies`, so they survive --omit=dev.
FROM node:20-alpine AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# prod deps incl. generated Prisma client, prisma CLI, tsx
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/prisma ./prisma
# web (next start) artifacts
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
# worker (tsx) needs TS source + tsconfig for @/* path resolution
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
