#!/usr/bin/env bash
# Cek sebelum rilis migrasi 0109 (S7): jumlah grup nama dompet aktif yang ganda dalam satu ruang
# (lower(btrim(name)) sama, archived_at null). 0109 menolak berjalan (DK500 duplicate_account_names)
# bila ada grup seperti itu, dan deployer berhenti di dbmate up.
#
# Dijalankan pemilik di VM DB SEBELUM merge PR S7:
#   bash docs/superpowers/handoff/cek-duplikat-dompet-0109.sh
# Hasil 0 = aman di-merge. Hasil > 0 = berhenti; jangan merge, putuskan dulu dompet mana yang
# diganti nama atau diarsipkan (lewat aplikasi), lalu jalankan ulang skrip ini.
#
# Hanya membaca: sesi read only, satu SELECT agregat. Keluaran hanya jumlah grup (tanpa nama
# dompet, id, atau nominal). Koneksi lewat skrip host dompetku-psql (menulis audit
# db_manual_access dan mengirim alert ke email pemilik, BSD §12); argumen diteruskan ke psql pada
# database dompetku. Untuk mencoba di cluster lokal, ganti perintahnya lewat DOMPETKU_PSQL, mis.
#   DOMPETKU_PSQL='psql -h 127.0.0.1 -U postgres -d dompetku' bash docs/superpowers/handoff/cek-duplikat-dompet-0109.sh
set -euo pipefail
PSQL=${DOMPETKU_PSQL:-dompetku-psql}

N=$($PSQL -X -q -At -v ON_ERROR_STOP=1 \
  -c "set default_transaction_read_only = on" \
  -c "select count(*) from (select 1 from app.accounts where archived_at is null
        group by space_id, lower(btrim(name)) having count(*) > 1) d")

if ! [[ $N =~ ^[0-9]+$ ]]; then
  echo "GAGAL: keluaran tidak terduga dari $PSQL" >&2
  exit 2
fi
echo "grup nama dompet ganda: $N"
if [ "$N" -gt 0 ]; then
  echo "BERHENTI: jangan merge S7; 0109 akan ditolak (duplicate_account_names). Minta keputusan pemilik." >&2
  exit 1
fi
