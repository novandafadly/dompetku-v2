# Inventaris VM (sebelum S1)

Diambil 2026-10-31 sekitar 15:30 UTC oleh sesi Claude Code yang berjalan di VM App (SSH ke VM DB lewat IP privat). Hanya baca; tidak ada yang diubah. Rahasia, isi file env, dan isi `.htpasswd` tidak dibaca atau dicatat.

Dokumen ini menjadi pembanding "app lain tetap normal" pada kriteria keluar S1.

## Ringkasan

| Hal                      | VM App `rtp-prod-app-01`                    | VM DB `rtp-prod-db-01`                        |
| ------------------------ | ------------------------------------------- | --------------------------------------------- |
| Arsitektur, CPU, RAM     | `aarch64`, 1 vCPU, 5,8 GiB                  | `aarch64`, 3 vCPU, 17 GiB                     |
| Beban saat cek           | swap 1,9/4 GiB, RAM tersedia 2,6 GiB        | load 0,15, RAM tersedia 11 GiB, tanpa swap    |
| Disk `/`                 | 77 GB, terpakai 86% (sisa 12 GB)            | 96 GB, terpakai 55% (sisa 44 GB)              |
| IP privat                | `10.0.0.149/24` (`enp0s6`)                  | `10.0.1.68`                                   |
| IP publik                | `168.110.202.175`                           | `129.225.11.86`                               |
| Docker / Compose         | 29.6.2 / v5.3.1                             | 29.1.3 (paket Ubuntu) / 2.40.3                |
| Reverse proxy            | nginx 1.24 di host, certbot (timer)         | tidak ada (Caddy dan nginx tidak terpasang)   |
| `unattended-upgrades`    | aktif (`Unattended-Upgrade "1"`)            | aktif (`Unattended-Upgrade "1"`)              |
| Sinkronisasi waktu       | `systemd-timesyncd` aktif, chrony tidak ada | `systemd-timesyncd` aktif, chrony tidak ada   |
| Firewall host            | iptables (`INPUT` diakhiri `REJECT`)        | iptables + `iptables-persistent` (`rules.v4`) |
| `/opt`                   | `idx-smart-money`                           | `containerd`, `idx-smart-money`, agen OCI     |
| Sisa DompetKu sebelumnya | tidak ada                                   | tidak ada (tanpa volume/network `dompet*`)    |

## VM App

### Container (compose project)

| Container             | Project            | Port                      |
| --------------------- | ------------------ | ------------------------- |
| `rtp-alertmanager`    | `monitoring`       | `127.0.0.1:9093`          |
| `rtp-prometheus`      | `monitoring`       | `127.0.0.1:9090`          |
| `rtp-cadvisor`        | `monitoring`       | `127.0.0.1:8080`          |
| `rtp-node-exporter`   | `monitoring`       | `127.0.0.1:9100`          |
| `rtp-grafana`         | `monitoring`       | `127.0.0.1:3000`          |
| `minimaltrade-web`    | `minimaltrade-app` | `127.0.0.1:3005`          |
| `minimaltrade-worker` | `minimaltrade-app` | -                         |
| `jurnaltrading-app-1` | `jurnaltrading`    | `127.0.0.1:3004`          |
| `pupuk-rag-api-1`     | `pupuk-rag`        | `127.0.0.1:8100`          |
| `pupuk-rag-web-1`     | `pupuk-rag`        | `127.0.0.1:3100`          |
| `rtp-metabase`        | (tanpa compose)    | `0.0.0.0:3001` (lihat T1) |

### Layanan systemd (selain bawaan OS)

`cogs-app` (Next.js `*:3003`), `rekon-daslok-backend` (uvicorn `127.0.0.1:8000`), `rekon-daslok-frontend` (Next.js `*:3002`), `oauth2-proxy` (`127.0.0.1:4180`), `rtp-producer`, `rtp-consumer`, agen OCI, cups (snap).

### Port yang mendengar

Publik (`0.0.0.0`/`[::]`): 22 (sshd), 80 dan 443 (nginx), 111 (rpcbind), 631 (cupsd), 3001 (Metabase via docker-proxy), 3002 dan 3003 (Next.js host). Sisanya hanya `127.0.0.1`.

### nginx

Site aktif: `chatbot-ai`, `daslok`, `metabase` (`analytics.`), `minimaltrade`, `rekon-cogs`, `tanya-hpp` (`tanya.`), `trading`. Semua `*.novandafadly.com`, TLS Let's Encrypt via certbot (timer `certbot.timer`, deploy hook `reload-nginx.sh`). Beberapa site memakai basic auth, `tanya.` memakai `oauth2-proxy`.

Preseden penting: `tanya-hpp` sudah meneruskan ke VM DB lewat **mTLS** (`proxy_pass https://10.0.1.68:8190`, sertifikat klien dari CA privat, `proxy_ssl_verify on`, TLS 1.3, header klien ditimpa). DompetKu memakai pola yang sama dengan CA terpisah.

### Firewall host

`INPUT` menerima 22, 80, 443, ICMP, `lo`, lalu `REJECT` semuanya. `DOCKER-USER` kosong. Port Docker yang dipublikasikan di `0.0.0.0` tidak melewati `INPUT` (lihat T1).

### Cron dan timer

- Cron user: `0 3 * * *` backup DB jurnaltrading.
- Timer non-bawaan: `certbot.timer`, `sysstat-*`, `unified-monitoring-agent_config_downloader`.

## VM DB

### Container (compose project)

| Container               | Project                 | Port                           |
| ----------------------- | ----------------------- | ------------------------------ |
| `minimaltrade-postgres` | `minimaltrade-db`       | `10.0.1.68:5435`               |
| `minimaltrade-redis`    | `minimaltrade-db`       | `10.0.1.68:6379`               |
| `hpp-db`                | `hpp-dashboard`         | `10.0.1.68:5436`               |
| `pupuk-rag-ml-1`        | `pupuk-rag`             | `10.0.1.68:8181`               |
| `pupuk-rag-ingest-1`    | `pupuk-rag`             | `10.0.1.68:8182`               |
| `pupuk-rag-db-1`        | `pupuk-rag`             | `10.0.1.68:5433`               |
| `jurnaltrading-db`      | (tanpa compose)         | `10.0.1.68:5434`               |
| `rekon_daslok_postgres` | `rekon-daslok-postgres` | `10.0.1.68:5432`               |
| `rtp-clickhouse`        | `data-stack`            | `0.0.0.0:8123`, `0.0.0.0:9000` |
| `rtp-redpanda`          | `data-stack`            | `0.0.0.0:9092/9644/19092`      |
| `rtp-redpanda-console`  | `data-stack`            | `0.0.0.0:8080`                 |

Network Docker: `bridge` + satu per project (`*_default`). 10 volume, tidak ada yang bernama `dompet*`.

### Layanan systemd (selain bawaan OS)

`tanya-hpp` (python, `10.0.1.68:8190`, mTLS), `prometheus-node-exporter` (`10.0.1.68:9101`).

### Port yang mendengar

Publik (`0.0.0.0`/`[::]`): 22, 111, 8080, 8123, 9000, 9092, 9644, 19092 (lihat T2). IP privat `10.0.1.68`: 5432 sampai 5436, 6379, 8181, 8182, 8190, 9101. **Port 8443 dan 9443 bebas.**

### Firewall host

`INPUT` (urutan penting): 9101 dan 8190 hanya dari `10.0.0.149` (sisanya `DROP`), 8123 diterima, **`-s 10.0.0.0/16 -j ACCEPT`**, 3000 diterima, ESTABLISHED, ICMP, `lo`, 22, lalu `REJECT`. Aturan disimpan di `/etc/iptables/rules.v4` (`iptables-persistent`). `DOCKER-USER` kosong.

### Cron dan timer

Tidak ada cron user. Timer non-bawaan: `hpp-backup.timer`, `sysstat-*`, agen OCI.

## Jaringan antar-VM dan DNS

- Dari VM App ke `10.0.1.68:8443` dan `:9443`: **connection refused** (paket sampai ke host, belum ada yang mendengar). Ke port acak `:5999`: timeout. Artinya security list OCI sudah meloloskan 8443/9443 dari subnet VM App; tidak perlu mengubah security list.
- 443 dan 80 publik di VM App sudah terbuka (dipakai site lain).
- DNS `novandafadly.com` di Hostinger (`*.dns-parking.com`). `dompet.novandafadly.com` **belum punya record**. Tidak ada record CAA. Subdomain lain hanya punya A (`168.110.202.175`), tanpa AAAA.

## Temuan di luar cakupan DompetKu (tidak diubah)

Dicatat saja; S1 tidak menyentuhnya.

- **T1.** Metabase di VM App dipublikasikan di `0.0.0.0:3001`. Port Docker melewati rantai `FORWARD`, bukan `INPUT`, jadi `REJECT` di `INPUT` tidak melindunginya. Keterjangkauan dari internet bergantung pada security list OCI.
- **T2.** Di VM DB, ClickHouse (8123, 9000), Redpanda (9092, 9644, 19092), dan console (8080) mendengar di `0.0.0.0`. Catatan lama menyebut port non-standar VM DB tidak terjangkau dari luar (security list), tapi ini belum diverifikasi ulang.
- **T3.** Aturan `INPUT` VM DB `-s 10.0.0.0/16 -j ACCEPT` menerima semua port dari seluruh VCN. DompetKu tidak bergantung padanya: `gw` dibatasi di `DOCKER-USER` (port Docker tidak melewati `INPUT`) dan mTLS.
- **T4.** Kunci SSH App→DB (`db_key.pem`) pernah tertempel di chat dan belum dirotasi.
