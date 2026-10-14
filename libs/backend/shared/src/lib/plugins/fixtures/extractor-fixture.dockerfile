FROM docker.io/library/node:24.14.1-alpine
COPY extractor-fixture.mjs /opt/extractor-fixture.mjs
ENTRYPOINT ["node", "/opt/extractor-fixture.mjs"]
