#!/bin/sh
# Aturan iptables DompetKu di VM DB. Pemakaian: firewall.sh up | down (idempoten, bisa dibalik).
# Dipanggil dompetku-firewall.service (After/PartOf docker.service: dipasang ulang sesudah Docker
# membangun rantainya). Tidak disimpan ke /etc/iptables/rules.v4: berkas itu milik app lain di VM;
# bila `netfilter-persistent save` sempat menyimpannya, `up` tetap tidak menggandakan aturan.
#
# 1. Port gw (8443 app, 9443 metrik) hanya untuk IP privat VM App. Port Docker melewati FORWARD,
#    bukan INPUT, jadi aturannya di DOCKER-USER.
# 2. Egress openwa (network compose wa_egress, subnet dipatok di compose.yml): koneksi BARU ke
#    IMDS/link-local, VCN (termasuk VM App), jaringan privat lain, CGNAT, dan ke alamat host VM DB
#    sendiri di-DROP; internet (WhatsApp, TCP 443) tetap boleh. Pengecualian: DNS ke resolver VCN
#    169.254.169.254 (resolver tertanam Docker meneruskan kueri dari namespace container ke resolver
#    host bila resolver itu bukan loopback). Balasan koneksi yang sudah ada tidak disentuh (hanya NEW).
# 3. Port yang terikat di host: koneksi BARU dari subnet wa_egress, wa (openwa <-> wa-proxy) dan
#    wa_web (wa-proxy <-> web) ke host di-DROP di INPUT. Gateway wa/wa_web terisolasi di compose.yml
#    (bridge tanpa alamat host); aturan ini lapis kedua bila opsi itu hilang atau daemon lama.
set -eu
EDGE=10.0.0.149
GW=10.0.1.68
WA_EGRESS=172.16.27.0/24
WA_HOST_SRC='172.16.27.0/24 172.16.26.0/24 172.16.28.0/24'
WA_DNS=169.254.169.254
WA_BLOCKED='169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10'
WA_CHAIN=DOMPETKU-WA-EGRESS

rule() { # rule <-C|-I|-D> <port>
	# --ctdir ORIGINAL: hanya arah masuk; paket balasan gw juga membawa ctorigdst yang sama.
	iptables "$1" DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL --ctorigdst "$GW" --ctorigdstport "$2" \
		! -s "$EDGE" -m comment --comment dompetku-gw -j DROP
}

# Lompatan dari DOCKER-USER (paket yang diteruskan ke luar bridge) ke rantai egress openwa.
wa_jump() { # wa_jump <-C|-I|-D>
	iptables "$1" DOCKER-USER -s "$WA_EGRESS" -m conntrack --ctstate NEW \
		-m comment --comment dompetku-wa-egress -j "$WA_CHAIN"
}

# Port yang terikat di host (bukan container) dijaga INPUT, bukan DOCKER-USER.
wa_host() { # wa_host <-C|-I|-D> <subnet>
	iptables "$1" INPUT -s "$2" -m conntrack --ctstate NEW \
		-m comment --comment dompetku-wa-host -j DROP
}

# Isi rantai dibangun ulang setiap `up` (flush lalu append): urutan selalu benar, tanpa duplikat.
wa_chain_fill() {
	iptables -N "$WA_CHAIN" 2>/dev/null || true
	iptables -F "$WA_CHAIN"
	for proto in udp tcp; do
		iptables -A "$WA_CHAIN" -d "$WA_DNS" -p "$proto" --dport 53 -m comment --comment dompetku-wa-dns -j RETURN
	done
	for net in $WA_BLOCKED; do
		iptables -A "$WA_CHAIN" -d "$net" -m comment --comment dompetku-wa-egress -j DROP
	done
}

up() {
	iptables -N DOCKER-USER 2>/dev/null || true
	for p in 8443 9443; do
		rule -C "$p" 2>/dev/null || rule -I "$p"
	done
	wa_chain_fill
	wa_jump -C 2>/dev/null || wa_jump -I
	for src in $WA_HOST_SRC; do
		wa_host -C "$src" 2>/dev/null || wa_host -I "$src"
	done
}

down() {
	for p in 8443 9443; do
		while rule -C "$p" 2>/dev/null; do rule -D "$p"; done
	done
	while wa_jump -C 2>/dev/null; do wa_jump -D; done
	for src in $WA_HOST_SRC; do
		while wa_host -C "$src" 2>/dev/null; do wa_host -D "$src"; done
	done
	if iptables -F "$WA_CHAIN" 2>/dev/null; then
		iptables -X "$WA_CHAIN"
	fi
}

case "${1:-}" in
up) up ;;
down) down ;;
*)
	echo "pakai: $0 up|down" >&2
	exit 2
	;;
esac
