# Postgres DompetKu: PostgreSQL 17 + pgaudit + pgTAP (PGDG) + WAL-G. Hanya linux/arm64.
# Dibangun di VM DB: docker compose build postgres (tag dompetku-postgres:17.11-1). Pindah ke GHCR di S3.
FROM postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5

ARG WALG_VERSION=v3.0.9
ARG WALG_ASSET=wal-g-pg-20.04-aarch64
ARG WALG_SHA256=891ba47b17fa8b58587f06668d4de4db9469e1034e23e32fa545dd4a6bb40f8e

RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends postgresql-17-pgaudit postgresql-17-pgtap curl ca-certificates; \
	curl -fsSL -o /tmp/walg.tar.gz \
		"https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_ASSET}.tar.gz"; \
	echo "${WALG_SHA256}  /tmp/walg.tar.gz" | sha256sum -c -; \
	tar -xzf /tmp/walg.tar.gz -C /tmp; \
	install -m 755 "/tmp/${WALG_ASSET}" /usr/local/bin/wal-g; \
	rm -f /tmp/walg.tar.gz "/tmp/${WALG_ASSET}"; \
	apt-get purge -y curl; apt-get autoremove -y; rm -rf /var/lib/apt/lists/*; \
	wal-g --version

COPY postgresql.conf pg_hba.conf /etc/dompetku/
# VM DB memakai builder lama (tanpa BuildKit): tanpa COPY --chmod.
COPY dompetku-restore /usr/local/bin/dompetku-restore
RUN chmod 755 /usr/local/bin/dompetku-restore
