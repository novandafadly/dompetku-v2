#!/bin/sh
# CA privat DompetKu untuk mTLS edge (nginx VM App) -> gw (VM DB). Terpisah dari CA Tanya HPP.
# Jalankan sebagai root di VM DB: pki.sh init | pki.sh renew
# Hasil: /opt/dompetku/pki/{ca,gw,edge}. Kunci CA tidak pernah keluar dari VM DB.
set -eu
umask 077
D=/opt/dompetku/pki

leaf() { # leaf <nama> <eku> <san>
	mkdir -p "$D/$1"
	openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$D/$1/$1.key"
	openssl req -new -key "$D/$1/$1.key" -subj "/O=DompetKu/CN=$1" -out "$D/$1/$1.csr"
	printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=%s\n%s\n' "$2" "$3" >"$D/$1/$1.ext"
	openssl x509 -req -in "$D/$1/$1.csr" -CA "$D/ca/ca.crt" -CAkey "$D/ca/ca.key" -CAcreateserial \
		-days 398 -sha256 -extfile "$D/$1/$1.ext" -out "$D/$1/$1.crt"
	rm -f "$D/$1/$1.csr" "$D/$1/$1.ext"
	cp "$D/ca/ca.crt" "$D/$1/ca.crt"
}

case "${1:-}" in
init)
	[ -e "$D/ca/ca.key" ] && { echo "CA sudah ada" >&2; exit 1; }
	mkdir -p "$D/ca"
	openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$D/ca/ca.key"
	openssl req -x509 -new -key "$D/ca/ca.key" -days 1826 -sha256 -subj "/O=DompetKu/CN=DompetKu Internal CA" \
		-addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign -out "$D/ca/ca.crt"
	;;
renew) ;;
postgres)
	# S2: hanya sertifikat server Postgres (SAN = nama service compose). Kunci dibaca uid 999 (postgres).
	leaf postgres serverAuth subjectAltName=DNS:postgres
	chown 999 "$D/postgres/postgres.key"
	chmod 755 "$D/postgres"
	chmod 644 "$D/postgres/postgres.crt" "$D/postgres/ca.crt"
	openssl x509 -in "$D/postgres/postgres.crt" -noout -enddate
	exit 0
	;;
*)
	echo "pakai: $0 init|renew|postgres" >&2
	exit 2
	;;
esac

leaf gw serverAuth subjectAltName=DNS:dompetku-gw.internal
leaf edge clientAuth subjectAltName=DNS:nginx-app-01
[ -d "$D/postgres" ] && leaf postgres serverAuth subjectAltName=DNS:postgres && chown 999 "$D/postgres/postgres.key"

chmod 700 "$D" "$D"/*
chmod 644 "$D"/*/*.crt
openssl x509 -in "$D/gw/gw.crt" -noout -enddate
