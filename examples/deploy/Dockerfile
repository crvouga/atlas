# The Atlas node: one container that shows a whole project from its object store.
#
#   docker build -t atlas-node examples/deploy
#   docker run -p 8080:8080 -e ATLAS_STORE=s3://my-bucket/atlas/my-project -e AWS_REGION=us-east-1 -e ATLAS_READ_TOKEN atlas-node
#
# Credentials: on AWS give the container a role (ECS task role, EKS IRSA, EC2 profile) and set nothing.
# Anywhere else set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or ATLAS_S3_* for non-AWS stores.
FROM oven/bun:1 AS build
WORKDIR /app
# The version to install. For a tarball, copy it beside this file and build with
#   --build-arg ATLAS_PACKAGE=/context/atlas.tgz
ARG ATLAS_PACKAGE=@crvouga/atlas
COPY . /context
RUN echo '{"name":"atlas-node","private":true}' > package.json && bun add "${ATLAS_PACKAGE}"
# The viewer is built once, for every project: the node tells the page where its data is.
RUN bunx atlas-visualizer build --no-data --out /app/site

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
USER bun
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "node_modules/@crvouga/atlas/packages/core/bin/atlas.mjs", "serve", "--site", "/app/site"]
