#!/usr/bin/env bash
# Verifikasi backfill kategori awal 0106 untuk ruang yang sudah ada sebelum migrasi (review akhir S6).
# Meniru produksi: database bersih, migrasi hanya s.d. 0105, dua pengguna diprovisikan lewat jalur
# yang sama dengan aplikasi (insert auth."user" + kode pemulihan sebagai dompetku_web, lalu
# api.bootstrap_owner / api.create_invitation / api.accept_invitation dengan app.user_id), lalu
# `dbmate up` penuh. Memeriksa kategori awal terisi per ruang dan tidak ganda bila dbmate up atau
# blok backfill dijalankan ulang.
#
# Butuh cluster lokal dari db-reset-lokal.sh (role dompetku_* sudah ada, 127.0.0.1:5432 trust).
# Memakai database sementara `dompetku_backfill` (dihapus di akhir); database `dompetku` tidak disentuh.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
DB=dompetku_backfill
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
P="psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -q -X"
URL="postgres://dompetku_owner@127.0.0.1:5432/$DB?sslmode=disable"
N=11111111-1111-1111-1111-111111111111
F=22222222-2222-2222-2222-222222222222

# Database bersih dengan pengaturan sama seperti roles/00_roles.sql.
$P -U postgres -d postgres -c "drop database if exists $DB with (force)"
$P -U postgres -d postgres -c "create database $DB owner dompetku_owner"
$P -U postgres -d postgres -c "revoke all on database $DB from public"
$P -U postgres -d postgres -c "grant connect on database $DB to dompetku_web, dompetku_worker, dompetku_monitor"
$P -U postgres -d postgres -c "alter database $DB set timezone = 'UTC'"

# 1. Migrasi hanya s.d. 0105 (keadaan produksi sebelum rilis S6).
mkdir -p "$TMP/m"
for f in "$REPO"/packages/db/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  if [ "$((10#$v))" -le 105 ]; then cp "$f" "$TMP/m/"; fi
done
echo "== migrasi s.d. 0105: $(ls "$TMP/m" | wc -l) berkas, terakhir $(ls "$TMP/m" | tail -1)"
DATABASE_URL=$URL dbmate --migrations-dir "$TMP/m" --no-dump-schema up >/dev/null
echo "env = $($P -U postgres -d $DB -Atc "select value from app.settings where key = 'env'")"

# 2. Provisioning seperti produksi (role web, app.user_id per transaksi).
$P -U dompetku_owner -d $DB -c \
  "insert into app.settings (key, value) values ('owner_email', 'novanda@example.test')
   on conflict (key) do update set value = excluded.value"
web() { # $1 = user id (boleh kosong), $2 = SQL
  $P -U dompetku_web -d $DB -At <<SQL
begin;
select set_config('app.user_id', '$1', true) \\g /dev/null
$2;
commit;
SQL
}
web "" "insert into auth.\"user\" (id, name, email, \"emailVerified\") values ('$N', 'U', 'novanda@example.test', true)"
web "$N" "insert into auth.recovery_codes (user_id, code_hash) values ('$N', '\$argon2id\$v=19\$cek')"
web "$N" "select api.bootstrap_owner('Novanda')" >/dev/null
web "$N" "select api.create_invitation('farida@example.test', pg_catalog.sha256('tok-farida'))" >/dev/null
web "" "insert into auth.\"user\" (id, name, email, \"emailVerified\") values ('$F', 'U', 'farida@example.test', true)"
web "$F" "insert into auth.recovery_codes (user_id, code_hash) values ('$F', '\$argon2id\$v=19\$cek')"
web "$F" "select api.accept_invitation(pg_catalog.sha256('tok-farida'), 'Farida')" >/dev/null

COUNTS="select s.kind::text || ' ' || coalesce(p.display_name, '-') || ': ' || count(c.id)
               || ' kategori, ' || count(*) filter (where c.parent_id is not null) || ' anak, '
               || count(*) filter (where c.is_system) || ' sistem'
          from app.spaces s
          left join app.space_members m on m.space_id = s.id and s.kind = 'personal'
          left join app.profiles p on p.user_id = m.user_id
          left join app.categories c on c.space_id = s.id
         group by s.id, s.kind, p.display_name order by s.kind, p.display_name"
echo "== sebelum 0106"
$P -U postgres -d $DB -At -c "$COUNTS"

# 3. dbmate up penuh (0106 ke atas, termasuk backfill).
DATABASE_URL=$URL dbmate --migrations-dir "$REPO/packages/db/migrations" --no-dump-schema up >/dev/null
echo "== sesudah dbmate up penuh"
$P -U postgres -d $DB -At -c "$COUNTS"
AFTER=$($P -U postgres -d $DB -Atc "select count(*) from app.categories")

# 4. Jalankan ulang: dbmate up (no-op) dan blok backfill 0106 sendiri sebagai pemilik migrasi.
DATABASE_URL=$URL dbmate --migrations-dir "$REPO/packages/db/migrations" --no-dump-schema up >/dev/null
sed -n '/^-- ===== Backfill/,/^-- migrate:down/p' "$REPO/packages/db/migrations/0106_kategori.sql" \
  | grep -v '^-- migrate:down' >"$TMP/backfill.sql"
$P -U dompetku_owner -d $DB -c "begin" -f "$TMP/backfill.sql" -c "commit"
AGAIN=$($P -U postgres -d $DB -Atc "select count(*) from app.categories")
echo "== jalankan ulang: total $AFTER -> $AGAIN"

# 5. Asersi.
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "GAGAL $1: dapat '$2', harap '$3'"; FAIL=1; fi; }
q() { $P -U postgres -d $DB -Atc "$1"; }
check "tiap ruang personal punya 10 kategori awal" \
  "$(q "select string_agg(n::text, ',') from (select count(c.id) n from app.spaces s left join app.categories c on c.space_id = s.id where s.kind = 'personal' group by s.id) x")" "10,10"
check "ruang shared punya 9 kategori awal (1 anak)" \
  "$(q "select count(c.id) || '/' || count(c.parent_id) from app.spaces s join app.categories c on c.space_id = s.id where s.kind = 'shared'")" "9/1"
check "Sayur & Buah di bawah Belanja Dapur" \
  "$(q "select p.name from app.categories c join app.categories p on p.id = c.parent_id where c.name = 'Sayur & Buah'")" "Belanja Dapur"
check "tidak ada nama ganda per ruang/induk/jenis" \
  "$(q "select count(*) from (select 1 from app.categories group by space_id, parent_id, type, name having count(*) > 1) d")" "0"
check "jalankan ulang tidak menambah baris" "$AGAIN" "$AFTER"
check "semua kategori awal is_system" "$(q "select bool_and(is_system) from app.categories")" "t"

$P -U postgres -d postgres -c "drop database $DB with (force)"
exit $FAIL
