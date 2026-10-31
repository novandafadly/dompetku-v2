#!/bin/sh
# Base backup harian (WAL-G) + ping Healthchecks dompetku-backup. Dipanggil dompetku-backup.service.
# Latihan alert: DRILL_FAIL=1 backup.sh (kredensial salah hanya untuk proses ini).
set -u
. /opt/dompetku/env/backup.env
C=dompetku-postgres-1

hc() { [ -z "${HC_BACKUP_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HC_BACKUP_URL$1" || true; }

hc /start
if [ "${DRILL_FAIL:-0}" = 1 ]; then
	set -- -e AWS_SECRET_ACCESS_KEY=latihan-gagal
else
	set --
fi
if docker exec -u postgres "$@" "$C" sh -c 'wal-g backup-push "$PGDATA"'; then
	hc ""
	echo "base backup selesai"
else
	rc=$?
	hc /fail
	echo "base backup GAGAL (exit $rc)" >&2
	exit "$rc"
fi
