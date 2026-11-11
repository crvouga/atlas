# Build the server and its project-independent viewer from this commit, never npm's latest release.
# Keep BUN_VERSION aligned with packageManager in package.json.
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY tsconfig.base.json tsconfig.build.json ./
COPY scripts/build-package.ts ./scripts/build-package.ts
COPY packages ./packages
RUN bun run build
# The viewer records where it was built from (shown in its About dialog), so a deployment can tell its viewer and server apart.
ARG ATLAS_REVISION=unknown
ARG ATLAS_BUILD_TIME=
RUN ATLAS_REVISION="${ATLAS_REVISION}" ATLAS_BUILD_TIME="${ATLAS_BUILD_TIME}" bun packages/visualizer/bin/atlas-client.mjs build --no-data --out /app/site
# The runtime uses the same compiled entry points as the npm package.
RUN bun -e 'const p = await Bun.file("package.json").json(); p.exports = p.publishConfig.exports; await Bun.write("runtime-package.json", JSON.stringify(p));'

FROM oven/bun:${BUN_VERSION}-slim AS runtime-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM runtime-dependencies AS runtime
ARG ATLAS_REVISION=unknown
ARG ATLAS_BUILD_TIME=
LABEL org.opencontainers.image.source="https://github.com/crvouga/atlas" \
      org.opencontainers.image.description="Atlas report server and live viewer" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${ATLAS_REVISION}" \
      org.opencontainers.image.created="${ATLAS_BUILD_TIME}"
# The server reports its provenance on /api/server (`build`). The image cannot know its own digest: a deployment that
# knows it may set ATLAS_IMAGE_DIGEST=sha256:<hex> at runtime.
ENV ATLAS_REVISION=${ATLAS_REVISION} ATLAS_BUILD_TIME=${ATLAS_BUILD_TIME}
COPY --from=build /app/runtime-package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/core/bin ./packages/core/bin
# Settings bundles shared viewer modules on first request, including the command palette.
# Keep the complete source tree so adding a shared import cannot break the runtime image.
COPY --from=build /app/packages/visualizer/bin ./packages/visualizer/bin
COPY --from=build /app/packages/visualizer/src ./packages/visualizer/src
COPY --from=build /app/site ./site
# Leave ATLAS_PORT unset: Railway supplies PORT, and Atlas already defaults to 8080 otherwise.
ENV ATLAS_HOST=0.0.0.0 ATLAS_SITE=/app/site
# The container keeps no state: all reports and user state (garbage collection policy, saved settings) live in
# S3-compatible storage. The server refuses to start, and lists what is missing, unless these are set:
#   ATLAS_S3_ENDPOINT ATLAS_S3_BUCKET ATLAS_S3_REGION ATLAS_S3_ACCESS_KEY_ID ATLAS_S3_SECRET_ACCESS_KEY
EXPOSE 8080
USER bun
WORKDIR /app
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.ATLAS_PORT||process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bun", "/app/packages/core/bin/atlas.mjs", "serve"]

# Same server and viewer, with anonymous read, publish and admin access when no tokens are set.
FROM runtime AS insecure
ENV ATLAS_INSECURE=true
LABEL org.opencontainers.image.description="Atlas report server and live viewer with anonymous full access"

# Keep an unqualified docker build on the authenticated image.
FROM runtime AS default
