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
D8=sha256:$(printf '8%.0s' {1..64})
D9=sha256:$(printf '9%.0s' {1..64})
DA=sha256:$(printf 'a%.0s' {1..64})
DB=sha256:$(printf 'b%.0s' {1..64})
DC=sha256:$(printf 'c%.0s' {1..64})
DD=sha256:$(printf 'd%.0s' {1..64})
DE=sha256:$(printf 'e%.0s' {1..64})
DF=sha256:$(printf 'f%.0s' {1..64})
DG=sha256:$(printf '0%.0s' {1..64})
DH=sha256:$(printf '12%.0s' {1..32})
DI=sha256:$(printf '13%.0s' {1..32})
DJ=sha256:$(printf '14%.0s' {1..32})
DK=sha256:$(printf '15%.0s' {1..32})
DL=sha256:$(printf '16%.0s' {1..32})
DM=sha256:$(printf '17%.0s' {1..32})
SHA1=$(printf 'a%.0s' {1..40})
SHA2=$(printf 'b%.0s' {1..40})
SHA3=$(printf 'c%.0s' {1..40})
SHA4=$(printf 'd%.0s' {1..40})
SHA5=$(printf 'e%.0s' {1..40})
SHA6=$(printf 'f%.0s' {1..40})
SHA7=$(printf '7%.0s' {1..40})
SHA8=$(printf '8%.0s' {1..40})
SHA9=$(printf '9%.0s' {1..40})
SHAA=$(printf '0%.0s' {1..40})
SHAB=$(printf '1%.0s' {1..40})
SHAC=$(printf '2%.0s' {1..40})
SHAD=$(printf '3%.0s' {1..40})
SHAE=$(printf '4%.0s' {1..40})
SHAF=$(printf '5%.0s' {1..40})
SHAG=$(printf '6%.0s' {1..40})
SHAH=$(printf 'ab%.0s' {1..20})
SHAI=$(printf 'ac%.0s' {1..20})
SHAJ=$(printf 'ad%.0s' {1..20})
SHAK=$(printf 'ae%.0s' {1..20})
SHAL=$(printf 'af%.0s' {1..20})
SHAM=$(printf 'ba%.0s' {1..20})

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
# workerupfail (compose up worker gagal sekali; container lama tetap berjalan), badworkerenv
# (worker.mjs --check-config menolak worker.env), nopgworkernet (postgres belum ikut network
# dompetku_worker_db), oldhba (pg_hba di postgres belum memuat aturan dompetku_worker), openwa
# (container openwa berjalan), waproxy (container wa-proxy berjalan), noopenwasvc (compose.yml belum
# punya layanan openwa), nowaproxysvc (compose.yml tanpa layanan wa-proxy), openwaupfail (compose up
# wa-proxy + openwa gagal).
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
  run)
    echo "run $*" >>"$SIM/calls"
    if [[ -e $SIM/badworkerenv ]]; then
      echo '{"t":"x","event":"config_invalid","fields":["DATABASE_URL","HC_DQ_URL"]}'
      exit 1
    fi
    echo '{"t":"x","event":"config_ok"}' ;;
  compose)
    shift
    while [[ $1 == --project-directory || $1 == -f || $1 == --profile ]]; do shift 2; done
    case $1 in
      up)
        svc=${*: -1}
        if [[ $svc == worker && -e $SIM/workerupfail ]]; then rm "$SIM/workerupfail"; exit 1; fi
        if [[ $* == *openwa* || $* == *wa-proxy* ]]; then
          shift
          while [[ $1 == -* ]]; do shift; done
          echo "up $*" >>"$SIM/calls"
          [[ -e $SIM/openwaupfail ]] && exit 1
          [[ " $* " == *' openwa '* ]] && touch "$SIM/openwa"
          [[ " $* " == *' wa-proxy '* ]] && touch "$SIM/waproxy"
          exit 0
        fi
        echo "up $svc $(cat "$SIM/local")" >>"$SIM/calls"
        if [[ $svc == worker ]]; then cp "$SIM/local" "$SIM/worker"; : >"$SIM/restarts"; fi ;;
      ps)
        case $3 in
          postgres) echo pgcid ;;
          worker) [[ -e $SIM/worker ]] && echo wcid || true ;;
          openwa) [[ -e $SIM/openwa ]] && echo ocid || true ;;
          wa-proxy) [[ -e $SIM/waproxy ]] && echo pcid || true ;;
          *) echo cid ;;
        esac ;;
      config)
        printf 'gw\npostgres\nweb\n'
        [[ -e $SIM/noworkersvc ]] || echo worker
        [[ -e $SIM/noopenwasvc ]] || echo openwa
        [[ -e $SIM/nowaproxysvc ]] || echo wa-proxy ;;
      exec)
        if [[ $* == *pg_stat_archiver* ]]; then echo t; fi
        if [[ $* == *pg_hba_file_rules* ]]; then
          [[ $* == *"'dompetku_worker' = any(user_name) and address = '172.16.25.0' and error is null"* ]] || exit 9
          [[ -e $SIM/oldhba ]] && echo f || echo t
        fi ;;
      run) echo "migrate $(cat "$SIM/remote")" >>"$SIM/calls"; [[ ! -e $SIM/migratefail ]] ;;
      rm)
        echo "rm ${*:2}" >>"$SIM/calls"
        [[ $* == *worker* ]] && rm -f "$SIM/worker"
        [[ $* == *openwa* ]] && rm -f "$SIM/openwa"
        [[ $* == *wa-proxy* ]] && rm -f "$SIM/waproxy"
        true ;;
      stop)
        echo "stop ${*:2}" >>"$SIM/calls"
        [[ $* == *worker* ]] && rm -f "$SIM/worker"
        [[ $* == *web* ]] && rm -f "$SIM/local"
        [[ $* == *openwa* ]] && rm -f "$SIM/openwa"
        [[ $* == *wa-proxy* ]] && rm -f "$SIM/waproxy"
        true ;;
    esac ;;
  inspect)
    if [[ $* == *pgcid* ]]; then
      if [[ $* == *NetworkSettings.Networks* ]]; then
        [[ $* == *'"dompetku_worker_db"'* ]] || exit 9
        [[ -e $SIM/nopgworkernet ]] || echo ok
      else
        echo healthy
      fi
      exit 0
    fi
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
$D8 $SHA8 2026-11-07T10:00:00Z
$D9 $SHA9 2026-11-08T10:00:00Z
$DA $SHAA 2026-11-09T10:00:00Z
$DB $SHAB 2026-11-10T10:00:00Z
$DC $SHAC 2026-11-11T10:00:00Z
$DD $SHAD 2026-11-12T10:00:00Z
$DE $SHAE 2026-11-13T10:00:00Z
$DF $SHAF 2026-11-14T10:00:00Z
$DG $SHAG 2026-11-15T10:00:00Z
$DH $SHAH 2026-11-16T10:00:00Z
$DI $SHAI 2026-11-17T10:00:00Z
$DJ $SHAJ 2026-11-18T10:00:00Z
$DK $SHAK 2026-11-19T10:00:00Z
$DL $SHAL 2026-11-18T12:00:00Z
$DM $SHAM 2026-11-20T10:00:00Z
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
grep -q '^up .*\(openwa\|wa-proxy\)' "$SIM/calls" && { echo 'GAGAL: openwa/wa-proxy dinaikkan tanpa openwa.env'; exit 1; }
grep -q '"result":"ok".*"openwa":"openwa_env_missing"' "$W/log/deploy.log" ||
  { echo 'GAGAL: audit openwa_env_missing'; exit 1; }
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

# worker.env tidak valid untuk rilis baru: ditolak di preflight (check-config dengan image rilis,
# tanpa jaringan), sebelum migrasi dan sebelum web diganti; isi env tidak tercatat.
echo "$D8" >"$SIM/remote"
touch "$SIM/badworkerenv"
check 'worker.env tidak valid = rilis ditolak sebelum web diganti' 2 "$D6"
[[ $(cat "$SIM/local") == "$D6" ]] || { echo 'GAGAL: web diganti walau env worker tidak valid'; exit 1; }
worker_is 'worker tidak disentuh saat env tidak valid' "$D6"
grep -q "^migrate $D8\$" "$SIM/calls" && { echo 'GAGAL: migrasi jalan walau env worker tidak valid'; exit 1; }
grep -q "^run .*--network none.*--env-file $W/root/env/worker.env .*@$D8 worker/worker.mjs --check-config\$" "$SIM/calls" ||
  { echo 'GAGAL: check-config tidak dijalankan dengan image rilis'; exit 1; }
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"rejected".*worker_config_invalid.*DATABASE_URL,HC_DQ_URL' ||
  { echo 'GAGAL: audit worker_config_invalid'; exit 1; }
grep -q 'postgres://uji' "$W/log/deploy.log" "$W/stderr" && { echo 'GAGAL: isi worker.env bocor ke log'; exit 1; }
rm "$SIM/badworkerenv"
check 'env worker diperbaiki = rilis terpasang' 0 "$D8"
worker_is 'worker ikut rilis setelah env diperbaiki' "$D8"

# worker.env dihapus saat worker berjalan: rilis berikutnya menghentikan worker lama (tidak dibiarkan
# basi di belakang web baru).
mv "$W/root/env/worker.env" "$W/root/env/worker.env.off"
echo "$D9" >"$SIM/remote"
check 'worker.env dihapus = worker lama dihentikan' 0 "$D9"
worker_is 'worker basi dihentikan' none
grep -q '^rm -sf worker$' "$SIM/calls" || { echo 'GAGAL: worker tidak dihapus'; exit 1; }
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"ok".*"detail":"worker_env_missing worker_stopped"' ||
  { echo 'GAGAL: audit worker_stopped'; exit 1; }
mv "$W/root/env/worker.env.off" "$W/root/env/worker.env"

# Postgres belum siap untuk worker (runbook S7 langkah 2 baru sebagian): worker dilewati, web
# terpasang, tanpa rollback dan tanpa menyentuh worker lama. A: build postgres gagal = postgres belum
# ikut network worker_db. B: up tanpa build = pg_hba lama tanpa aturan dompetku_worker.
cp "$SIM/local" "$SIM/worker"
: >"$SIM/restarts"
prev=$(cat "$SIM/worker")
for kasus in nopgworkernet oldhba; do
  touch "$SIM/$kasus"
  : >"$SIM/calls"
  next=$([[ $kasus == nopgworkernet ]] && echo "$DC" || echo "$DD")
  echo "$next" >"$SIM/remote"
  check "postgres belum siap untuk worker ($kasus) = worker dilewati" 0 "$next"
  [[ $(cat "$SIM/local") == "$next" ]] || { echo "GAGAL: web tidak terpasang ($kasus)"; exit 1; }
  worker_is "worker lama tidak disentuh ($kasus)" "$prev"
  grep -q '^up worker\|^rm \|^stop \|^run ' "$SIM/calls" && { echo "GAGAL: worker disentuh ($kasus)"; exit 1; }
  tail -n 1 "$W/log/deploy.log" | grep -q '"result":"ok".*"detail":"worker_db_not_ready"' ||
    { echo "GAGAL: audit worker_db_not_ready ($kasus)"; exit 1; }
  grep -q 'worker dilewati: worker_db_not_ready' "$W/stderr" || { echo "GAGAL: log worker_db_not_ready ($kasus)"; exit 1; }
  rm "$SIM/$kasus"
done
echo "$DE" >"$SIM/remote"
check 'postgres siap lagi = worker ikut rilis' 0 "$DE"
worker_is 'worker ikut rilis setelah postgres siap' "$DE"

# OpenWA (runbook-wa): image pihak ketiga, bukan bagian rilis; wa-proxy selalu bersamanya. Tanpa
# env/openwa.env keduanya dilewati; ada env = compose up keduanya sesudah web dan worker; gagal tidak
# menggagalkan web; tidak ikut rollback web.
openwa_audit() { # openwa_audit <nama> <nilai field openwa harapan>
  tail -n 1 "$W/log/deploy.log" | grep -q "\"openwa\":\"$2\"" ||
    { echo "GAGAL: $1 (audit openwa: $(tail -n 1 "$W/log/deploy.log"))"; exit 1; }
}
: >"$SIM/calls"
echo "$DF" >"$SIM/remote"
check 'openwa dilewati tanpa openwa.env, web terpasang' 0 "$DF"
[[ $(cat "$SIM/local") == "$DF" ]] || { echo 'GAGAL: web tidak terpasang tanpa openwa.env'; exit 1; }
[[ ! -e $SIM/openwa ]] || { echo 'GAGAL: openwa berjalan tanpa openwa.env'; exit 1; }
[[ ! -e $SIM/waproxy ]] || { echo 'GAGAL: wa-proxy berjalan tanpa openwa.env'; exit 1; }
grep -q 'openwa\|wa-proxy' "$SIM/calls" && { echo 'GAGAL: openwa/wa-proxy disentuh tanpa openwa.env'; exit 1; }
openwa_audit 'audit openwa_env_missing' openwa_env_missing

echo 'API_MASTER_KEY=rahasia-uji-openwa-0123456789abcdef' >"$W/root/env/openwa.env"
: >"$SIM/calls"
echo "$DG" >"$SIM/remote"
check 'openwa.env ada = wa-proxy + openwa dinaikkan sesudah web' 0 "$DG"
[[ -e $SIM/openwa ]] || { echo 'GAGAL: openwa tidak dinaikkan'; exit 1; }
[[ -e $SIM/waproxy ]] || { echo 'GAGAL: wa-proxy tidak dinaikkan bersama openwa'; exit 1; }
grep -A2 "^up web $DG\$" "$SIM/calls" | tail -n 2 | tr '\n' ' ' | grep -qx "up worker $DG up wa-proxy openwa " ||
  { echo "GAGAL: urutan web, worker, wa-proxy + openwa ($(tr '\n' ' ' <"$SIM/calls"))"; exit 1; }
openwa_audit 'audit openwa_ok' openwa_ok
grep -q 'rahasia-uji-openwa' "$W/log/deploy.log" "$W/stderr" && { echo 'GAGAL: isi openwa.env bocor ke log'; exit 1; }

touch "$SIM/openwaupfail"
echo "$DH" >"$SIM/remote"
check 'compose up wa-proxy + openwa gagal = web tetap terpasang tanpa rollback' 0 "$DH"
[[ $(cat "$SIM/local") == "$DH" ]] || { echo 'GAGAL: web di-rollback karena openwa'; exit 1; }
worker_is 'worker tetap rilis baru walau openwa gagal' "$DH"
openwa_audit 'audit openwa_up_failed' openwa_up_failed
grep -qxF "$DH" "$W/state/failed" && { echo 'GAGAL: digest dicatat failed karena openwa'; exit 1; }
rm "$SIM/openwaupfail"

# Web rilis baru rusak: rollback web (dan worker) ke DH; openwa dan wa-proxy yang berjalan tidak disentuh.
touch "$SIM/openwa" "$SIM/waproxy"
: >"$SIM/calls"
echo "$DI" >"$SIM/remote"
echo "$DI" >"$SIM/unhealthy"
check 'web rusak = rollback tanpa menyentuh openwa' 3 "$DH"
[[ $(cat "$SIM/local") == "$DH" ]] || { echo 'GAGAL: web tidak kembali ke DH'; exit 1; }
[[ -e $SIM/openwa ]] || { echo 'GAGAL: openwa dihentikan saat rollback web'; exit 1; }
[[ -e $SIM/waproxy ]] || { echo 'GAGAL: wa-proxy dihentikan saat rollback web'; exit 1; }
grep -q 'openwa\|wa-proxy' "$SIM/calls" && { echo 'GAGAL: openwa/wa-proxy ikut rollback web'; exit 1; }
openwa_audit 'audit rollback tanpa openwa' ''
: >"$SIM/unhealthy"

# compose.yml di VM belum memuat openwa: dilewati, openwa lama tidak disentuh.
touch "$SIM/noopenwasvc"
: >"$SIM/calls"
echo "$DJ" >"$SIM/remote"
check 'compose.yml tanpa layanan openwa' 0 "$DJ"
grep -q 'openwa\|wa-proxy' "$SIM/calls" && { echo 'GAGAL: openwa disentuh tanpa layanan'; exit 1; }
openwa_audit 'audit openwa_service_missing' openwa_service_missing
rm "$SIM/noopenwasvc"

# compose.yml punya openwa tanpa wa-proxy (openwa akan bicara langsung ke web): tidak dinaikkan.
touch "$SIM/nowaproxysvc"
: >"$SIM/calls"
echo "$DL" >"$SIM/remote"
check 'compose.yml tanpa layanan wa-proxy = openwa tidak dinaikkan' 0 "$DL"
grep -q 'openwa\|wa-proxy' "$SIM/calls" && { echo 'GAGAL: openwa dinaikkan tanpa wa-proxy'; exit 1; }
openwa_audit 'audit openwa_service_missing (tanpa wa-proxy)' openwa_service_missing
rm "$SIM/nowaproxysvc"

# openwa.env dihapus saat openwa berjalan: rilis berikutnya menghentikan dan menghapus container.
rm "$W/root/env/openwa.env"
echo "$DK" >"$SIM/remote"
check 'openwa.env dihapus = openwa dan wa-proxy dihentikan, web terpasang' 0 "$DK"
[[ ! -e $SIM/openwa ]] || { echo 'GAGAL: openwa basi tidak dihentikan'; exit 1; }
[[ ! -e $SIM/waproxy ]] || { echo 'GAGAL: wa-proxy basi tidak dihentikan'; exit 1; }
grep -q '^rm -sf openwa wa-proxy$' "$SIM/calls" || { echo 'GAGAL: openwa/wa-proxy tidak dihapus'; exit 1; }
openwa_audit 'audit openwa_stopped' 'openwa_env_missing openwa_stopped'

# Hanya wa-proxy yang tersisa (mis. openwa dihapus manual): tetap dihentikan tanpa openwa.env.
touch "$SIM/waproxy"
: >"$SIM/calls"
echo "$DM" >"$SIM/remote"
check 'wa-proxy sisa tanpa openwa.env dihentikan' 0 "$DM"
[[ ! -e $SIM/waproxy ]] || { echo 'GAGAL: wa-proxy sisa tidak dihentikan'; exit 1; }
grep -q '^up .*\(openwa\|wa-proxy\)' "$SIM/calls" && { echo 'GAGAL: dinaikkan tanpa openwa.env'; exit 1; }
openwa_audit 'audit wa-proxy sisa' 'openwa_env_missing openwa_stopped'

# Tanpa digest sebelumnya: pesan menyebut hanya layanan yang disentuh.
mv "$W/state" "$W/state.keep"
cp "$SIM/local" "$SIM/worker"
echo "$DA" >"$SIM/remote"
echo "$DA" >"$SIM/crashloop"
check 'worker gagal tanpa digest sebelumnya' 3 none
worker_is 'worker dihentikan tanpa digest sebelumnya' none
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"failed_no_previous".*health worker gagal.*web dan worker dihentikan' ||
  { echo 'GAGAL: audit failed_no_previous worker'; exit 1; }
: >"$SIM/crashloop"
echo "$DB" >"$SIM/remote"
echo "$DB" >"$SIM/unhealthy"
check 'web gagal tanpa digest sebelumnya' 3 none
tail -n 1 "$W/log/deploy.log" | grep -q '"result":"failed_no_previous".*health web gagal.*; web dihentikan"' ||
  { echo 'GAGAL: audit failed_no_previous web menyebut worker'; exit 1; }
: >"$SIM/unhealthy"
rm -rf "$W/state"
mv "$W/state.keep" "$W/state"

grep -q '"result":"rolled_back"' "$W/log/deploy.log" || { echo 'GAGAL: audit rollback'; exit 1; }
echo "$pass skenario lulus"
