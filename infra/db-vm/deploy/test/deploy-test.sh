#!/usr/bin/env bash
# Uji perilaku deployer tanpa server: docker, curl, cosign, df, logger diganti stub di PATH.
# Jalankan: bash infra/db-vm/deploy/test/deploy-test.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY=$HERE/../deploy
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

D1=sha256:$(printf '1%.0s' {1..64})
D2=sha256:$(printf '2%.0s' {1..64})
D3=sha256:$(printf '3%.0s' {1..64})
D4=sha256:$(printf '4%.0s' {1..64})
D5=sha256:$(printf '5%.0s' {1..64})
D6=sha256:$(printf '6%.0s' {1..64})
D7=sha256:$(printf '7%.0s' {1..64})
SHA1=$(printf 'a%.0s' {1..40})
SHA2=$(printf 'b%.0s' {1..40})
SHA3=$(printf 'c%.0s' {1..40})
SHA4=$(printf 'd%.0s' {1..40})
SHA5=$(printf 'e%.0s' {1..40})
SHA6=$(printf 'f%.0s' {1..40})
SHA7=$(printf '7%.0s' {1..40})

mkdir -p "$W/bin" "$W/root/env" "$W/root/bin" "$W/root/keys" "$W/sim"
touch "$W/root/compose.yml" "$W/root/compose.web.yml"
echo 'kunci publik uji' >"$W/root/keys/cosign.pub"
cat >"$W/root/env/deploy.env" <<CFG
GHCR_USER=u
GHCR_TOKEN=t
VERIFY=cosign-key
COSIGN_PUBLIC_KEY=$W/root/keys/cosign.pub
HEALTH_RETRIES=2
HEALTH_INTERVAL=0
WORKER_STABLE_CHECKS=2
WORKER_INTERVAL=0
CFG

# Stub registry + docker. Status simulasi di $SIM: remote (digest tag main), meta (digest sha created),
# unhealthy (digest yang tidak pernah sehat), local (digest di balik dompetku-web:current),
# worker (digest container worker yang berjalan; tidak ada = worker tidak berjalan), crashloop
# (digest yang worker-nya restart berulang), noworkersvc (compose.yml belum punya layanan worker),
# workerupfail (compose up worker gagal sekali; container lama tetap berjalan).
cat >"$W/bin/curl" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
if [[ $* == *token* ]]; then echo '{"token":"x"}'; exit 0; fi
printf 'HTTP/2 200\r\ndocker-content-digest: %s\r\n\r\n' "$(cat "$SIM/remote")"
STUB
# Stub cosign: wajib --key <pub> dan --insecure-ignore-tlog=true; badsig = tanda tangan salah,
# noattest = tanda tangan sah tetapi attestation SBOM tidak ada.
cat >"$W/bin/cosign" <<'STUB'
#!/usr/bin/env bash
echo "cosign $*" >>"$SIM/cosign-calls"
[[ $* == *"--key $DEPLOY_ROOT/keys/cosign.pub"* && $* == *--insecure-ignore-tlog=true* ]] || exit 9
ref=${*: -1}
[[ $ref == *"$(cat "$SIM/badsig" 2>/dev/null || echo none)"* ]] && exit 1
if [[ $1 == verify-attestation ]]; then
  [[ $* == *'--type spdxjson'* ]] || exit 9
  [[ $ref == *"$(cat "$SIM/noattest" 2>/dev/null || echo none)"* ]] && exit 1
fi
exit 0
STUB
cat >"$W/bin/df" <<'STUB'
#!/usr/bin/env bash
printf 'Filesystem 1M-blocks Used Available Capacity Mounted\n/dev/x 100000 1 90000 1%% /\n'
STUB
printf '#!/usr/bin/env bash\nexit 0\n' >"$W/bin/logger"
cat >"$W/bin/docker" <<'STUB'
#!/usr/bin/env bash
meta() { awk -v d="$1" '$1 == d { print $'"$2"' }' "$SIM/meta"; }
case $1 in
  login) cat >/dev/null ;;
  pull) echo "pull $2" >>"$SIM/calls" ;;
  tag) echo "${2#*@}" >"$SIM/local" ;;
  rmi) echo "rmi $2" >>"$SIM/calls" ;;
  images) cut -d' ' -f1 "$SIM/meta" ;;
  image)
    d=${3#*@}
    [[ $5 == *revision* ]] && meta "$d" 2 || meta "$d" 3 ;;
  create) echo ctr ;;
  cp) mkdir -p "${3%/}" && touch "${3%/}/0001_x.sql" ;;
  rm) ;;
  compose)
    shift
    while [[ $1 == --project-directory || $1 == -f || $1 == --profile ]]; do shift 2; done
    case $1 in
      up)
        svc=${*: -1}
        if [[ $svc == worker && -e $SIM/workerupfail ]]; then rm "$SIM/workerupfail"; exit 1; fi
        echo "up $svc $(cat "$SIM/local")" >>"$SIM/calls"
        if [[ $svc == worker ]]; then cp "$SIM/local" "$SIM/worker"; : >"$SIM/restarts"; fi ;;
      ps)
        case $3 in
          postgres) echo pgcid ;;
          worker) [[ -e $SIM/worker ]] && echo wcid || true ;;
          *) echo cid ;;
        esac ;;
      config)
        printf 'gw\npostgres\nweb\n'
        [[ -e $SIM/noworkersvc ]] || echo worker ;;
      exec) if [[ $* == *pg_stat_archiver* ]]; then echo t; fi ;;
      run) echo "migrate $(cat "$SIM/remote")" >>"$SIM/calls"; [[ ! -e $SIM/migratefail ]] ;;
      stop)
        echo "stop ${*:2}" >>"$SIM/calls"
        [[ $* == *worker* ]] && rm -f "$SIM/worker"
        [[ $* == *web* ]] && rm -f "$SIM/local"
        true ;;
    esac ;;
  inspect)
    [[ $* == *pgcid* ]] && { echo healthy; exit 0; }
    if [[ $* == *wcid* ]]; then
      w=$(cat "$SIM/worker")
      # Worker crash loop: RestartCount naik di setiap inspeksi.
      grep -qxF "$w" "$SIM/crashloop" 2>/dev/null && echo x >>"$SIM/restarts"
      [[ $* == *RestartCount* ]] && echo "running $(wc -l <"$SIM/restarts") $(meta "$w" 2)" || echo running
      exit 0
    fi
    l=$(cat "$SIM/local" 2>/dev/null || true)
    grep -qxF "$l" "$SIM/unhealthy" 2>/dev/null && echo unhealthy || echo healthy ;;
  exec)
    printf '{"status":"ok","sha":"%s"}' "$(meta "$(cat "$SIM/local")" 2)" ;;
  *) echo "stub docker: $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$W/bin/"*

export PATH="$W/bin:$PATH" SIM=$W/sim
export DEPLOY_ROOT=$W/root DEPLOY_STATE_DIR=$W/state DEPLOY_LOG_FILE=$W/log/deploy.log DEPLOY_LOCK_FILE=$W/lock
cat >"$SIM/meta" <<META
$D1 $SHA1 2026-11-01T10:00:00Z
$D2 $SHA2 2026-11-02T10:00:00Z
$D3 $SHA3 2026-10-30T10:00:00Z
$D4 $SHA4 2026-11-03T10:00:00Z
$D5 $SHA5 2026-11-04T10:00:00Z
$D6 $SHA6 2026-11-05T10:00:00Z
$D7 $SHA7 2026-11-06T10:00:00Z
META
: >"$SIM/unhealthy"
: >"$SIM/crashloop"

pass=0
worker_is() { # worker_is <nama> <digest harapan | none>
  local now
  now=$(cat "$SIM/worker" 2>/dev/null || echo none)
  [[ $now == "$2" ]] || { echo "GAGAL: $1 (worker $now, harap $2)"; exit 1; }
}

check() { # check <nama> <kode harapan> <digest current harapan> [argumen deploy...]
  local name=$1 want=$2 cur=$3 got=0
  shift 3
  "$DEPLOY" "$@" 2>>"$W/stderr" || got=$?
  local now
  now=$(cut -d' ' -f1 "$W/state/current" 2>/dev/null || echo none)
  if [[ $got != "$want" || $now != "$cur" ]]; then
    echo "GAGAL: $name (kode $got, harap $want; current $now, harap $cur)"
    tail -n 5 "$W/stderr"
    exit 1
  fi
  echo "ok: $name"
  pass=$((pass + 1))
}

# Deploy pertama sebelum pemilik mengisi env/worker.env: web terpasang, worker dilewati.
echo "$D1" >"$SIM/remote"
check 'deploy pertama tanpa worker.env' 0 "$D1"
worker_is 'worker dilewati tanpa worker.env' none
grep -q '"result":"ok".*"detail":"worker_env_missing"' "$W/log/deploy.log" ||
  { echo 'GAGAL: audit worker_env_missing'; exit 1; }
grep -q 'worker_env_missing' "$W/stderr" || { echo 'GAGAL: log worker_env_missing'; exit 1; }
check 'digest sama = tanpa aksi' 0 "$D1"
[[ $(wc -l <"$W/log/deploy.log") == 1 ]] || { echo 'GAGAL: no-op menulis audit'; exit 1; }

echo 'DATABASE_URL=postgres://uji' >"$W/root/env/worker.env"

echo "$D2" >"$SIM/remote"
echo "$D2" >"$SIM/unhealthy"
check 'rilis rusak di-rollback' 3 "$D1"
[[ $(cat "$SIM/local") == "$D1" ]] || { echo 'GAGAL: tag lokal tidak kembali ke D1'; exit 1; }
check 'digest gagal tidak diulang tiap timer' 0 "$D1"

: >"$SIM/unhealthy"
check 'deploy manual digest yang sudah diperbaiki' 0 "$D2" --digest "$D2"
worker_is 'rilis baru mengganti web lalu worker' "$D2"
grep -A1 "^up web $D2\$" "$SIM/calls" | tail -n 1 | grep -qx "up worker $D2" ||
  { echo 'GAGAL: worker tidak diganti sesudah web'; exit 1; }

echo "$D3" >"$SIM/remote"
check 'commit lebih tua ditolak' 2 "$D2"

echo "$D1" >"$SIM/remote"
check 'digest yang pernah berjalan ditolak' 2 "$D2"
check 'rollback manual sengaja diizinkan' 0 "$D1" --digest "$D1" --allow-older
worker_is 'rollback manual ikut mengganti worker' "$D1"

echo "$D2" >"$SIM/remote"
echo "$D2" >"$SIM/badsig"
sed -i "/$D2/d" "$W/state/history.tsv" "$W/state/failed"
check 'tanda tangan cosign tidak valid ditolak' 2 "$D1"
rm "$SIM/badsig"
echo "$D2" >"$SIM/noattest"
check 'attestation SBOM tidak ada ditolak' 2 "$D1"
rm "$SIM/noattest"
grep -q "^cosign verify-attestation .*--type spdxjson .*@$D2\$" "$SIM/cosign-calls" ||
  { echo 'GAGAL: verify-attestation tidak dipanggil untuk D2'; exit 1; }

mv "$W/root/keys/cosign.pub" "$W/root/keys/cosign.pub.off"
check 'kunci publik cosign hilang = galat konfigurasi' 1 "$D1"
mv "$W/root/keys/cosign.pub.off" "$W/root/keys/cosign.pub"

echo "$D3" >"$SIM/remote"
touch "$SIM/migratefail"
sed -i "/$D3/d" "$W/state/failed"
check 'migrasi gagal: web tidak diganti' 1 "$D1" --digest "$D3" --allow-older
[[ $(cat "$SIM/local") == "$D1" ]] || { echo 'GAGAL: web diganti walau migrasi gagal'; exit 1; }
worker_is 'migrasi gagal: worker tidak diganti' "$D1"
rm "$SIM/migratefail"
[[ -f $W/root/migrations/0001_x.sql ]] || { echo 'GAGAL: migrasi tidak disalin dari image'; exit 1; }

# Worker rilis baru restart berulang: web sudah sehat, tetapi keduanya kembali ke digest lama.
echo "$D4" >"$SIM/remote"
echo "$D4" >"$SIM/crashloop"
check 'worker restart berulang = rollback keduanya' 3 "$D1"
[[ $(cat "$SIM/local") == "$D1" ]] || { echo 'GAGAL: web tidak kembali ke D1'; exit 1; }
worker_is 'worker kembali ke digest lama' "$D1"
grep -q "^up worker $D4\$" "$SIM/calls" || { echo 'GAGAL: worker D4 tidak pernah dipasang'; exit 1; }
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"rolled_back".*worker' ||
  { echo 'GAGAL: audit rollback worker'; exit 1; }
check 'digest worker gagal tidak diulang tiap timer' 0 "$D1"

# Rilis pertama yang memuat worker gagal (worker belum berjalan sebelumnya): image lama tidak punya
# worker.mjs, jadi rollback menghentikan worker alih-alih menyalakannya di image lama.
rm -f "$SIM/worker"
echo "$D5" >"$SIM/remote"
echo "$D5" >"$SIM/crashloop"
check 'worker baru gagal tanpa worker sebelumnya = worker dihentikan' 3 "$D1"
[[ $(cat "$SIM/local") == "$D1" ]] || { echo 'GAGAL: web tidak kembali ke D1'; exit 1; }
worker_is 'worker dihentikan saat rollback' none
grep -q '^stop worker$' "$SIM/calls" || { echo 'GAGAL: worker tidak dihentikan'; exit 1; }

# compose.yml di VM belum diperbarui (tanpa layanan worker): web tetap terpasang, worker dilewati.
: >"$SIM/crashloop"
touch "$SIM/noworkersvc"
echo "$D6" >"$SIM/remote"
check 'compose.yml tanpa layanan worker' 0 "$D6"
worker_is 'worker dilewati tanpa layanan' none
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"ok".*"detail":"worker_service_missing"' ||
  { echo 'GAGAL: audit worker_service_missing'; exit 1; }
rm "$SIM/noworkersvc"

# compose up worker gagal: container worker lama (D6) tetap running tanpa restart, tetapi bukan
# rilis baru (label revision) = gagal, rollback keduanya.
cp "$SIM/local" "$SIM/worker"
: >"$SIM/restarts"
touch "$SIM/workerupfail"
echo "$D7" >"$SIM/remote"
check 'worker tidak terganti = rollback keduanya' 3 "$D6"
[[ $(cat "$SIM/local") == "$D6" ]] || { echo 'GAGAL: web tidak kembali ke D6'; exit 1; }
worker_is 'worker tetap di digest lama' "$D6"

grep -q '"result":"rolled_back"' "$W/log/deploy.log" || { echo 'GAGAL: audit rollback'; exit 1; }
echo "$pass skenario lulus"
