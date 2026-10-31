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
SHA1=$(printf 'a%.0s' {1..40})
SHA2=$(printf 'b%.0s' {1..40})
SHA3=$(printf 'c%.0s' {1..40})

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
CFG

# Stub registry + docker. Status simulasi di $SIM: remote (digest tag main), meta (digest sha created),
# unhealthy (digest yang tidak pernah sehat), local (digest di balik dompetku-web:current).
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
      up) echo "up $(cat "$SIM/local")" >>"$SIM/calls" ;;
      ps) [[ $3 == postgres ]] && echo pgcid || echo cid ;;
      config) printf 'gw\npostgres\nweb\n' ;;
      exec) if [[ $* == *pg_stat_archiver* ]]; then echo t; fi ;;
      run) echo "migrate $(cat "$SIM/remote")" >>"$SIM/calls"; [[ ! -e $SIM/migratefail ]] ;;
      stop) echo stop >>"$SIM/calls"; rm -f "$SIM/local" ;;
    esac ;;
  inspect)
    [[ $* == *pgcid* ]] && { echo healthy; exit 0; }
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
META
: >"$SIM/unhealthy"

pass=0
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

echo "$D1" >"$SIM/remote"
check 'deploy pertama' 0 "$D1"
check 'digest sama = tanpa aksi' 0 "$D1"
[[ $(wc -l <"$W/log/deploy.log") == 1 ]] || { echo 'GAGAL: no-op menulis audit'; exit 1; }

echo "$D2" >"$SIM/remote"
echo "$D2" >"$SIM/unhealthy"
check 'rilis rusak di-rollback' 3 "$D1"
[[ $(cat "$SIM/local") == "$D1" ]] || { echo 'GAGAL: tag lokal tidak kembali ke D1'; exit 1; }
check 'digest gagal tidak diulang tiap timer' 0 "$D1"

: >"$SIM/unhealthy"
check 'deploy manual digest yang sudah diperbaiki' 0 "$D2" --digest "$D2"

echo "$D3" >"$SIM/remote"
check 'commit lebih tua ditolak' 2 "$D2"

echo "$D1" >"$SIM/remote"
check 'digest yang pernah berjalan ditolak' 2 "$D2"
check 'rollback manual sengaja diizinkan' 0 "$D1" --digest "$D1" --allow-older

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
rm "$SIM/migratefail"
[[ -f $W/root/migrations/0001_x.sql ]] || { echo 'GAGAL: migrasi tidak disalin dari image'; exit 1; }

grep -q '"result":"rolled_back"' "$W/log/deploy.log" || { echo 'GAGAL: audit rollback'; exit 1; }
echo "$pass skenario lulus"
