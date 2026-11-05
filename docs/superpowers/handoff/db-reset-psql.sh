#!/usr/bin/env bash
# Varian db-reset-lokal.sh tanpa dbmate (sandbox tanpa unduhan): migrasi dipasang lewat psql per berkas.
set -euo pipefail
REPO=/home/user/dompetku-v2; D=/tmp/pgdata-dk; B=/usr/lib/postgresql/16/bin; S=$(mktemp -d)
if [ ! -f $D/PG_VERSION ]; then
  mkdir -p $D && chown postgres $D
  su postgres -c "$B/initdb -D $D -A trust -U postgres --locale=C.UTF-8 -E UTF8" >/dev/null
  echo "listen_addresses='127.0.0.1'" >> $D/postgresql.conf
fi
su postgres -c "$B/pg_ctl -D $D status" >/dev/null 2>&1 || su postgres -c "$B/pg_ctl -D $D -l $D/log -w start" >/dev/null
P="psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists dompetku with (force)"
for r in $($P -d postgres -Atc "select rolname from pg_roles where rolname like 'dompetku%'"); do $P -d postgres -c "drop owned by $r cascade" 2>/dev/null || true; $P -d postgres -c "drop role if exists $r"; done
$P -d postgres -f $REPO/packages/db/roles/00_roles.sql
$P -d postgres -c "create database dompetku owner dompetku_owner" 2>/dev/null || true
for f in $(ls $REPO/packages/db/migrations/*.sql | sort); do
  awk '/^-- migrate:up/{u=1;next} /^-- migrate:down/{u=0} u' "$f" > $S/up.sql
  if grep -q '^-- migrate:up transaction:false' "$f"; then psql -h 127.0.0.1 -U dompetku_owner -d dompetku -v ON_ERROR_STOP=1 -q -f $S/up.sql
  else psql -h 127.0.0.1 -U dompetku_owner -d dompetku -v ON_ERROR_STOP=1 -q -1 -f $S/up.sql; fi
done
echo "db siap"
