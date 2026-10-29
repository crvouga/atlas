# The Atlas server: one container that takes in a project's results, keeps them, and shows everyone the report, live.
#
#   docker build -t atlas examples/deploy
#   docker run -p 8080:8080 -e ATLAS_TOKEN=$(openssl rand -hex 24) \
#     -e ATLAS_S3_ENDPOINT=https://s3.us-east-1.amazonaws.com -e ATLAS_S3_BUCKET=my-bucket -e ATLAS_S3_REGION=us-east-1 \
#     -e ATLAS_S3_ACCESS_KEY_ID=... -e ATLAS_S3_SECRET_ACCESS_KEY=... atlas
#
# The container keeps no state. ALL reports and ALL user state (the garbage collection policy, saved settings) live in
# the S3-compatible bucket named by the ATLAS_S3_* variables, which are required: without them the server prints every
# one of them with what is wrong and exits with status 2. There is no local volume and no fallback.
FROM oven/bun:1 AS build
WORKDIR /app
# The version to install. For a tarball, copy it beside this file and build with
#   --build-arg ATLAS_PACKAGE=/context/atlas.tgz
ARG ATLAS_PACKAGE=@crvouga/atlas
COPY . /context
RUN echo '{"name":"atlas-node","private":true}' > package.json && bun add "${ATLAS_PACKAGE}"
# The viewer is built once, for every project: the server tells the page where its data is.
RUN bunx atlas-visualizer build --no-data --out /app/site

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
# Beyond the container it must say who may upload: set ATLAS_TOKEN (and ATLAS_READ_TOKEN for dashboards), or
# ATLAS_INSECURE=1 behind a proxy that signs people in.
ENV ATLAS_PORT=8080 ATLAS_HOST=0.0.0.0
EXPOSE 8080
USER bun
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.ATLAS_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "node_modules/@crvouga/atlas/packages/core/bin/atlas.mjs", "serve", "--site", "/app/site"]
