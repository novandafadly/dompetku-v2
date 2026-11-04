#!/usr/bin/env bash
# Uji perilaku dompetku-psql tanpa server: docker, curl, id diganti stub di PATH.
# Jalankan: bash infra/db-vm/bin/test/dompetku-psql-test.sh
set -euo pipefail
# Tanpa `grep -q` di ujung pipa (lihat komentar di deployer): cocokkan berkas langsung.

HERE=$(cd "$(dirname "$0")" && pwd)
TOOL=$HERE/../dompetku-psql
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

SECRET='https://hc-ping.example/rahasia-uuid-0123456789'
SIM=$W/sim
mkdir -p "$W/bin" "$W/root/env" "$SIM"
touch "$W/root/compose.yml"

# Stub docker compose exec. Panggilan audit (PGAPPNAME=dompetku-psql-audit) menyimpan SQL stdin dan
# argumen; auditfail = psql gagal, auditbad = tanpa id. Panggilan sesi menyimpan argumen, stdin
# (bila -T), dan keluar dengan kode di $SIM/sessionrc.
cat >"$W/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ $* == *PGAPPNAME=dompetku-psql-audit* ]]; then
  echo audit >>"$SIM/order"
  printf '%s\n' "$@" >"$SIM/audit-args"
  cat >"$SIM/audit-sql"
  [[ -e $SIM/auditfail ]] && { echo 'psql: galat tiruan' >&2; exit 2; }
  [[ -e $SIM/auditbad ]] && exit 0
  echo 42
  exit 0
fi
echo session >>"$SIM/order"
printf '%s\n' "$@" >"$SIM/session-args"
if [[ $* == *' -T '* ]]; then cat >"$SIM/session-stdin"; fi
exit "$(cat "$SIM/sessionrc" 2>/dev/null || echo 0)"
STUB
# Stub curl: catat akhiran URL (bukan URL) dan isi; curlfail = gagal sambil mencetak URL ke stderr.
cat >"$W/bin/curl" <<'STUB'
#!/usr/bin/env bash
url=${*: -1}
data=''
while (($#)); do [[ $1 == --data-raw ]] && data=$2; shift; done
case $url in
  */fail) echo 'curl /fail' >>"$SIM/order" ;;
  *) echo 'curl ok' >>"$SIM/order" ;;
esac
printf '%s\n' "$data" >>"$SIM/curl-data"
[[ -e $SIM/curlfail ]] && { echo "curl: (6) gagal $url" >&2; exit 6; }
exit 0
STUB
cat >"$W/bin/id" <<'STUB'
#!/usr/bin/env bash
[[ $1 == -u ]] && { cat "$SIM/uid" 2>/dev/null || echo 0; exit 0; }
exec /usr/bin/id "$@"
STUB
chmod +x "$W/bin/"*

export SIM PATH="$W/bin:$PATH" DOMPETKU_ROOT=$W/root SUDO_USER=novanda

ops() { printf 'HC_MANUAL_ACCESS_URL=%s\n' "$1" >"$W/root/env/ops.env"; }
reset() {
  rm -f "$SIM"/*
  ops "$SECRET"
}

pass=0
fail() {
  echo "GAGAL: $1"
  echo "--- keluaran:"
  cat "$W/out"
  echo "--- urutan:"
  cat "$SIM/order" 2>/dev/null || true
  exit 1
}
# run <nama> <kode harapan> <argumen...>: stdin dari /dev/null kecuali STDIN_FILE diisi.
run() {
  local name=$1 want=$2 rc=0
  shift 2
  bash "$TOOL" "$@" <"${STDIN_FILE:-/dev/null}" >"$W/out" 2>&1 || rc=$?
  [[ $rc == "$want" ]] || fail "$name: kode $rc, harapan $want"
  ! grep -F "$SECRET" "$W/out" >/dev/null || fail "$name: URL Healthchecks tercetak"
  ! grep -F 'rahasia-uuid' "$W/out" >/dev/null || fail "$name: potongan URL tercetak"
}
order_is() { # order_is <nama> <urutan harapan dipisah spasi>
  local got
  got=$(tr '\n' ' ' <"$SIM/order" 2>/dev/null | sed 's/ $//')
  [[ $got == "$2" ]] || fail "$1: urutan '$got', harapan '$2'"
}
has() { grep -F -- "$3" "$2" >/dev/null || fail "$1: '$3' tidak ada di $(basename "$2")"; }
hasnt() { ! grep -F -- "$3" "$2" >/dev/null 2>&1 || fail "$1: '$3' tidak boleh ada di $(basename "$2")"; }
ok() {
  pass=$((pass + 1))
  echo "ok $pass - $1"
}

# --- Argumen dan alasan ditolak sebelum menyentuh DB.
reset
run 'alasan kosong' 2 -- ''
[[ ! -e $SIM/order ]] || fail 'alasan kosong: docker/curl dipanggil'
ok 'ditolak: alasan kosong'
for c in 'tanpa alasan|' 'tanpa alasan sesudah --|--' 'alasan dua karakter|--|ab' \
  "alasan 121 karakter|--|$(printf 'a%.0s' {1..121})" "alasan dengan kutip|--|fix o'neil" \
  'alasan dengan titik koma|--|x; drop table y' 'alasan dengan @ (email)|--|email a@b.c' \
  'alasan hanya spasi|--|     ' 'alasan dengan baris baru|--|baris1
baris2' 'dua alasan|--|satu|dua' '--as salah|--as|root|--|cek' 'opsi tak dikenal|-x|--|cek' \
  '-c kosong|-c||--|cek' '-c tanpa nilai|-c'; do
  reset
  IFS='|' read -r -a parts <<<"${c//$'\n'/$'\x01'}"
  name=${parts[0]}
  args=("${parts[@]:1}")
  args=("${args[@]//$'\x01'/$'\n'}")
  run "$name" 2 "${args[@]}"
  [[ ! -e $SIM/order ]] || fail "$name: docker/curl dipanggil"
  ok "ditolak: $name"
done

reset
run 'alasan 120 karakter diterima' 0 -c 'select 1' -- "$(printf 'a%.0s' {1..120})"
ok 'alasan 120 karakter diterima'

reset
echo 1000 >"$SIM/uid"
run 'bukan root' 2 -- 'owner_email bootstrap'
[[ ! -e $SIM/order ]] || fail 'bukan root: docker dipanggil'
has 'bukan root' "$W/out" 'sudo'
ok 'bukan root ditolak'

# --- Jalur normal (owner, -c): audit -> ping /fail -> psql -> ping sukses.
reset
run 'owner -c' 0 -c 'select 1' -- 'owner_email bootstrap (tiket 1)'
order_is 'owner -c' 'audit curl /fail session curl ok'
has 'owner -c: SQL audit' "$SIM/audit-sql" "'db_manual_access'"
has 'owner -c: SQL audit' "$SIM/audit-sql" "'via', 'cli'"
has 'owner -c: SQL audit pakai variabel' "$SIM/audit-sql" ":'reason'"
hasnt 'owner -c: alasan tidak disisipkan ke SQL' "$SIM/audit-sql" 'tiket 1'
has 'owner -c: audit' "$SIM/audit-args" 'reason=owner_email bootstrap (tiket 1)'
has 'owner -c: audit' "$SIM/audit-args" 'target=dompetku_owner'
has 'owner -c: audit' "$SIM/audit-args" 'op=novanda'
has 'owner -c: audit' "$SIM/audit-args" 'ON_ERROR_STOP=1'
has 'owner -c: sesi' "$SIM/session-args" '-T'
has 'owner -c: sesi' "$SIM/session-args" 'role=dompetku_owner'
has 'owner -c: sesi' "$SIM/session-args" 'idle_in_transaction_session_timeout'
has 'owner -c: sesi' "$SIM/session-args" 'PGAPPNAME=dompetku-psql-42'
has 'owner -c: sesi' "$SIM/session-args" 'select 1'
has 'owner -c: sesi' "$SIM/session-args" 'ON_ERROR_STOP=1'
has 'owner -c: isi ping' "$SIM/curl-data" 'sesi manual dibuka role=dompetku_owner op=novanda event=42'
has 'owner -c: isi ping' "$SIM/curl-data" 'sesi manual ditutup role=dompetku_owner event=42'
hasnt 'owner -c: alasan tidak dikirim ke Healthchecks' "$SIM/curl-data" 'tiket'
ok 'owner -c: audit, alert buka, psql, alert tutup (berurutan)'

# --- Gagal tulis audit = psql tidak dijalankan, tanpa alert.
reset
: >"$SIM/auditfail"
run 'audit gagal' 3 -c 'select 1' -- 'pemulihan faktor'
order_is 'audit gagal' 'audit'
has 'audit gagal' "$W/out" 'sesi tidak dibuka'
ok 'audit gagal = sesi tidak dibuka (fail closed)'

reset
: >"$SIM/auditbad"
run 'audit tanpa id' 3 -- 'pemulihan faktor'
order_is 'audit tanpa id' 'audit'
ok 'audit tanpa id = sesi tidak dibuka'

# --- --as postgres: tanpa role, target postgres.
reset
run 'as postgres' 0 --as postgres -c 'select 1' -- 'disable trigger email_fix'
has 'as postgres' "$SIM/audit-args" 'target=postgres'
hasnt 'as postgres' "$SIM/session-args" 'role='
has 'as postgres' "$SIM/curl-data" 'role=postgres'
ok '--as postgres: superuser tanpa SET ROLE, tercatat target=postgres'

# --- SQL dari stdin (non-interaktif).
reset
printf 'select 2;\n' >"$W/in.sql"
STDIN_FILE=$W/in.sql run 'stdin' 0 -- 'owner_email bootstrap'
order_is 'stdin' 'audit curl /fail session curl ok'
has 'stdin' "$SIM/session-args" '-T'
has 'stdin' "$SIM/session-stdin" 'select 2;'
hasnt 'stdin: SQL tidak masuk audit' "$SIM/audit-sql" 'select 2'
ok 'stdin: SQL sampai ke psql, audit tetap lebih dulu'

# --- Kode psql diteruskan; ping tutup tetap dikirim.
reset
echo 5 >"$SIM/sessionrc"
run 'kode psql' 5 -c 'select 1/0' -- 'cek kunci'
order_is 'kode psql' 'audit curl /fail session curl ok'
ok 'kode keluar psql diteruskan, alert tutup tetap terkirim'

# --- Tanpa ops.env / URL bukan https: jalan dengan peringatan, tanpa curl.
reset
rm -f "$W/root/env/ops.env"
run 'tanpa ops.env' 0 -c 'select 1' -- 'owner_email bootstrap'
order_is 'tanpa ops.env' 'audit session'
has 'tanpa ops.env' "$W/out" 'TIDAK mengirim alert'
ok 'tanpa ops.env: peringatan, sesi tetap dibuka'

reset
ops 'http://hc-ping.example/rahasia-uuid-0123456789'
run 'url http' 0 -c 'select 1' -- 'owner_email bootstrap'
order_is 'url http' 'audit session'
has 'url http' "$W/out" 'bukan URL https'
ok 'URL http ditolak (alert dimatikan, URL tidak dicetak)'

# --- Ping gagal: peringatan tanpa URL, sesi tetap jalan.
reset
: >"$SIM/curlfail"
run 'curl gagal' 0 -c 'select 1' -- 'owner_email bootstrap'
order_is 'curl gagal' 'audit curl /fail session curl ok'
has 'curl gagal' "$W/out" 'ping Healthchecks gagal'
ok 'ping gagal: peringatan tanpa URL, sesi tetap jalan'

# --- SUDO_USER aneh disaring.
reset
SUDO_USER='x;rm -rf /' run 'sudo user aneh' 0 -c 'select 1' -- 'cek'
has 'sudo user aneh' "$SIM/audit-args" 'op=unknown'
ok 'SUDO_USER tidak aman disaring jadi unknown'

echo "$pass skenario lulus"
