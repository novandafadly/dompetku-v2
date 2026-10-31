# Image produksi web DompetKu (IPD S3). Konteks build = root repo:
#   docker buildx build -f apps/web/Dockerfile --platform linux/arm64 --build-arg BUILD_SHA=$(git rev-parse HEAD) .
#
# Tahap build berjalan di platform builder (tanpa emulasi). Hasil standalone Next murni JS:
# biner native (sharp, tak dipakai karena images.unoptimized) dibuang dan build gagal bila
# masih ada berkas .node, sehingga image arm64 aman dirakit dari runner amd64.
# Tahap runtime tanpa RUN: distroless nodejs, user nonroot (65532), tanpa shell dan paket.

FROM --platform=$BUILDPLATFORM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/demo-data/package.json packages/demo-data/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY . .
# Build produksi: mode prototipe (data demo, /dev/ui) tidak boleh ikut.
RUN test -z "${NEXT_PUBLIC_PROTOTYPE:-}" \
    && rm -f apps/web/.env apps/web/.env.* \
    && pnpm --filter @dompetku/web build \
    && rm -rf apps/web/.next/standalone/node_modules/.pnpm/sharp@* \
              apps/web/.next/standalone/node_modules/.pnpm/@img+* \
    && if find apps/web/.next/standalone -name '*.node' | grep .; then \
         echo 'biner native di standalone: image tidak lagi lintas arsitektur' >&2; exit 1; fi

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:a6c34457f6da4295807e051411c7783739c65b997a324fed14e4fa292615ae91 AS runtime
ARG BUILD_SHA=""
LABEL org.opencontainers.image.source="https://github.com/novandafadly/dompetku-v2" \
      org.opencontainers.image.title="dompetku-web" \
      org.opencontainers.image.revision="${BUILD_SHA}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    BUILD_SHA=${BUILD_SHA}
WORKDIR /app
# Milik root, hanya-baca bagi user nonroot.
COPY --from=build /repo/apps/web/.next/standalone/ ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Migrasi dbmate ikut rilis; deployer menyalinnya ke /opt/dompetku/migrations sebelum dbmate up.
COPY packages/db/migrations ./db/migrations
USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["apps/web/server.js"]
