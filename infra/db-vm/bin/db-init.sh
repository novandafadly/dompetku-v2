#!/bin/sh
# Sekali setelah container postgres S2 pertama kali hidup (idempoten): role + database BSD,
# password role (acak, tidak ditampilkan), pgaudit per role, dan migrate.env untuk dbmate.
# Jalankan sebagai root di VM DB.
set -eu
umask 077
E=/opt/dompetku/env
C=dompetku-postgres-1

q() { # q <db> : SQL dari stdin sebagai superuser lewat socket (peer)
	docker exec -i -u postgres "$C" psql -v ON_ERROR_STOP=1 -qtA -d "$1"
}

if [ ! -s "$E/db-roles.env" ]; then
	for r in OWNER WEB WORKER MONITOR; do
		printf 'DOMPETKU_%s_PASSWORD=%s\n' "$r" "$(openssl rand -hex 24)"
	done >"$E/db-roles.env"
	echo "db-roles.env dibuat (nilai acak)"
fi
. "$E/db-roles.env"

if [ "$(echo "select count(*) from pg_roles where rolname = 'dompetku_owner'" | q postgres)" = 0 ]; then
	q postgres </opt/dompetku/sql/00_roles.sql
	echo "role dan database dompetku dibuat"
fi

# Password tidak boleh masuk log: matikan log_statement dan pgaudit untuk sesi ini saja.
q postgres <<EOF
set log_statement = 'none';
set pgaudit.log = 'none';
alter role dompetku_owner   password '$DOMPETKU_OWNER_PASSWORD';
alter role dompetku_web     password '$DOMPETKU_WEB_PASSWORD';
alter role dompetku_worker  password '$DOMPETKU_WORKER_PASSWORD';
alter role dompetku_monitor password '$DOMPETKU_MONITOR_PASSWORD';
alter role postgres         set pgaudit.log = 'all';
alter role dompetku_owner   set pgaudit.log = 'write, ddl, role';
EOF
echo "password role dan pgaudit per role diset"

printf 'DATABASE_URL=postgres://dompetku_owner:%s@postgres:5432/dompetku?sslmode=verify-full&sslrootcert=/etc/dompetku/ca.crt\n' \
	"$DOMPETKU_OWNER_PASSWORD" >"$E/migrate.env"
chmod 600 "$E/db-roles.env" "$E/migrate.env"
echo "migrate.env ditulis"
