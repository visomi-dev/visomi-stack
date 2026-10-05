# Reproducible test fixture from the upstream release source, independent of registry image availability.
FROM docker.io/library/golang:1.24.2-bookworm AS build
ADD https://codeload.github.com/minio/minio/tar.gz/07c3a429bfed433e49018cb0f78a52145d4bedeb /tmp/minio.tar.gz
RUN echo '8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2  /tmp/minio.tar.gz' | sha256sum -c - \
    && mkdir /src \
    && tar -xzf /tmp/minio.tar.gz --strip-components=1 -C /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -o /minio .

FROM docker.io/library/debian:bookworm-slim
COPY --from=build /minio /usr/local/bin/minio
ENV MINIO_UPDATE=off
EXPOSE 9000
ENTRYPOINT ["minio"]
