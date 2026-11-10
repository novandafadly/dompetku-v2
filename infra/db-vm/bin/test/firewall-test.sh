#!/usr/bin/env bash
# Uji firewall.sh tanpa server: iptables diganti stub di PATH yang menyimpan tabel aturan di berkas
# (satu baris per aturan: "<rantai> <argumen>", urutan baris = urutan aturan).
# Jalankan: bash infra/db-vm/bin/test/firewall-test.sh
set -euo pipefail
# Tanpa `grep -q` di ujung pipa (lihat komentar di deployer): cocokkan berkas langsung.

HERE=$(cd "$(dirname "$0")" && pwd)
TOOL=${FIREWALL_SH:-$HERE/../firewall.sh}
COMPOSE=$HERE/../../compose.yml
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
SIM=$W/sim
mkdir -p "$W/bin" "$SIM"

# Stub iptables: -N/-F/-X/-C/-I/-A/-D pada rantai filter. -I tanpa nomor = posisi 1 di rantai itu.
# Galat seperti iptables: rantai tidak ada, -N rantai yang sudah ada, -X rantai yang masih dirujuk
# atau berisi, -D/-C aturan yang tidak ada.
cat >"$W/bin/iptables" <<'STUB'
#!/usr/bin/env bash
op=$1 chain=$2
shift 2
rule="$chain $*"
echo "$op $rule" >>"$SIM/calls"
has_chain() { grep -Fx "$1" "$SIM/chains" >/dev/null; }
case $op in
  -N) has_chain "$chain" && exit 1; echo "$chain" >>"$SIM/chains" ;;
  -F) has_chain "$chain" || exit 1; awk -v c="$chain" '$1 != c' "$SIM/rules" >"$SIM/t"; mv "$SIM/t" "$SIM/rules" ;;
  -X)
    has_chain "$chain" || exit 1
    awk -v c="$chain" '$1 == c || $NF == c { f = 1 } END { exit !f }' "$SIM/rules" && exit 1
    grep -Fxv "$chain" "$SIM/chains" >"$SIM/t" || true; mv "$SIM/t" "$SIM/chains" ;;
  -C) has_chain "$chain" || exit 1; grep -Fx -- "$rule" "$SIM/rules" >/dev/null ;;
  -A) has_chain "$chain" || exit 1; echo "$rule" >>"$SIM/rules" ;;
  -I)
    has_chain "$chain" || exit 1
    awk -v c="$chain" -v r="$rule" '!done && $1 == c { print r; done = 1 } { print } END { if (!done) print r }' \
      "$SIM/rules" >"$SIM/t"
    mv "$SIM/t" "$SIM/rules" ;;
  -D)
    grep -Fx -- "$rule" "$SIM/rules" >/dev/null || exit 1
    awk -v r="$rule" '!done && $0 == r { done = 1; next } { print }' "$SIM/rules" >"$SIM/t"
    mv "$SIM/t" "$SIM/rules" ;;
  *) echo "stub iptables: $op" >&2; exit 9 ;;
esac
STUB
chmod +x "$W/bin/iptables"
export PATH="$W/bin:$PATH" SIM

# Keadaan awal VM DB (inventaris-vm.md): INPUT milik host diakhiri REJECT, DOCKER-USER dari Docker.
reset() {
  printf 'INPUT\nFORWARD\nDOCKER-USER\n' >"$SIM/chains"
  cat >"$SIM/rules" <<'R'
INPUT -s 10.0.0.0/16 -j ACCEPT
INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
INPUT -j REJECT
FORWARD -j DOCKER-USER
DOCKER-USER -j RETURN
R
  cp "$SIM/rules" "$SIM/foreign"
  : >"$SIM/calls"
}

pass=0
fail() {
  echo "GAGAL: $1"
  echo '--- aturan:'
  cat "$SIM/rules"
  exit 1
}
ok() {
  pass=$((pass + 1))
  echo "ok $pass - $1"
}
fw() { sh "$TOOL" "$@" >"$W/out" 2>&1; }
chain_rules() { awk -v c="$1" '$1 == c { $1 = ""; sub(/^ /, ""); print }' "$SIM/rules"; }
count() { grep -cF -- "$2" <(chain_rules "$1") || true; }

SUBNET=$(awk '/^  wa_egress:/ { f = 1 } f && /subnet:/ { print $NF; exit }' "$COMPOSE")
JUMP="-s $SUBNET -m conntrack --ctstate NEW -m comment --comment dompetku-wa-egress -j DOMPETKU-WA-EGRESS"
HOST="-s $SUBNET -m conntrack --ctstate NEW -m comment --comment dompetku-wa-host -j DROP"
# Network wa (openwa <-> wa-proxy) dan wa_web (wa-proxy <-> web): subnet dari compose.yml. Gateway
# keduanya terisolasi (tanpa alamat host); DROP INPUT dari subnet itu lapis kedua.
WA_SUBNET=$(awk '/^  wa:/ { f = 1 } f && /subnet:/ { print $NF; exit }' "$COMPOSE")
WA_WEB_SUBNET=$(awk '/^  wa_web:/ { f = 1 } f && /subnet:/ { print $NF; exit }' "$COMPOSE")
host_rule() { echo "-s $1 -m conntrack --ctstate NEW -m comment --comment dompetku-wa-host -j DROP"; }
WANT_CHAIN="-d 169.254.169.254 -p udp --dport 53 -m comment --comment dompetku-wa-dns -j RETURN
-d 169.254.169.254 -p tcp --dport 53 -m comment --comment dompetku-wa-dns -j RETURN
-d 169.254.0.0/16 -m comment --comment dompetku-wa-egress -j DROP
-d 10.0.0.0/8 -m comment --comment dompetku-wa-egress -j DROP
-d 172.16.0.0/12 -m comment --comment dompetku-wa-egress -j DROP
-d 192.168.0.0/16 -m comment --comment dompetku-wa-egress -j DROP
-d 100.64.0.0/10 -m comment --comment dompetku-wa-egress -j DROP"

[[ $SUBNET == 172.16.27.0/24 ]] || fail "subnet wa_egress di compose.yml '$SUBNET', harapan 172.16.27.0/24"
grep -Fx "WA_EGRESS=$SUBNET" "$TOOL" >/dev/null || fail "WA_EGRESS di firewall.sh tidak sama dengan compose.yml ($SUBNET)"
ok 'subnet wa_egress firewall.sh = compose.yml'

[[ $WA_SUBNET == 172.16.26.0/24 && $WA_WEB_SUBNET == 172.16.28.0/24 ]] ||
  fail "subnet wa/wa_web di compose.yml '$WA_SUBNET' '$WA_WEB_SUBNET', harapan 172.16.26.0/24 172.16.28.0/24"
grep -Fx "WA_HOST_SRC='$SUBNET $WA_SUBNET $WA_WEB_SUBNET'" "$TOOL" >/dev/null ||
  fail "WA_HOST_SRC di firewall.sh tidak sama dengan subnet wa_egress, wa, wa_web di compose.yml"
ok 'subnet sumber DROP INPUT firewall.sh = wa_egress, wa, wa_web di compose.yml'

# Gateway wa dan wa_web terisolasi, semua network WhatsApp tanpa IPv6 (compose.yml).
for net in wa wa_web; do
  awk -v n="  $net:" '$0 == n { f = 1; next } f && /^  [a-z_]+:/ { exit } f' "$COMPOSE" >"$W/net"
  grep -F 'com.docker.network.bridge.gateway_mode_ipv4: isolated' "$W/net" >/dev/null ||
    fail "network $net tanpa gateway_mode_ipv4 isolated"
done
for net in wa wa_web wa_egress; do
  awk -v n="  $net:" '$0 == n { f = 1; next } f && /^  [a-z_]+:/ { exit } f' "$COMPOSE" >"$W/net"
  grep -Fx '    enable_ipv6: false' "$W/net" >/dev/null || fail "network $net tanpa enable_ipv6: false"
done
ok 'compose.yml: gateway wa/wa_web terisolasi, wa/wa_web/wa_egress tanpa IPv6'

# --- up dari keadaan bersih.
reset
fw up || fail "up: kode $?"
[[ $(count DOCKER-USER 'dompetku-gw -j DROP') == 2 ]] || fail 'up: aturan gw bukan 2'
[[ $(chain_rules DOCKER-USER | grep -cFx -- "$JUMP") == 1 ]] || fail 'up: lompatan wa_egress bukan tepat 1'
[[ $(chain_rules DOCKER-USER | tail -n 1) == '-j RETURN' ]] || fail 'up: aturan DompetKu tidak sebelum RETURN Docker'
for src in "$SUBNET" "$WA_SUBNET" "$WA_WEB_SUBNET"; do
  [[ $(chain_rules INPUT | head -n 3 | grep -cFx -- "$(host_rule "$src")") == 1 ]] ||
    fail "up: DROP INPUT dari $src bukan tepat 1 di tiga aturan pertama (sebelum ACCEPT 10.0.0.0/16)"
done
[[ $(chain_rules DOMPETKU-WA-EGRESS) == "$WANT_CHAIN" ]] || fail 'up: isi rantai egress (DNS RETURN dulu, lalu DROP) salah'
ok 'up: gw, lompatan egress sebelum RETURN Docker, DROP INPUT (wa_egress, wa, wa_web) pertama, DNS sebelum DROP'

# --- idempoten.
cp "$SIM/rules" "$W/after1"
fw up || fail 'up kedua gagal'
diff -u "$W/after1" "$SIM/rules" >/dev/null || fail 'up kedua mengubah aturan (tidak idempoten)'
ok 'up dua kali = aturan sama'

# --- rantai basi (aturan tambahan/urutan lama) dibangun ulang.
echo 'DOMPETKU-WA-EGRESS -j ACCEPT' >>"$SIM/rules"
fw up || fail 'up di atas rantai basi gagal'
[[ $(chain_rules DOMPETKU-WA-EGRESS) == "$WANT_CHAIN" ]] || fail 'up tidak membangun ulang rantai basi'
ok 'up membangun ulang isi rantai egress'

# --- aturan milik pihak lain tidak tersentuh, down mengembalikan keadaan awal.
for line in 'INPUT -s 10.0.0.0/16 -j ACCEPT' 'INPUT -j REJECT' 'DOCKER-USER -j RETURN'; do
  grep -Fx -- "$line" "$SIM/rules" >/dev/null || fail "up menghapus aturan lain: $line"
done
fw down || fail "down: kode $?"
diff -u "$SIM/foreign" "$SIM/rules" >/dev/null || fail 'down tidak mengembalikan aturan ke keadaan awal'
grep -Fx DOMPETKU-WA-EGRESS "$SIM/chains" >/dev/null && fail 'down: rantai DOMPETKU-WA-EGRESS masih ada'
ok 'down: semua aturan DompetKu dan rantai egress hilang, aturan lain utuh'

fw down || fail 'down kedua gagal'
diff -u "$SIM/foreign" "$SIM/rules" >/dev/null || fail 'down kedua mengubah aturan'
ok 'down dua kali tanpa galat'

# --- duplikat (mis. aturan tersimpan di rules.v4 lalu up lagi) dihapus semua oleh down.
fw up
{
  echo "DOCKER-USER $JUMP"
  echo "INPUT $HOST"
  echo "INPUT $(host_rule "$WA_SUBNET")"
} >>"$SIM/rules"
fw down || fail 'down dengan duplikat gagal'
diff -u "$SIM/foreign" "$SIM/rules" >/dev/null || fail 'down meninggalkan duplikat'
ok 'down menghapus duplikat lompatan dan DROP INPUT'

# --- argumen salah.
rc=0
fw salah || rc=$?
[[ $rc == 2 ]] || fail "argumen salah: kode $rc, harapan 2"
grep -F 'pakai:' "$W/out" >/dev/null || fail 'argumen salah: tanpa pesan pemakaian'
ok 'argumen salah = kode 2'

echo "$pass skenario lulus"
