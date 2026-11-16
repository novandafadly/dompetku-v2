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
# 4. Egress worker (network worker_egress, S14: Healthchecks + penyedia harga saham): aturan sama
#    dengan butir 2 (rantai DOMPETKU-WORKER-EGRESS) dan butir 3 (DROP INPUT dari subnet itu), jadi
#    worker yang disusupi tidak bisa mencapai IMDS, VM App, VCN, atau port host. Koneksi worker ke
#    postgres lewat worker_db (subnet lain) tidak tersentuh.
set -eu
EDGE=10.0.0.149
GW=10.0.1.68
WA_EGRESS=172.16.27.0/24
WA_HOST_SRC='172.16.27.0/24 172.16.26.0/24 172.16.28.0/24'
WORKER_EGRESS=172.16.29.0/24
DNS=169.254.169.254
BLOCKED='169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10'
WA_CHAIN=DOMPETKU-WA-EGRESS
WORKER_CHAIN=DOMPETKU-WORKER-EGRESS

rule() { # rule <-C|-I|-D> <port>
	# --ctdir ORIGINAL: hanya arah masuk; paket balasan gw juga membawa ctorigdst yang sama.
	iptables "$1" DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL --ctorigdst "$GW" --ctorigdstport "$2" \
		! -s "$EDGE" -m comment --comment dompetku-gw -j DROP
}

# Lompatan dari DOCKER-USER (paket yang diteruskan ke luar bridge) ke rantai egress.
jump() { # jump <-C|-I|-D> <subnet> <tag wa|worker> <rantai>
	iptables "$1" DOCKER-USER -s "$2" -m conntrack --ctstate NEW \
		-m comment --comment "dompetku-$3-egress" -j "$4"
}

# Port yang terikat di host (bukan container) dijaga INPUT, bukan DOCKER-USER.
host_drop() { # host_drop <-C|-I|-D> <subnet> <tag wa|worker>
	iptables "$1" INPUT -s "$2" -m conntrack --ctstate NEW \
		-m comment --comment "dompetku-$3-host" -j DROP
}

# Isi rantai dibangun ulang setiap `up` (flush lalu append): urutan selalu benar, tanpa duplikat.
chain_fill() { # chain_fill <rantai> <tag wa|worker>
	iptables -N "$1" 2>/dev/null || true
	iptables -F "$1"
	for proto in udp tcp; do
		iptables -A "$1" -d "$DNS" -p "$proto" --dport 53 -m comment --comment "dompetku-$2-dns" -j RETURN
	done
	for net in $BLOCKED; do
		iptables -A "$1" -d "$net" -m comment --comment "dompetku-$2-egress" -j DROP
	done
}

chain_drop() { # chain_drop <rantai>
	if iptables -F "$1" 2>/dev/null; then
		iptables -X "$1"
	fi
}

up() {
	iptables -N DOCKER-USER 2>/dev/null || true
	for p in 8443 9443; do
		rule -C "$p" 2>/dev/null || rule -I "$p"
	done
	chain_fill "$WA_CHAIN" wa
	jump -C "$WA_EGRESS" wa "$WA_CHAIN" 2>/dev/null || jump -I "$WA_EGRESS" wa "$WA_CHAIN"
	for src in $WA_HOST_SRC; do
		host_drop -C "$src" wa 2>/dev/null || host_drop -I "$src" wa
	done
	chain_fill "$WORKER_CHAIN" worker
	jump -C "$WORKER_EGRESS" worker "$WORKER_CHAIN" 2>/dev/null ||
		jump -I "$WORKER_EGRESS" worker "$WORKER_CHAIN"
	host_drop -C "$WORKER_EGRESS" worker 2>/dev/null || host_drop -I "$WORKER_EGRESS" worker
}

down() {
	for p in 8443 9443; do
		while rule -C "$p" 2>/dev/null; do rule -D "$p"; done
	done
	while jump -C "$WA_EGRESS" wa "$WA_CHAIN" 2>/dev/null; do jump -D "$WA_EGRESS" wa "$WA_CHAIN"; done
	for src in $WA_HOST_SRC; do
		while host_drop -C "$src" wa 2>/dev/null; do host_drop -D "$src" wa; done
	done
	chain_drop "$WA_CHAIN"
	while jump -C "$WORKER_EGRESS" worker "$WORKER_CHAIN" 2>/dev/null; do
		jump -D "$WORKER_EGRESS" worker "$WORKER_CHAIN"
	done
	while host_drop -C "$WORKER_EGRESS" worker 2>/dev/null; do host_drop -D "$WORKER_EGRESS" worker; done
	chain_drop "$WORKER_CHAIN"
}

case "${1:-}" in
up) up ;;
down) down ;;
*)
	echo "pakai: $0 up|down" >&2
	exit 2
	;;
esac
