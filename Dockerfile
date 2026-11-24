# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG GO_VERSION=1.24

FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /src/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM golang:${GO_VERSION}-alpine AS backend
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src

COPY go.mod ./
COPY backend/ ./backend/
COPY --from=frontend /src/backend/web/dist ./backend/web/dist

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/kubedeck ./backend

FROM gcr.io/distroless/static-debian12:nonroot

ARG VERSION=dev
LABEL org.opencontainers.image.title="KubeDeck" \
      org.opencontainers.image.description="Kubernetes operations dashboard" \
      org.opencontainers.image.source="https://github.com/zhuqiyang/KubeDeck" \
      org.opencontainers.image.version="${VERSION}"

COPY --from=backend --chown=nonroot:nonroot /out/kubedeck /kubedeck

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/kubedeck"]
