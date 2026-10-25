FROM node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS dependencies
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@nodepass/server --workspace=@nodepass/contracts && mkdir -p /app/data /app/packages/server/node_modules /app/packages/contracts/node_modules

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:78f07ef1b5ea71ad7c055df15d0dd8997f2d288f9158623c4d4ae3d765b7d50d AS production
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules
COPY --from=dependencies /app/package.json package.json
COPY --from=dependencies /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=dependencies /app/packages/server/package.json packages/server/package.json
COPY --from=dependencies /app/packages/server/node_modules packages/server/node_modules
COPY --from=dependencies /app/packages/contracts/node_modules packages/contracts/node_modules
COPY --chown=65532:65532 --from=dependencies /app/data data
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY COPYING ./COPYING
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["packages/server/dist/server/src/index.js"]
