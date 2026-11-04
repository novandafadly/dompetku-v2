#!/bin/sh
# Uji restore mingguan: buat titik pulih di produksi, tunggu WAL-nya terarsip, lalu pulihkan base backup
# terbaru + WAL sampai titik itu di container sementara (archive mati, tanpa akses ke Postgres produksi).
# Lulus = titik pulih tercapai, database terbuka, semua tabel terbaca. Durasi = RTO terukur.
# Dipanggil dompetku-restore-test.service. Ping Healthchecks dompetku-restore-test.
set -u
. /opt/dompetku/env/backup.env
C=dompetku-postgres-1
IMG=dompetku-postgres:17.11-1
R=dompetku-restore-test

hc() { [ -z "${HC_RESTORE_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HC_RESTORE_URL$1" || true; }
fail() {
	echo "uji restore GAGAL: $*" >&2
	docker logs --tail 20 "$R" >&2 2>&1 || true
	docker rm -f -v "$R" >/dev/null 2>&1 || true
	hc /fail
	exit 1
}
prod() { docker exec -u postgres "$C" psql -qtA -d postgres -c "$1"; }
rt() { docker exec -u postgres "$R" psql -qtA -d "$1" -c "$2"; }

hc /start
T0=$(date +%s)
docker rm -f -v "$R" >/dev/null 2>&1 || true

RP=rt_$(date -u +%Y%m%dT%H%M%SZ)
LSN=$(prod "select pg_create_restore_point('$RP')") || fail "titik pulih"
SEG=$(prod "select pg_walfile_name('$LSN')") || fail "nama segmen"
prod "select pg_switch_wal()" >/dev/null || fail "switch WAL"
i=0
until [ "$(prod "select coalesce(last_archived_wal, '') >= '$SEG' from pg_stat_archiver")" = t ]; do
	i=$((i + 1))
	[ $i -gt 60 ] && fail "segmen $SEG tidak terarsip dalam 5 menit"
	sleep 5
done

docker run -d --name "$R" --memory 1g --cpus 1 --env-file /opt/dompetku/env/backup.env \
	-e RP="$RP" -v /r --entrypoint dompetku-restore "$IMG" >/dev/null || fail "container"

i=0
until [ "$(rt postgres 'select not pg_is_in_recovery()' 2>/dev/null)" = t ]; do
	[ "$(docker inspect -f '{{.State.Running}}' "$R" 2>/dev/null)" = true ] || fail "container berhenti sebelum pulih"
	i=$((i + 1))
	[ $i -gt 600 ] && fail "lebih dari 50 menit"
	sleep 5
done

[ "$(rt postgres "select count(*) from pg_database where datname = 'dompetku'")" = 1 ] || fail "database dompetku tidak ada"
[ "$(rt dompetku "select count(*) >= 7 from pg_roles where rolname like 'dompetku\_%'")" = t ] || fail "role kurang"
rt dompetku "select app.today()" >/dev/null || fail "app.today()"
# Skema dibatasi ke milik owner. Jangan tambahkan `pgboss`: tabelnya dibuat dan dimiliki
# dompetku_worker, dan dibaca superuser (sesi ini) = risiko eskalasi (view/fungsi buatan worker
# berjalan dengan hak pemanggil; lihat docs/ops/runbook-s7-worker.md langkah 5).
ROWS=$(rt dompetku "
	do \$\$ declare t record; n bigint; total bigint := 0; begin
	  for t in select schemaname, tablename from pg_tables where schemaname in ('app','audit','auth','public') loop
	    execute format('select count(*) from %I.%I', t.schemaname, t.tablename) into n; total := total + n;
	  end loop; raise notice 'baris=%', total; end \$\$;" 2>&1 | grep -o 'baris=[0-9]*') || fail "baca tabel"
if docker exec "$R" test -f /etc/dompetku/restore-checks.sql; then
	docker exec -u postgres "$R" psql -v ON_ERROR_STOP=1 -qtA -d dompetku -f /etc/dompetku/restore-checks.sql >/dev/null ||
		fail "cek rekonsiliasi"
fi

DUR=$(($(date +%s) - T0))
docker rm -f -v "$R" >/dev/null
hc ""
echo "uji restore LULUS: titik $RP, $ROWS, RTO ${DUR}s"
