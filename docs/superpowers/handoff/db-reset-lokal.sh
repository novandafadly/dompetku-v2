#!/usr/bin/env bash
# Cluster sekali pakai PG16 di 127.0.0.1:5432 (trust). Reset penuh: roles, dbmate up, setup pgTAP.
set -euo pipefail
REPO=/home/user/dompetku-v2
D=/tmp/pgdata-dk
B=/usr/lib/postgresql/16/bin
if [ ! -f $D/PG_VERSION ]; then
  mkdir -p $D && chown postgres $D
  su postgres -c "$B/initdb -D $D -A trust -U postgres --locale=C.UTF-8 -E UTF8" >/dev/null
  echo "listen_addresses='127.0.0.1'" >> $D/postgresql.conf
  echo "shared_preload_libraries=''" >> $D/postgresql.conf
fi
su postgres -c "$B/pg_ctl -D $D status" >/dev/null 2>&1 || su postgres -c "$B/pg_ctl -D $D -l $D/log -w start" >/dev/null
P="psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists dompetku with (force)"
for r in $($P -d postgres -Atc "select rolname from pg_roles where rolname like 'dompetku%'"); do $P -d postgres -c "drop owned by $r cascade" 2>/dev/null || true; $P -d postgres -c "drop role if exists $r"; done
$P -d postgres -f $REPO/packages/db/roles/00_roles.sql
DATABASE_URL='postgres://dompetku_owner@127.0.0.1:5432/dompetku?sslmode=disable' dbmate --migrations-dir $REPO/packages/db/migrations --no-dump-schema up >/dev/null
$P -d dompetku -f $REPO/packages/db/tests/support/setup.sql
echo "db siap"
