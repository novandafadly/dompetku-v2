#!/bin/sh
# Dump bulanan (pg_dump -Fc) terenkripsi WAL-G ke prefix pg17-monthly/ (lifecycle 400 hari).
# Gagal = ping /fail ke check dompetku-backup. Dipanggil dompetku-monthly.service.
set -u
. /opt/dompetku/env/backup.env
C=dompetku-postgres-1

if docker exec -u postgres -e WALG_S3_PREFIX=s3://dompetku-backup/pg17-monthly "$C" sh -ec '
	f=dompetku-$(date -u +%Y%m%dT%H%M%SZ).dump
	pg_dump -Fc -d dompetku -f "/tmp/$f"
	wal-g st put "/tmp/$f" "$f"
	rm -f "/tmp/$f"
	echo "dump bulanan $f terunggah"'; then
	exit 0
fi
[ -z "${HC_BACKUP_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HC_BACKUP_URL/fail" || true
echo "dump bulanan GAGAL" >&2
exit 1
