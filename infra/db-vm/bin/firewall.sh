#!/bin/sh
# Batasi port gw (8443 app, 9443 metrik) hanya untuk IP privat VM App.
# Port Docker melewati FORWARD, bukan INPUT, jadi aturannya di DOCKER-USER.
# Pemakaian: firewall.sh up | down (idempoten). Dipanggil dompetku-firewall.service.
set -eu
EDGE=10.0.0.149
GW=10.0.1.68

rule() { # rule <-C|-I|-D> <port>
	# --ctdir ORIGINAL: hanya arah masuk; paket balasan gw juga membawa ctorigdst yang sama.
	iptables "$1" DOCKER-USER -p tcp -m conntrack --ctdir ORIGINAL --ctorigdst "$GW" --ctorigdstport "$2" \
		! -s "$EDGE" -m comment --comment dompetku-gw -j DROP
}

iptables -N DOCKER-USER 2>/dev/null || true
for p in 8443 9443; do
	case "${1:-}" in
	up) rule -C "$p" 2>/dev/null || rule -I "$p" ;;
	down) while rule -C "$p" 2>/dev/null; do rule -D "$p"; done ;;
	*)
		echo "pakai: $0 up|down" >&2
		exit 2
		;;
	esac
done
