# syntax=docker/dockerfile:1
# keepsong-mcp — built in the cloud by `az acr build` (deploy/*.ps1); no local Docker needed.
#
# Stage 1 compiles the server (tsc) and the Keepsong Studio card (Vite → assets/studio.html).
# Stage 2 is the slim runtime: production deps only, plus the files PACKAGE_ROOT expects
# next to dist/ (prompts/, drizzle/, assets/). bookworm-slim is glibc, so better-sqlite3's
# prebuilt binary installs without compilers (it is only loaded when DATABASE_URL is SQLite).
# Node 24 matches the laptop toolchain: the lockfiles are written by npm 11, and npm 10
# (node:22) rejects them as out of sync.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY widgets/package.json widgets/package-lock.json ./widgets/
# --ignore-scripts skips the root `prepare` (tsc) until sources are copied; the widgets
# install keeps scripts because esbuild/vite fetch their platform binaries on postinstall.
RUN npm ci --ignore-scripts && npm --prefix widgets ci
COPY . .
RUN npm run build && npm run build:widgets

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MCP_PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY prompts ./prompts
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
