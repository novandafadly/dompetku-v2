#!/usr/bin/env bash
# Uji wa-proxy dan gw dengan Caddy sungguhan (versi yang sama dengan image di compose.yml):
#   1. `caddy validate` atas infra/db-vm/gw/Caddyfile (PKI uji sekali pakai) dan wa-proxy/Caddyfile.
#   2. Perilaku wa-proxy: salinan Caddyfile dengan alamat compose diganti alamat loopback
#      (172.16.26.2 -> 127.0.0.2 dst.), backend gema python di tempat web dan openwa.
# Caddy: $CADDY_BIN bila diisi (binary lokal), selain itu image caddy di compose.yml lewat docker
# (--network host). Jalankan: bash infra/db-vm/wa-proxy/test/wa-proxy-test.sh
set -euo pipefail
# Tanpa `grep -q` di ujung pipa (lihat komentar di deployer): cocokkan berkas langsung.

HERE=$(cd "$(dirname "$0")" && pwd)
DBVM=$(cd "$HERE/../.." && pwd)
W=$(mktemp -d)
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  [[ -n ${CTR:-} ]] && docker rm -f "$CTR" >/dev/null 2>&1
  rm -rf "$W"
}
trap cleanup EXIT

IMAGE=$(sed -n 's/^    image: \(caddy:[^ ]*@sha256:[0-9a-f]\{64\}\)$/\1/p' "$DBVM/compose.yml" | sort -u)
[[ $(printf '%s\n' "$IMAGE" | wc -l) == 1 && -n $IMAGE ]] || {
  echo "GAGAL: image caddy di compose.yml tidak tunggal: $IMAGE"
  exit 1
}

# caddy <argumen...> dengan $W terpasang di path yang sama (docker) atau langsung (binary).
caddy() {
  if [[ -n ${CADDY_BIN:-} ]]; then
    "$CADDY_BIN" "$@"
  else
    docker run --rm --network host --user "$(id -u):$(id -g)" -v "$W:$W" -e HOME="$W" \
      -e XDG_DATA_HOME="$W/data" -e XDG_CONFIG_HOME="$W/config" "$IMAGE" caddy "$@"
  fi
}

pass=0
ok() {
  pass=$((pass + 1))
  echo "ok $pass - $1"
}
fail() {
  echo "GAGAL: $1"
  [[ -f $W/caddy.log ]] && tail -n 20 "$W/caddy.log"
  exit 1
}

# --- 1. Validasi kedua Caddyfile -------------------------------------------------------------
mkdir -p "$W/pki" "$W/data" "$W/config"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj /CN=uji \
  -keyout "$W/pki/gw.key" -out "$W/pki/gw.crt" 2>/dev/null
cp "$W/pki/gw.crt" "$W/pki/ca.crt"
sed "s#/pki/#$W/pki/#g" "$DBVM/gw/Caddyfile" >"$W/gw.Caddyfile"
caddy validate --config "$W/gw.Caddyfile" --adapter caddyfile >"$W/out" 2>&1 || { cat "$W/out"; fail 'gw: caddy validate'; }
grep -F 'Valid configuration' "$W/out" >/dev/null || fail 'gw: tanpa "Valid configuration"'
ok 'gw/Caddyfile valid'
cp "$DBVM/wa-proxy/Caddyfile" "$W/wa-proxy.Caddyfile"
caddy validate --config "$W/wa-proxy.Caddyfile" --adapter caddyfile >"$W/out" 2>&1 || { cat "$W/out"; fail 'wa-proxy: caddy validate'; }
grep -F 'Valid configuration' "$W/out" >/dev/null || fail 'wa-proxy: tanpa "Valid configuration"'
ok 'wa-proxy/Caddyfile valid'
cp "$DBVM/gw/Caddyfile" "$W/gw.orig"
for f in gw.orig wa-proxy.Caddyfile; do
  caddy fmt "$W/$f" >"$W/fmt" 2>/dev/null || fail "$f: caddy fmt gagal"
  diff -q "$W/fmt" "$W/$f" >/dev/null || fail "$f: belum berformat caddy fmt"
done
ok 'kedua Caddyfile sudah berformat caddy fmt'

# --- 2. Perilaku wa-proxy --------------------------------------------------------------------
# Alamat compose -> loopback. Port backend: web 13000, openwa 12785.
sed -e 's/172\.16\.26\.2/127.0.0.2/g; s/172\.16\.26\.3/127.0.0.3/g' \
  -e 's/172\.16\.28\.2/127.0.0.4/g; s/172\.16\.28\.3/127.0.0.5/g' \
  -e 's/reverse_proxy web:3000/reverse_proxy 127.0.0.1:13000/; s/reverse_proxy openwa:2785/reverse_proxy 127.0.0.1:12785/' \
  "$DBVM/wa-proxy/Caddyfile" >"$W/test.Caddyfile"
for want in 'bind 127.0.0.2' 'bind 127.0.0.4' 'reverse_proxy 127.0.0.1:13000' 'reverse_proxy 127.0.0.1:12785'; do
  grep -F "$want" "$W/test.Caddyfile" >/dev/null || fail "salinan uji tanpa '$want' (alamat di Caddyfile berubah?)"
done

cat >"$W/echo.py" <<'PY'
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def handle_any(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n) if n else b''
        rec = {'port': self.server.server_port, 'method': self.command, 'path': self.path,
               'headers': {k.lower(): v for k, v in self.headers.items()}, 'body_len': len(body)}
        with open(sys.argv[2], 'a') as f:
            f.write(json.dumps(rec) + '\n')
        out = b'{"ok":true}'
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)
    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = handle_any
    def log_message(self, *a):
        pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
: >"$W/backend.log"
python3 -I "$W/echo.py" 13000 "$W/backend.log" 2>/dev/null &
PIDS+=($!)
python3 -I "$W/echo.py" 12785 "$W/backend.log" 2>/dev/null &
PIDS+=($!)
if [[ -n ${CADDY_BIN:-} ]]; then
  XDG_DATA_HOME=$W/data XDG_CONFIG_HOME=$W/config "$CADDY_BIN" run --config "$W/test.Caddyfile" \
    --adapter caddyfile >"$W/caddy.log" 2>&1 &
  PIDS+=($!)
else
  CTR=wa-proxy-test-$$
  docker run -d --name "$CTR" --network host --read-only --tmpfs /data --tmpfs /config \
    --user 65532:65532 --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
    -v "$W/test.Caddyfile:/etc/caddy/Caddyfile:ro" "$IMAGE" >/dev/null
fi
for _ in $(seq 50); do
  curl --noproxy '*' -s -o /dev/null --interface 127.0.0.3 http://127.0.0.2:8081/ && break
  sleep 0.2
done
[[ -n ${CTR:-} ]] && docker logs "$CTR" >"$W/caddy.log" 2>&1

UUID=0b1c2d3e-4f50-4617-8899-aabbccddeeff
WH=http://127.0.0.2:8081
ST=http://127.0.0.4:2786
# req <nama> <kode harapan> <argumen curl...>: kode dan jumlah request yang sampai ke backend.
req() {
  local name=$1 want=$2 got before after
  shift 2
  before=$(wc -l <"$W/backend.log")
  got=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' -m 15 "$@" || true)
  sleep 0.1
  after=$(wc -l <"$W/backend.log")
  [[ $got == "$want" ]] || fail "$name: kode $got, harapan $want"
  FORWARDED=$((after - before))
}
forwarded() { [[ $FORWARDED == "$2" ]] || fail "$1: $FORWARDED request sampai ke backend, harapan $2"; }
last() { tail -n 1 "$W/backend.log"; }
last_has() { last | grep -F -- "$2" >/dev/null || fail "$1: backend tidak menerima '$2': $(last)"; }
last_hasnt() { ! last | grep -F -- "$2" >/dev/null || fail "$1: backend menerima '$2': $(last)"; }

head -c 65536 /dev/zero | tr '\0' a >"$W/64k"
head -c 65537 /dev/zero | tr '\0' a >"$W/64k1"
head -c 16384 /dev/zero | tr '\0' a >"$W/16k"
head -c 16385 /dev/zero | tr '\0' a >"$W/16k1"

# (a) openwa -> web
req 'webhook' 200 --interface 127.0.0.3 -X POST "$WH/api/wa/webhook" \
  -H 'X-Forwarded-For: 203.0.113.9' -H 'Forwarded: for=203.0.113.9' -H 'X-Real-IP: 203.0.113.9' \
  -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: https' -H 'X-Middleware-Subrequest: middleware' \
  -H 'Next-Action: x' -H 'RSC: 1' -H 'Cookie: s=1' -H 'Authorization: Bearer x' -H 'X-API-Key: k' \
  -H 'X-OpenWA-Signature: sha256=00' -H 'Content-Type: application/json' -d '{"event":"message.received"}'
forwarded 'webhook' 1
last_has 'webhook' '"path": "/api/wa/webhook"'
last_has 'webhook' '"x-openwa-signature": "sha256=00"'
last_has 'webhook' '"host": "127.0.0.1:13000"'
for h in x-forwarded-for forwarded x-real-ip x-forwarded-host x-forwarded-proto x-middleware-subrequest \
  next-action rsc cookie authorization x-api-key 203.0.113.9; do
  last_hasnt 'webhook' "\"$h"
done
ok 'POST /api/wa/webhook diteruskan; XFF, Forwarded, X-Real-IP, X-Middleware-*, Next-*, Cookie, kunci dibuang'
req 'webhook query' 200 --interface 127.0.0.3 -X POST "$WH/api/wa/%77ebhook?_rsc=1&x=2" -d '{}'
last_has 'webhook query' '"path": "/api/wa/webhook"'
ok 'path kanonik tanpa query string sampai ke web'
for m in GET PUT DELETE PATCH; do
  req "webhook $m" 405 --interface 127.0.0.3 -X "$m" "$WH/api/wa/webhook"
  forwarded "webhook $m" 0
done
ok 'metode selain POST ke /api/wa/webhook = 405, tidak diteruskan'
for p in /api/wa/webhook/ /api/wa /api/health /api/auth/sign-in/email /pribadi/whatsapp /; do
  req "path $p" 404 --interface 127.0.0.3 -X POST "$WH$p" -d '{}'
  forwarded "path $p" 0
done
req 'path traversal' 404 --interface 127.0.0.3 --path-as-is -X POST "$WH/api/wa/webhook/../../auth/sign-in/email" -d '{}'
forwarded 'path traversal' 0
ok 'route web lain (auth, health, halaman, traversal) = 404 dari openwa'
req 'webhook 64 KB' 200 --interface 127.0.0.3 -X POST "$WH/api/wa/webhook" --data-binary @"$W/64k"
forwarded 'webhook 64 KB' 1
req 'webhook 64 KB + 1' 413 --interface 127.0.0.3 -X POST "$WH/api/wa/webhook" --data-binary @"$W/64k1"
forwarded 'webhook 64 KB + 1' 0
ok 'body 65536 byte lewat, 65537 byte ditolak 413 sebelum ke web'
req 'webhook chunked besar' 413 --interface 127.0.0.3 -X POST "$WH/api/wa/webhook" \
  -H 'Transfer-Encoding: chunked' --data-binary @"$W/64k1"
ok 'body chunked di atas 64 KB = 413'
req 'webhook alamat lain' 404 --interface 127.0.0.9 -X POST "$WH/api/wa/webhook" -d '{}'
forwarded 'webhook alamat lain' 0
ok 'webhook dari alamat selain openwa = 404'

# (b) web -> openwa
req 'send-text' 200 --interface 127.0.0.5 -X POST "$ST/api/sessions/$UUID/messages/send-text" \
  -H 'X-API-Key: owa_k1_uji' -H 'X-Forwarded-For: 198.51.100.7' -H 'Cookie: s=1' \
  -H 'Content-Type: application/json' -d '{"chatId":"62812@c.us","text":"hai"}'
forwarded 'send-text' 1
last_has 'send-text' "\"path\": \"/api/sessions/$UUID/messages/send-text\""
last_has 'send-text' '"x-api-key": "owa_k1_uji"'
last_has 'send-text' '"host": "127.0.0.1:12785"'
for h in x-forwarded-for x-forwarded-proto x-forwarded-host cookie 198.51.100.7; do last_hasnt 'send-text' "\"$h"; done
ok 'POST send-text (UUID) diteruskan dengan X-API-Key, tanpa X-Forwarded-*'
req 'send-text GET' 405 --interface 127.0.0.5 "$ST/api/sessions/$UUID/messages/send-text"
forwarded 'send-text GET' 0
ok 'GET send-text = 405'
for p in "/api/sessions/dompetku-bot/messages/send-text" "/api/sessions/$UUID/messages/send-media" \
  "/api/sessions/$UUID/messages/send-text/x" "/api/sessions/$UUID/webhooks" "/api/sessions/$UUID/logout" \
  /api/auth/api-keys /api/sessions /api/health /; do
  req "openwa $p" 404 --interface 127.0.0.5 -X POST "$ST$p" -d '{}'
  forwarded "openwa $p" 0
done
req 'openwa %2F' 404 --interface 127.0.0.5 --path-as-is -X POST "$ST/api/sessions/$UUID%2F..%2F..%2Fauth/messages/send-text" -d '{}'
forwarded 'openwa %2F' 0
ok 'API OpenWA lain (nama sesi, media, webhook, logout, api-keys, %2F) = 404'
req 'send-text 16 KB' 200 --interface 127.0.0.5 -X POST "$ST/api/sessions/$UUID/messages/send-text" --data-binary @"$W/16k"
req 'send-text 16 KB + 1' 413 --interface 127.0.0.5 -X POST "$ST/api/sessions/$UUID/messages/send-text" --data-binary @"$W/16k1"
forwarded 'send-text 16 KB + 1' 0
ok 'body send-text 16384 byte lewat, 16385 byte ditolak 413'
req 'send-text alamat openwa' 404 --interface 127.0.0.3 -X POST "$ST/api/sessions/$UUID/messages/send-text" -d '{}'
forwarded 'send-text alamat openwa' 0
ok 'send-text dari alamat selain web = 404'

# Listener hanya di alamatnya sendiri: :2786 tidak ada di alamat sisi openwa, :8081 tidak di sisi web.
for u in "http://127.0.0.2:2786/" "http://127.0.0.4:8081/"; do
  code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' -m 5 "$u" || true)
  [[ $code == 000 ]] || fail "listener terbuka di alamat yang salah: $u ($code)"
done
ok 'listener terikat ke alamatnya sendiri (silang = koneksi ditolak)'

# Log akses: JSON, tanpa header request (X-API-Key, tanda tangan) dan tanpa body.
[[ -n ${CTR:-} ]] && docker logs "$CTR" >"$W/caddy.log" 2>&1
grep -F '"logger":"http.log.access' "$W/caddy.log" >/dev/null || fail 'log akses tidak ada'
for s in owa_k1_uji 'sha256=00' '"headers"' '62812@c.us' 'message.received'; do
  ! grep -F -- "$s" "$W/caddy.log" >/dev/null || fail "log akses memuat '$s'"
done
ok 'log akses JSON tanpa header dan body'

echo "$pass skenario lulus"
