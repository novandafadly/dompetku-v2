# Runbook S1: provisioning dan jaringan

Dasar: `docs/ops/inventaris-vm.md` (2026-10-31), IPD §3 S1, TRD §2, Spec §9.2. Dijalankan dari sesi Claude Code di VM App (SSH ke VM DB `10.0.1.68`), satu langkah lalu verifikasi.

Notasi: `[DB]` = perintah di VM DB (`ssh -i ~/.ssh/db_key.pem ubuntu@10.0.1.68`), `[APP]` = di VM App, `[PEMILIK]` = dikerjakan pemilik. Semua berkas DompetKu ada di `/opt/dompetku` (VM DB) dan `/etc/nginx/{sites-available/dompetku,dompetku-pki}` (VM App). Tidak ada perubahan pada berkas, container, volume, atau aturan firewall milik app lain.

## Rancangan

```
Browser --443--> nginx VM App (TLS Let's Encrypt, tulis ulang header forward)
          --mTLS TLS1.3, IP privat--> 10.0.1.68:8443 gw (Caddy, compose "dompetku")
                                       --network app--> web (S3; S1: halaman sementara)
                                       web/worker --network internal (tanpa egress, tanpa port host)--> postgres
```

- Port host baru: hanya `10.0.1.68:8443` (app) dan `10.0.1.68:9443` (metrik, S1 menjawab 503). Tidak ada port publik baru; 80/443 VM App sudah terbuka.
- Pembatasan sumber: `DOCKER-USER` (bukan `INPUT`, karena port Docker tidak melewati `INPUT`) hanya `10.0.0.149`, plus mTLS dari CA DompetKu sendiri (terpisah dari CA Tanya HPP).
- Header: nginx menimpa `X-Forwarded-For` dengan IP koneksi, memaksa `X-Forwarded-Proto https`, membuang `X-Forwarded-Host`, `Forwarded`, `X-Real-IP`, `X-Middleware-Subrequest`. `gw` hanya mempercayai XFF dari `10.0.0.149` (`trusted_proxies_strict`), membuang header yang sama sekali lagi, dan meneruskan XFF satu nilai.
- Security list OCI tidak perlu diubah: 8443/9443 dari subnet VM App sudah lolos (inventaris).
- `unattended-upgrades` sudah aktif di kedua VM; S1 hanya memverifikasi.

Berkas di repo: `infra/db-vm/{compose.yml,gw/Caddyfile,bin/pki.sh,bin/firewall.sh,systemd/dompetku-firewall.service,env/postgres.env.example}`, `infra/app-vm/nginx/dompetku.conf`.

## Langkah

### 0. Baseline (hanya baca)

```bash
# [APP] status site lain; simpan untuk pembanding langkah 9
for h in analytics chatbot-ai daslok minimaltrade rekon-cogs tanya trading; do
  printf "%s %s\n" $h $(curl -s -o /dev/null -w '%{http_code}' https://$h.novandafadly.com/); done
# [APP] dan [DB]
docker ps --format '{{.Names}} {{.Status}}' | sort; sudo iptables -S > ~/iptables-before-dompetku.txt
```

Baseline 2026-10-31: analytics 200, chatbot-ai 200, daslok 401, minimaltrade 401, rekon-cogs 401, tanya 302, trading 307.

### 1. [PEMILIK] DNS

Di Hostinger (zona `novandafadly.com`) tambahkan:

| Tipe | Nama     | Nilai             | TTL  |
| ---- | -------- | ----------------- | ---- |
| A    | `dompet` | `168.110.202.175` | 3600 |

Tanpa AAAA (VM App tidak punya IPv6 publik). CAA tidak diperlukan.

- Verifikasi: `dig +short A dompet.novandafadly.com` = `168.110.202.175` (juga `dig @8.8.8.8`).
- Rollback: hapus record.

Langkah 2 sampai 6 boleh jalan sambil menunggu propagasi.

### 2. [DB] Direktori dan berkas

```bash
sudo install -d -o root -g root -m 755 /opt/dompetku /opt/dompetku/bin /opt/dompetku/gw
sudo install -d -o root -g root -m 700 /opt/dompetku/env
sudo install -m 644 compose.yml /opt/dompetku/compose.yml
sudo install -m 644 gw/Caddyfile /opt/dompetku/gw/Caddyfile
sudo install -m 755 bin/pki.sh bin/firewall.sh /opt/dompetku/bin/
sudo install -m 600 env/postgres.env.example /opt/dompetku/env/postgres.env
```

(berkas disalin dari `infra/db-vm/` lewat `scp` ke `/tmp/dompetku-s1/` lebih dulu)

- Verifikasi: `sudo ls -lR /opt/dompetku`; `env/postgres.env` `600 root`.
- Rollback: `sudo rm -rf /opt/dompetku`.

### 3. [PEMILIK] Isi rahasia Postgres sementara

```bash
sudo nano /opt/dompetku/env/postgres.env   # isi POSTGRES_PASSWORD (acak, ≥ 32 karakter)
```

Contoh membuat nilai tanpa menampilkannya: `sudo sh -c 'printf "POSTGRES_PASSWORD=%s\n" "$(openssl rand -hex 24)" > /opt/dompetku/env/postgres.env'`. Password ini hanya untuk volume sementara S1; S2 menginisialisasi ulang.

- Verifikasi (oleh Claude, tanpa mencetak isi): `sudo grep -c '^POSTGRES_PASSWORD=.\{16,\}' /opt/dompetku/env/postgres.env` = 1.

### 4. [DB] CA dan sertifikat mTLS

```bash
sudo /opt/dompetku/bin/pki.sh init      # CA 5 tahun, sertifikat gw dan edge 398 hari
```

- Verifikasi: `sudo openssl verify -CAfile /opt/dompetku/pki/ca/ca.crt /opt/dompetku/pki/{gw/gw,edge/edge}.crt` OK; kunci `600`.
- Rollback: `sudo rm -rf /opt/dompetku/pki`.
- Perpanjangan: `pki.sh renew` sebelum 398 hari (pengingat masuk runbook operasi S3).

### 5. [DB] Firewall `DOCKER-USER`

```bash
sudo install -m 644 systemd/dompetku-firewall.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dompetku-firewall.service
```

Tidak menyentuh `/etc/iptables/rules.v4`; aturan dipasang ulang oleh unit setiap Docker start.

- Verifikasi: `sudo iptables -S DOCKER-USER` memuat 2 aturan `dompetku-gw` (8443, 9443) dan tidak ada yang lain berubah (`diff` dengan `~/iptables-before-dompetku.txt`).
- Rollback: `sudo systemctl disable --now dompetku-firewall.service && sudo rm /etc/systemd/system/dompetku-firewall.service`.

### 6. [DB] Compose project `dompetku`

```bash
cd /opt/dompetku
sudo docker compose run --rm --no-deps --entrypoint caddy gw validate --config /etc/caddy/Caddyfile
sudo docker compose up -d
```

- Verifikasi:
  - `docker compose -p dompetku ps`: `gw`, `placeholder`, `postgres` (healthy).
  - `docker port dompetku-postgres-1` kosong; `sudo ss -tlnp | grep -E ':(5437|5432)\b'` tidak bertambah dibanding inventaris.
  - `docker network inspect dompetku_internal -f '{{.Internal}}'` = `true`.
  - Dari VM App tanpa sertifikat klien: `curl -k https://10.0.1.68:8443/` gagal handshake.
  - `sudo iptables -L DOCKER-USER -v -n`: aturan `dompetku-gw` ada. Catatan: koneksi dari VM DB ke IP-nya sendiri tidak melewati `FORWARD`, jadi tidak bisa dipakai untuk menguji `DROP`; di jalur itu yang menolak adalah mTLS.
  - Dengan sertifikat edge dari VM App: Host `dompet.novandafadly.com` = 200, Host lain = 421, `:9443` = 503.
- Rollback: `cd /opt/dompetku && sudo docker compose down -v` (hanya project `dompetku`).

### 7. [APP] Sertifikat klien edge dan TLS publik

```bash
# salin edge.{crt,key} + ca.crt dari VM DB lewat ssh (tanpa menampilkan kunci)
sudo install -d -m 750 -o root -g www-data /etc/nginx/dompetku-pki
ssh -i ~/.ssh/db_key.pem ubuntu@10.0.1.68 'sudo cat /opt/dompetku/pki/edge/edge.key' | sudo install -m 640 -o root -g www-data /dev/stdin /etc/nginx/dompetku-pki/edge.key
# (edge.crt dan ca.crt dengan cara sama, mode 644)

# setelah DNS langkah 1 terverifikasi:
sudo certbot certonly --nginx -d dompet.novandafadly.com --non-interactive   # akun certbot yang sudah ada
```

`certonly` hanya meminta sertifikat dan tidak mengubah konfigurasi nginx. Perpanjangan memakai `certbot.timer` dan deploy hook `reload-nginx.sh` yang sudah ada.

- Verifikasi: `sudo certbot certificates` memuat `dompet.novandafadly.com`.
- Rollback: `sudo certbot delete --cert-name dompet.novandafadly.com`; `sudo rm -rf /etc/nginx/dompetku-pki`.

### 8. [APP] Site nginx

```bash
sudo install -m 644 dompetku.conf /etc/nginx/sites-available/dompetku
sudo ln -s /etc/nginx/sites-available/dompetku /etc/nginx/sites-enabled/dompetku
sudo nginx -t && sudo systemctl reload nginx
```

`reload` (bukan `restart`), jadi koneksi site lain tidak putus; bila `nginx -t` gagal, reload tidak dijalankan.

- Verifikasi:
  - `curl -sI https://dompet.novandafadly.com/` = 200, `Strict-Transport-Security` ada, isi "DompetKu sedang disiapkan".
  - `curl -s -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Middleware-Subrequest: x' -H 'X-Forwarded-Host: evil' -H 'Forwarded: for=1.2.3.4' https://dompet.novandafadly.com/_s1/headers`: `X-Forwarded-For` tepat satu nilai = IP publik klien, `X-Forwarded-Proto: https`, tanpa `X-Middleware-Subrequest`, `X-Forwarded-Host`, `Forwarded`.
  - Host lain lewat IP: `curl -sk -H 'Host: x' https://168.110.202.175/` tidak sampai ke `gw` (ditangani default server nginx).
  - `curl` ke `/` dengan Host salah langsung di gw → 421.
- Rollback: `sudo rm /etc/nginx/sites-enabled/dompetku && sudo nginx -t && sudo systemctl reload nginx`.

### 9. Pembanding app lain

Ulangi langkah 0. Status HTTP tiap site sama dengan baseline, daftar container app lain sama (uptime tidak ter-reset), `iptables -S` hanya bertambah aturan `dompetku-gw`.

### 10. [DB] Bersihkan placeholder

Hapus service `placeholder` dari `compose.yml` dan blok `handle /_s1/headers` dari `Caddyfile` (repo dan VM), lalu `sudo docker compose up -d --remove-orphans` di `/opt/dompetku`. Verifikasi `/_s1/headers` kini menjawab halaman sementara.

### 11. `unattended-upgrades`

Sudah aktif di kedua VM. Verifikasi: `systemctl is-active unattended-upgrades` dan `apt-config dump | grep Unattended-Upgrade` = `"1"`. Tidak ada perubahan.

### 12. Commit

`docs/ops/*.md` dan `infra/**` (tanpa rahasia) ke branch `claude/m0b-s1-infra`, push, tanpa PR.

## Kriteria keluar S1 (IPD) dan buktinya

| Kriteria                                 | Bukti                                                      |
| ---------------------------------------- | ---------------------------------------------------------- |
| HTTPS ke domain menjawab dari `gw`       | Langkah 8: 200 + halaman sementara dari Caddy              |
| Postgres tanpa port host                 | Langkah 6: `docker port` kosong, network `internal: true`  |
| Header forward hanya dipercaya dari `gw` | Langkah 8: XFF palsu tidak lolos; `trusted_proxies_strict` |
| `x-middleware-subrequest` dibuang        | Langkah 8: header tidak sampai ke upstream                 |
| App lain tidak terganggu                 | Langkah 9                                                  |

## Catatan eksekusi (2026-10-31)

Semua langkah 0 sampai 12 dijalankan (langkah 1 dan 3 oleh pemilik). Penyimpangan dari rancangan awal, semuanya sudah masuk berkas di `infra/`:

1. **`gw` gagal exec (`operation not permitted`).** Binary caddy di image resmi membawa file capability `cap_net_bind_service`; dengan `cap_drop: ALL` + `no-new-privileges` exec ditolak. Perbaikan: `cap_add: [NET_BIND_SERVICE]`.
2. **Firewall men-drop balasan gw.** Paket SYN-ACK dari container juga cocok dengan `--ctorigdst/--ctorigdstport`, sehingga koneksi dari VM App timeout. Perbaikan: `--ctdir ORIGINAL`.
3. **421 untuk Host yang benar.** Caddy otomatis memaksa SNI = Host bila client auth aktif; SNI dari edge `dompetku-gw.internal`, Host domain publik. Perbaikan: `strict_sni_host insecure_off` (satu site, Host dicek eksplisit).
4. **Host salah tetap 200.** `respond` berurutan setelah `handle` di Caddy; cek Host dipindah ke `handle @wrong_host`.

Hasil verifikasi:

- `https://dompet.novandafadly.com/` 200 dari `gw`, HSTS ada, `http://` 301 ke `https://`. Sertifikat Let's Encrypt berlaku sampai 2027-01-29.
- Dengan `X-Forwarded-For`, `X-Real-IP`, `X-Middleware-Subrequest`, `X-Forwarded-Host`, `Forwarded` palsu, upstream menerima `X-Forwarded-For` satu nilai (IP koneksi) dan `X-Forwarded-Proto: https`; header lain tidak ada.
- App lain: status HTTP 7 site sama dengan baseline, container dan `iptables` VM App identik, VM DB hanya bertambah aturan Docker untuk network `dompetku_app` + 2 aturan `dompetku-gw`. Peringatan nginx `protocol options redefined` sudah ada sebelum S1 (site `tanya-hpp`/`trading`).
- Sertifikat mTLS `gw` dan `edge` berlaku sampai 2027-12-03; CA sampai 2031.
- Postgres 17.11 healthy, `docker port` kosong, hanya di `dompetku_internal` (`internal=true`), tanpa egress, `password_encryption=scram-sha-256`, koneksi lokal pun wajib password. Host VM DB sendiri tetap bisa menjangkau IP bridge container (perilaku Docker); dari VCN tidak ada rute ke subnet bridge.
- Pemilik membuka `/_s1/headers` dari perangkat luar; `X-Forwarded-For` = IP publiknya. Setelah itu placeholder dan rutenya dihapus (`/_s1/headers` kini halaman sementara), image `traefik/whoami` dibuang dari VM DB.

## Rollback total

Urutan terbalik: hapus site nginx + reload (8), `certbot delete` dan `/etc/nginx/dompetku-pki` (7), `docker compose down -v` di `/opt/dompetku` (6), disable unit firewall (5), `rm -rf /opt/dompetku` (2 sampai 4), hapus record DNS (1).

## Di luar S1

- Scrape Prometheus ke `:9443` dan metrik `gw`: S3 (bersama `/api/health`).
- Temuan T1 sampai T4 di inventaris: tidak disentuh, keputusan pemilik.
