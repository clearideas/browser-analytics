# Reference collector (spec/openapi.yaml v1). Build from the repository root:
#   docker build -f sample-host/Dockerfile -t clearideas-analytics-collector .
# The playground is a development tool and is not part of this image.
FROM node:24-alpine

WORKDIR /app
COPY spec/ ./spec/
COPY sample-host/package.json sample-host/package-lock.json ./sample-host/
RUN cd sample-host && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY sample-host/src/ ./sample-host/src/

RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/sample-host

ENV PORT=8787 \
    DATABASE_PATH=/data/analytics.db
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/v1/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
