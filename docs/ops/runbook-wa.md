# Runbook: Catat via WhatsApp (OpenWA) di VM DB

Dasar: spec `docs/superpowers/specs/2026-11-09-catat-wa-openwa-design.md` §5.1 dan §6. OpenWA (`github.com/rmyndharis/OpenWA`) berjalan sebagai layanan compose `openwa` di project `dompetku`, engine Baileys, SQLite di volume `openwa_data`. `openwa` dianggap bisa disusupi (image pihak ketiga yang memproses pesan dari internet): ia tidak berbagi network dengan `web`; satu-satunya jalur adalah sidecar Caddy `wa-proxy` yang hanya meneruskan webhook ke web dan perintah kirim teks ke OpenWA, dan egress-nya dibatasi ke internet. Tanpa rahasia di dokumen ini; semua nilai rahasia diisi pemilik langsung di VM, tidak lewat chat.

Fakta OpenWA di dokumen ini diambil dari README, `.env.example`, `Dockerfile`, `docker-entrypoint.sh`, `docs/06-api-specification.md`, dan sumber (`src/common/utils/ip.ts`, `src/common/security/ssrf-guard.ts`) pada tag `v0.27.1`. Yang belum bisa dibuktikan tanpa sesi nyata ditandai **UNVERIFIED**; uji di VM sebelum diandalkan.

```
            network wa (internal)                 network wa_web (internal)
 openwa 172.16.26.3 ──:8081──> wa-proxy 172.16.26.2 │ 172.16.28.2 ──> web:3000   (hanya POST /api/wa/webhook)
 openwa:2785 <────────────────  wa-proxy  <──:2786── web 172.16.28.128/25       (hanya POST .../send-text)
   │
   └── wa_egress 172.16.27.0/24 ──> internet (WhatsApp). IMDS, VCN, jaringan privat, port host: DROP (firewall.sh)
```

## Yang berubah

| Bagian                                                             | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/db-vm/compose.yml`                                          | Layanan `openwa` (profil `web`): `ghcr.io/rmyndharis/openwa:0.27.1@sha256:1a2d0c39…af9068` (indeks multi-arch, ada `linux/arm64`; rilis terbaru yang berumur >= 7 hari saat dipatok), user `997:997`, read-only + tmpfs `/tmp`, volume `openwa_data:/app/data`, `cap_drop: ALL`, `no-new-privileges`, 512 MiB, 0,5 CPU, `pids_limit` 256, tanpa port host. Layanan `wa-proxy` (profil `web`): image `caddy` yang sama dengan `gw`, `user 65532:65532`, read-only, tmpfs `/data` `/config`, `cap_drop: ALL` (+`NET_BIND_SERVICE` hanya agar binary bisa dijalankan), 64 MiB, 0,25 CPU, `pids_limit` 50. Network `wa` (internal, `172.16.26.0/24`: `wa-proxy` .2 + `openwa` .3), `wa_web` (internal, `172.16.28.0/24`: `wa-proxy` .2 + `web` dinamis dari `172.16.28.128/25`), keduanya dengan gateway terisolasi (`com.docker.network.bridge.gateway_mode_ipv4: isolated`: bridge tanpa alamat di host, jadi port host seperti sshd tidak terjangkau lewat `.1`), `wa_egress` (`172.16.27.0/24`, hanya `openwa`, keluar ke internet). Ketiganya `enable_ipv6: false` eksplisit. `web` ikut `wa_web`, tidak ikut `wa`. |
| `infra/db-vm/wa-proxy/Caddyfile`                                   | Allowlist L7: `172.16.26.2:8081` hanya `POST /api/wa/webhook` dari `172.16.26.3` ke `web:3000` (selalu diteruskan ke path tetap `/api/wa/webhook`); `172.16.28.2:2786` hanya `POST /api/sessions/<uuid>/messages/send-text` dari web (`172.16.28.128/25`) ke `openwa:2785`. Lainnya `404` (metode salah di path itu `405`). Log akses dan log galat (mis. `502`) tanpa header request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `infra/db-vm/gw/Caddyfile`                                         | `/api/wa` dan `/api/wa/*` dijawab `404` di gw sebelum proxy ke web: webhook tidak terjangkau dari publik.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `infra/db-vm/bin/firewall.sh`, `systemd/dompetku-firewall.service` | Selain aturan gw: koneksi baru dari `wa_egress` ke `169.254.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (`DOCKER-USER`, kecuali DNS ke `169.254.169.254`) di-`DROP`; koneksi baru dari `wa_egress`, `wa`, dan `wa_web` ke alamat host VM DB (`INPUT`) di-`DROP`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `infra/db-vm/deploy/deploy`                                        | Sesudah web (dan worker) sehat: `compose up -d --no-deps wa-proxy openwa` bila `env/openwa.env` ada. Gagal tidak me-rollback web. Tanpa env: kedua container dihentikan. Rollback web tidak menyentuh keduanya. Hasil di field audit `openwa` (`deploy/README.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `infra/db-vm/env/openwa.env.example`                               | Contoh `/opt/dompetku/env/openwa.env`: hanya `API_MASTER_KEY` (rahasia), `API_KEY_PEPPER` opsional, `LOG_LEVEL`. Nilai non-rahasia dipatok di `compose.yml`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `infra/db-vm/deploy/web.env.example`                               | `OPENWA_URL` sengaja kosong (salinan belum diisi = fitur mati, bukan setengah terkonfigurasi); diisi `http://wa-proxy:2786` saat memasang (langkah 6). Keterangan variabel WA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Pengaturan yang dipatok di `compose.yml` (menang atas `openwa.env`) dan alasannya:

| Variabel                                     | Nilai               | Alasan                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE_TYPE`, `DATABASE_TYPE`               | `baileys`, `sqlite` | Tanpa Chromium, tanpa Redis/Postgres. `DATABASE_NAME` sengaja tidak diisi: untuk SQLite nilainya jadi path berkas dan di rootfs read-only membuat boot-loop.                                                                                                     |
| `RESOLVE_LID_TO_PHONE`                       | `true`              | Pengirim `@lid` mendapat `senderPhone`. Tanpa ini nomor `@lid` tidak pernah bisa dihubungkan.                                                                                                                                                                    |
| `AUTO_START_SESSIONS`                        | `true`              | Bawaan production mati: tanpa ini setiap restart/recreate container (deploy dengan digest baru, reboot VM) membuat bot diam sampai `POST /start` manual.                                                                                                         |
| `WEBHOOK_SSRF_PROTECT`, `SSRF_ALLOWED_HOSTS` | `true`, `wa-proxy`  | Guard SSRF menolak webhook ke alamat privat; `wa-proxy` diizinkan secara eksplisit, tujuan lain tetap dijaga. Host di daftar ini di-resolve dan dipatok ke alamatnya saat pendaftaran webhook, jadi `wa-proxy` harus sudah berjalan di network `wa` (langkah 4). |
| `WEBHOOK_TIMEOUT`                            | `20000`             | Lihat "Timeout webhook" di bawah.                                                                                                                                                                                                                                |
| `MESSAGE_RETENTION_DAYS`                     | `7`                 | OpenWA menyimpan teks pesan (nominal, keterangan) di SQLite-nya; bawaan `0` = selamanya.                                                                                                                                                                         |
| `MAX_CONCURRENT_SESSIONS`                    | `1`                 | Satu nomor bot.                                                                                                                                                                                                                                                  |
| `UPDATE_CHECK_ENABLED`, `ENABLE_SWAGGER`     | `false`             | Tanpa panggilan ke `api.github.com`; Swagger (skema + versi tanpa API key) tidak disajikan.                                                                                                                                                                      |
| `CSP_UPGRADE_INSECURE_REQUESTS`              | `false`             | Dasbor hanya dibuka lewat tunnel ke `http://localhost` (langkah 5B); tanpa ini layar putih.                                                                                                                                                                      |

### Timeout webhook

Handler `POST /api/wa/webhook` di web menunggu `sendText` ke OpenWA (batas 10 detik) sebelum menjawab. `WEBHOOK_TIMEOUT` bawaan OpenWA 10 000 ms, jadi saat OpenWA lambat menerima kiriman balasan, OpenWA memutus webhook lebih dulu dan mengirim ulang. Pengiriman ulang aman (entri idempoten lewat `clientId` dari id pesan, `replayed: true`), tetapi pengguna bisa menerima balasan ganda. Karena itu `WEBHOOK_TIMEOUT=20000`; nilai ini harus tetap lebih besar dari batas `sendText` web bila salah satunya diubah. `wa-proxy` menunggu header respons upstream paling lama 30 detik (`response_header_timeout`), di atas keduanya.

### Jalur `openwa` ⇄ `web` lewat `wa-proxy`

`openwa` dan `web` tidak berbagi network. `wa-proxy` (Caddy) punya dua listener, masing-masing terikat ke alamatnya di satu network dan hanya menerima alamat sumber pihak itu:

| Listener                      | Dari                                         | Diteruskan                                                                                                                                      | Selain itu                                                                              |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `172.16.26.2:8081` (`wa`)     | `openwa` `172.16.26.3`                       | `POST /api/wa/webhook` (huruf besar/kecil, `//`, segmen titik yang diterima matcher) ke `web:3000` di path tetap `/api/wa/webhook`, tanpa query | `405` untuk metode lain di path itu, `404` untuk semua path lain dan alamat sumber lain |
| `172.16.28.2:2786` (`wa_web`) | `web` (alamat dinamis di `172.16.28.128/25`) | `POST /api/sessions/<UUID>/messages/send-text` ke `openwa:2785`                                                                                 | `405`/`404` sama                                                                        |

Di kedua arah dibuang: `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `X-Client-IP`, `True-Client-IP`, `CF-Connecting-IP`, `X-Middleware-*`, `X-Nextjs-*`, `Next-*`, `RSC`, `X-Invoke-*`, `X-Original-*`, override metode, `Cookie`, `Authorization` (arah webhook juga `X-API-Key`), dan `X-Forwarded-*` yang biasanya ditambahkan Caddy sendiri: web tidak menerima identitas klien apa pun dari jalur ini (jeda auth berbasis IP tidak bisa dipalsukan karena route auth tidak terjangkau sama sekali). Body: webhook paling besar 64 KiB (sama dengan batas route web), send-text 16 KiB; lebih besar `413`. `X-API-Key` web lewat ke OpenWA; OpenWA melihat alamat sumber `172.16.26.2` (wa-proxy), jadi `allowedIps` key web = `172.16.26.2`. Log akses JSON di stdout tanpa header request/respons dan tanpa body; log galat (mis. `502` saat backend mati, logger `http.log.error`) juga tanpa header request (encoder global membuang `request>headers`; bawaan Caddy hanya menyamarkan `Cookie`/`Authorization`, sehingga `X-API-Key` web dan `X-OpenWA-Signature` dulu ikut tercatat). Di web, `/api/wa/*` tidak lewat proxy Next (`apps/web/src/proxy.ts`), jadi body tidak disalin utuh sebelum batas 64 KiB route berlaku.

Seandainya satu pihak tetap sampai ke listener pihak lain, dampaknya nihil: `openwa` di `:2786` hanya memanggil API-nya sendiri (kirim teks, yang memang sudah ia kuasai), `web` di `:8081` hanya memanggil webhook dirinya sendiri. Perilaku ini diuji dengan Caddy 2.11.7 di `infra/db-vm/wa-proxy/test/wa-proxy-test.sh` (job CI `infra`).

### `/api/wa/*` diblokir di gw

Webhook hanya untuk OpenWA. Request publik ke `https://dompet.novandafadly.com/api/wa/...` berhenti di gw dengan `404` dan tidak sampai ke web. OpenWA memanggil `http://wa-proxy:8081/api/wa/webhook` (network `wa`); `wa-proxy` meneruskannya ke `web:3000` (network `wa_web`), tidak lewat nginx/gw. HMAC (`X-OpenWA-Signature`) tetap diperiksa web.

## Langkah

Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-wa/`, `infra/db-vm/compose.yml` ke `/tmp/dompetku-wa/compose.yml`, `infra/db-vm/gw/Caddyfile` ke `/tmp/dompetku-wa/Caddyfile`, `infra/db-vm/wa-proxy/Caddyfile` ke `/tmp/dompetku-wa/wa-proxy.Caddyfile`, `infra/db-vm/bin/firewall.sh` ke `/tmp/dompetku-wa/firewall.sh`, `infra/db-vm/systemd/dompetku-firewall.service` ke `/tmp/dompetku-wa/dompetku-firewall.service`, dan `infra/db-vm/env/openwa.env.example` ke `/tmp/dompetku-wa/openwa.env.example`, lebih dulu (dari `main` sesudah PR ini di-merge, sehingga image web yang berjalan sudah memuat route webhook).

Semua perintah manual yang memanggil `docker compose` untuk mengganti layanan dibungkus `flock /run/lock/dompetku-deploy.lock` (kunci deployer), seperti runbook S7.

### 1. [PEMILIK] Prasyarat

- **SIM khusus bot.** Nomor baru (prabayar), bukan nomor utama pemilik atau Farida. Akun bot bisa diblokir WhatsApp kapan saja (lihat Risiko); nomor utama tidak boleh ikut taruhan itu.
- **HP untuk nomor bot** dengan WhatsApp atau WhatsApp Business terpasang dan terdaftar dengan SIM itu. OpenWA tertaut sebagai "perangkat tertaut" (linked device), jadi akun utamanya tetap di HP ini. HP perlu online sesekali: WhatsApp memutus perangkat tertaut bila HP utama lama tidak online (sekitar 14 hari menurut dokumentasi WhatsApp; **UNVERIFIED** untuk versi sekarang).
- Pakai nomor itu sebentar seperti akun biasa (foto profil, nama "DompetKu", beberapa chat) sebelum ditautkan. Akun baru yang langsung dipakai otomatis lebih berisiko diblokir (**UNVERIFIED**, pengalaman komunitas, bukan aturan resmi).
- Catat nomor bot dalam bentuk angka E.164 tanpa `+` (mis. `62812…`). Nomor tidak rahasia, tetapi tidak perlu ditempel di chat.

### 2. Berkas, gw, firewall, dan web di network `wa_web` (sesi VM)

Cek subnet lebih dulu, sebelum berkas apa pun dipasang: begitu `compose.yml` baru terpasang, deploy berikutnya membuat network `wa` (`172.16.26.0/24`), `wa_egress` (`172.16.27.0/24`), dan `wa_web` (`172.16.28.0/24`). Ketiga subnet belum boleh dipakai network lain (alasan sama dengan `worker_db` di runbook S7):

```bash
sudo systemctl stop dompetku-deploy.timer   # tidak ada deploy baru sampai langkah 2 selesai
systemctl is-active dompetku-deploy.service  # "inactive" = lanjut; "activating" = deploy berjalan, tunggu lalu ulangi; "failed" = deploy terakhir gagal, boleh lanjut
sudo docker network inspect $(sudo docker network ls -q) -f '{{ .Name }} {{ range .IPAM.Config }}{{ .Subnet }} {{ end }}' | grep ' 172\.16\.'
# harapan: hanya dompetku_worker_db 172.16.25.0/24
```

Baris lain dengan `172.16.` dianggap bentrok bila subnetnya sama atau lebih lebar dan mencakup salah satu dari `172.16.26.0/24`, `172.16.27.0/24`, `172.16.28.0/24` (mis. `172.16.0.0/16`, `172.16.0.0/12`). Bila ada: berhenti, nyalakan lagi timer (`sudo systemctl start dompetku-deploy.timer`), catat nama network itu, tanyakan ke sesi Claude.

```bash
sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.pre-wa
sudo cp /opt/dompetku/bin/deploy /opt/dompetku/bin/deploy.pre-wa
sudo cp /opt/dompetku/gw/Caddyfile /opt/dompetku/gw/Caddyfile.pre-wa
sudo cp /opt/dompetku/bin/firewall.sh /opt/dompetku/bin/firewall.sh.pre-wa
cd /tmp/dompetku-wa
sudo install -m 755 deploy /opt/dompetku/bin/deploy
sudo install -m 755 firewall.sh /opt/dompetku/bin/firewall.sh
sudo install -m 644 dompetku-firewall.service /etc/systemd/system/dompetku-firewall.service && sudo systemctl daemon-reload
sudo install -d -m 755 /opt/dompetku/wa-proxy
sudo install -m 644 wa-proxy.Caddyfile /opt/dompetku/wa-proxy/Caddyfile
sudo install -m 644 compose.yml /opt/dompetku/compose.yml   # openwa, wa-proxy, network wa + wa_web + wa_egress
sudo install -m 644 Caddyfile /opt/dompetku/gw/Caddyfile
sudo install -m 644 README.md /opt/dompetku/deploy/README.md
sudo install -m 644 web.env.example /opt/dompetku/deploy/web.env.example
sudo install -m 644 openwa.env.example /opt/dompetku/deploy/openwa.env.example
```

Image OpenWA: pastikan digest di `compose.yml` adalah rilis yang dimaksud dan ada varian `arm64`. Digest diambil dari GHCR 2026-11-10 (tag `0.27.1` = `0.27` saat itu; rilis 2026-11-02, terbaru yang berumur >= 7 hari, `docs/ops/ci-keamanan.md`; 0.27.1 punya 21 CVE Chromium/apt yang sudah diperbaiki di 0.28.0+ dan dikecualikan bertanggal sampai 2026-11-21 karena Chromium tidak dipakai (`ENGINE_TYPE: baileys`); bump ke 0.29.1 sesudah 2026-11-14 18:52 WIB; 0.30.0 ada, layak sesudah 2026-11-17):

```bash
cd /opt/dompetku
sudo docker compose --profile web pull openwa wa-proxy
sudo docker compose --profile web config --images | grep -e openwa -e caddy   # ghcr.io/rmyndharis/openwa:0.27.1@sha256:1a2d0c393a7c8a629b0b18cdb5125d9be59192480c02d56a022c249a66af9068 dan caddy:2.11.7-alpine@sha256:e70b164d… (sama dengan gw)
img=ghcr.io/rmyndharis/openwa@sha256:1a2d0c393a7c8a629b0b18cdb5125d9be59192480c02d56a022c249a66af9068
sudo docker image inspect -f '{{ .Architecture }} {{ .Os }}' "$img"                      # arm64 linux
sudo docker run --rm --network none --entrypoint id "$img" openwa                        # uid=997(openwa) gid=997(openwa)
sudo docker run --rm --network none --entrypoint sh "$img" -c 'command -v curl'          # /usr/bin/curl (dipakai healthcheck dan langkah 5)
```

Untuk naik versi nanti, digest diambil dari indeks multi-arch tag rilis (bukan digest per arsitektur), diganti bersama tag lewat PR (rilis minimal 7 hari, prosedur `docs/ops/ci-keamanan.md`; workflow `openwa-image.yml` memindai image baru di PR itu). `docker compose pull` gagal keras bila digest tidak cocok dengan tag; jangan pernah menghapus `@sha256:…`.

Validasi kedua Caddyfile dengan Caddy dari image yang sama (tanpa jaringan). `wa-proxy` belum berjalan; Caddyfile-nya divalidasi lewat `docker run`, bukan `compose run` (layanan itu memakai alamat IP tetap di network):

```bash
cd /opt/dompetku
caddy_img=$(sudo docker compose --profile web config --images | grep '^caddy:' | head -n 1)
sudo docker run --rm --network none -v /opt/dompetku/wa-proxy/Caddyfile:/etc/caddy/Caddyfile:ro "$caddy_img" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile   # "Valid configuration"
```

gw: validasi lalu **restart**. `docker compose up -d gw` tidak cukup: konfigurasi compose gw tidak berubah (hanya isi Caddyfile), jadi container tidak dibuat ulang; Caddy berjalan dengan `admin off` sehingga tidak memuat ulang sendiri; dan `install` menulis inode baru, sementara bind mount satu berkas di container tetap menunjuk berkas lama. gw putus sebentar (koneksi aktif terputus); jalankan di luar jam pakai:

```bash
cd /opt/dompetku
sudo docker compose run --rm --no-deps gw caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile   # "Valid configuration"
sudo docker compose restart gw
sudo docker compose exec -T gw grep -c '@wa path /api/wa /api/wa/\*' /etc/caddy/Caddyfile                   # 1 (container melihat berkas baru)
```

Firewall: aturan egress `wa_egress` dipasang sebelum `openwa` pertama kali menyala (langkah 4). `firewall.sh up` idempoten dan hanya menambah aturan yang belum ada; jangan `systemctl restart dompetku-firewall` (itu `down` lalu `up`, membuka port gw sesaat). Pastikan dulu Docker memakai backend iptables (dengan backend nftables rantai `DOCKER-USER` tidak dipanggil, aturan gw dan egress tidak berlaku):

```bash
sudo docker info -f '{{ .FirewallBackend.Driver }}'   # iptables (kosong pada Docker lama = iptables juga)
grep -h '^nameserver' /run/systemd/resolve/resolv.conf   # nameserver 169.254.169.254 (resolver VCN)
sudo /opt/dompetku/bin/firewall.sh up
sudo iptables -S DOMPETKU-WA-EGRESS        # 2 RETURN DNS ke 169.254.169.254 lalu 5 DROP
sudo iptables -S DOCKER-USER | grep -c dompetku   # 3 (2 gw + 1 lompatan wa_egress)
sudo iptables -S INPUT | sed -n 2,4p       # tiga baris -A INPUT -s 172.16.28.0/24 / 172.16.26.0/24 / 172.16.27.0/24 ... dompetku-wa-host -j DROP (aturan pertama)
```

Resolver host selain `169.254.169.254` (mis. alamat `10.x`): berhenti, DNS `openwa` akan putus; tanyakan ke sesi Claude (`WA_DNS` di `firewall.sh` perlu diubah lewat PR). Resolver tertanam Docker (`127.0.0.11` di container) meneruskan kueri ke resolver host dari namespace container, jadi kueri itu melewati `DOCKER-USER` dengan sumber `172.16.27.x`; pengecualian DNS di rantai ada untuk itu.

Web pindah ke network `wa_web` (deploy berikutnya juga melakukannya; manual agar langkah 4 tidak menunggu rilis). Web tidak butuh `wa-proxy` untuk berjalan:

```bash
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web
c=$(sudo docker compose --profile web ps -q web)
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }}={{ $v.IPAddress }} {{ end }}' "$c"   # dompetku_app=… dompetku_internal=… dompetku_wa_web=172.16.28.x (x >= 128)
sudo docker network inspect dompetku_wa_web -f '{{ .Internal }} {{ .EnableIPv6 }} {{ (index .IPAM.Config 0).Subnet }} {{ index .Options "com.docker.network.bridge.gateway_mode_ipv4" }}'   # true false 172.16.28.0/24 isolated
ip -4 -br addr | grep -c '172\.16\.28\.'   # 0: bridge wa_web tanpa alamat di host
```

Compose menolak membuat atau memakai network yang sudah ada dengan pengaturan lain (pesan "needs to be recreated"): `wa`/`wa_web`/`wa_egress` baru di VM, jadi ini hanya terjadi bila network itu sempat dibuat percobaan lain. Bila terjadi: berhenti, tanyakan ke sesi Claude (container pemakai network dihentikan dulu, lalu `docker network rm`).

Verifikasi dari VM App. Kode `404` saja tidak membuktikan blokir gw: sampai langkah 6 route web sendiri juga menjawab `404` (fitur mati). Pembeda: `respond 404` Caddy tanpa body dan tanpa `Cache-Control`, sedangkan web menjawab JSON `{}` (2 byte) dengan `Cache-Control: no-store`, dan `/api/wa` di web = halaman 404 Next (HTML):

```bash
curl -s https://dompet.novandafadly.com/api/health                                                                     # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -X POST https://dompet.novandafadly.com/api/wa/webhook -d '{}' # 404 0
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://dompet.novandafadly.com/api/wa                         # 404 0
curl -s -D - -o /dev/null -X POST https://dompet.novandafadly.com/api/wa/webhook -d '{}' | grep -ci '^cache-control'   # 0
```

Ulangi tiga baris `/api/wa` ini sesudah langkah 6, saat web sendiri akan menjawab `401` untuk request tanpa tanda tangan: harapan tetap `404 0` dan tanpa `Cache-Control`. `401` dari luar = blokir gw tidak aktif; hentikan dan ulangi `restart gw`.

Verifikasi lain:

- `cd /opt/dompetku && sudo docker compose --profile web config --services` memuat `openwa` dan `wa-proxy`; tanpa profil tetap `gw`, `postgres`.
- `diff /opt/dompetku/compose.yml.pre-wa /opt/dompetku/compose.yml` hanya menambah blok `openwa` dan `wa-proxy`, network `wa`/`wa_web`/`wa_egress`, volume `openwa_data`, `wa_web` di network web, dan komentar.
- `sudo test -e /opt/dompetku/env/openwa.env || echo belum-ada` = `belum-ada`. Deploy yang terjadi sekarang mencatat `"openwa":"openwa_env_missing"`.

Nyalakan lagi timer deploy: `sudo systemctl start dompetku-deploy.timer`.

### 3. [PEMILIK] `env/openwa.env`

Disusun di `openwa.env.new`, diverifikasi, lalu dipindah atomik (pola runbook S7). `API_MASTER_KEY` dibuat langsung di VM dan tidak pernah ditampilkan di terminal atau daftar proses:

```bash
sudo install -m 600 /opt/dompetku/deploy/openwa.env.example /opt/dompetku/env/openwa.env.new
sudo bash -c 'set -eu; f=/opt/dompetku/env/openwa.env.new; umask 077; k=$(openssl rand -hex 32)
  { grep -v "^API_MASTER_KEY=" "$f"; printf "API_MASTER_KEY=%s\n" "$k"; } >"$f.tmp"
  chmod 600 "$f.tmp"; mv "$f.tmp" "$f"'
f=/opt/dompetku/env/openwa.env.new
sudo grep -c '^API_MASTER_KEY=[0-9a-f]\{64\}$' "$f"   # 1
sudo stat -c '%a %U' "$f"                           # 600 root
sudo mv /opt/dompetku/env/openwa.env.new /opt/dompetku/env/openwa.env
```

Kunci admin ini dibaca OpenWA hanya pada boot pertama (membuat key ADMIN). Salin ke password manager pemilik dari terminal sendiri (`sudo grep '^API_MASTER_KEY=' /opt/dompetku/env/openwa.env`), tidak lewat chat: diperlukan untuk login dasbor (langkah 5B) dan pemulihan bila `openwa.env` hilang. `API_KEY_PEPPER` dibiarkan kosong kecuali pemilik memutuskan memakainya sebelum boot pertama (mengisinya belakangan mengunci semua key).

### 4. Menyalakan `wa-proxy` dan `openwa`

```bash
cd /opt/dompetku
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps wa-proxy openwa
p=$(sudo docker compose --profile web ps -q wa-proxy)
sudo docker inspect -f '{{ .State.Status }} {{ .Config.User }} {{ .HostConfig.ReadonlyRootfs }} {{ .RestartCount }}' "$p"   # running 65532:65532 true 0
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }}={{ $v.IPAddress }} {{ end }}' "$p"          # dompetku_wa=172.16.26.2 dompetku_wa_web=172.16.28.2
sudo docker compose --profile web logs --tail 20 wa-proxy   # "server running" untuk srv0 dan srv1, tanpa "error"
c=$(sudo docker compose --profile web ps -q openwa)
sudo docker inspect -f '{{ .State.Health.Status }} {{ .Config.User }} {{ .HostConfig.ReadonlyRootfs }}' "$c"   # healthy 997:997 true (tunggu sampai 60 detik)
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }}={{ $v.IPAddress }} {{ end }}' "$c"   # dompetku_wa=172.16.26.3 dompetku_wa_egress=172.16.27.x
sudo docker port "$c"; sudo docker port "$p"                                                                  # kosong
sudo docker network inspect dompetku_wa -f '{{ .Internal }} {{ .EnableIPv6 }} {{ index .Options "com.docker.network.bridge.gateway_mode_ipv4" }}'   # true false isolated
sudo docker network inspect dompetku_wa_egress -f '{{ .EnableIPv6 }} {{ (index .IPAM.Config 0).Subnet }}'                                          # false 172.16.27.0/24
ip -4 -br addr | grep -c '172\.16\.26\.'                                                                       # 0: bridge wa tanpa alamat di host
sudo docker compose --profile web logs --tail 50 openwa                                                       # tanpa FATAL/boot-loop
```

`wa-proxy` restart terus dengan galat `exec` atau `permission denied`: user non-root pada image caddy sudah terbukti dengan Docker 29.9.2 lokal dan di CI (`wa-proxy-test.sh` mode docker, pengaturan sama), belum di VM ini. Laporkan ke sesi Claude; jangan menghapus `cap_drop`.

Pemisahan dari dalam `openwa` (`curl` ada di image). Kode keluar curl: `6` = nama tidak dikenal, `7` = koneksi ditolak, `28` = timeout:

```bash
ow() { sudo docker compose --project-directory /opt/dompetku -f /opt/dompetku/compose.yml --profile web exec -T openwa "$@"; }
ow curl -sS -m 5 -o /dev/null http://web:3000/api/health; echo "kode $?"           # 6: web tidak ada di network openwa
wip=$(sudo docker inspect -f '{{ (index .NetworkSettings.Networks "dompetku_wa_web").IPAddress }}' "$(sudo docker compose --profile web ps -q web)")
ow curl -sS -m 5 -o /dev/null "http://$wip:3000/api/health"; echo "kode $?"      # 28: alamat web tidak terjangkau
ow curl -sS -m 5 -o /dev/null http://postgres:5432; echo "kode $?"                 # 6
ow curl -sS -m 5 -o /dev/null http://wa-proxy:2786/; echo "kode $?"                # 7: listener web->openwa tidak ada di sisi ini
ow curl -sS -m 5 -o /dev/null -w '%{http_code}\n' -X POST -d '{}' http://wa-proxy:8081/api/auth/sign-in/email   # 404 (dari wa-proxy)
ow curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://wa-proxy:8081/api/wa/webhook                          # 405
ow curl -sS -m 5 -o /dev/null -w '%{http_code}\n' -X POST -d '{}' http://wa-proxy:8081/api/wa/webhook          # 404 sebelum langkah 6 (fitur WA di web mati), 401 sesudahnya (tanpa tanda tangan)
```

Egress dari dalam `openwa` (aturan `firewall.sh` langkah 2):

```bash
ow curl -sS -m 5 -o /dev/null http://169.254.169.254/opc/v2/instance/; echo "kode $?"   # 28: metadata instance OCI tertutup
ow curl -sS -m 5 -o /dev/null http://10.0.0.149/; echo "kode $?"                         # 28: VM App tertutup
ow curl -sS -m 5 -o /dev/null -k https://10.0.1.68:8443/; echo "kode $?"                 # 28: alamat VM DB sendiri tertutup
ow curl -sS -m 5 -o /dev/null telnet://172.16.26.1:22 </dev/null; echo "kode $?"         # 28 atau 7: gateway wa terisolasi, tidak ada host di .1
ow curl -sS -m 5 -o /dev/null telnet://172.16.27.1:22 </dev/null; echo "kode $?"         # 28: port host lewat gateway wa_egress tertutup (INPUT DROP)
ow getent hosts web.whatsapp.com                                                         # alamat IP (DNS jalan)
ow curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://web.whatsapp.com/             # 200 atau 3xx (internet jalan)
sudo iptables -L DOMPETKU-WA-EGRESS -v -n                                               # penghitung paket baris DROP 169.254/10.0/… naik
```

Dari dalam `web` (Node; image distroless tanpa shell):

```bash
wn() { sudo docker compose --project-directory /opt/dompetku -f /opt/dompetku/compose.yml --profile web exec -T web /nodejs/bin/node -e "$1"; }
wn "fetch('http://openwa:2785/api/health').then(r=>console.log(r.status),e=>console.log('gagal',e.cause&&e.cause.code))"     # gagal ENOTFOUND
wn "fetch('http://wa-proxy:2786/api/health').then(r=>console.log(r.status),e=>console.log('gagal',e.cause&&e.cause.code))"   # 404 (dari wa-proxy)
wn "const s=require('net').connect(22,'172.16.28.1');s.setTimeout(5000,()=>{console.log('gagal timeout');s.destroy()});s.on('connect',()=>{console.log('TERBUKA');s.destroy()}).on('error',e=>console.log('gagal',e.code))"   # gagal (timeout/EHOSTUNREACH): gateway wa_web terisolasi
```

Bila container restart terus dengan `FATAL: /app/data is not writable by uid 997`: volume dibuat sebelum user dipatok (atau diisi dari image lain). Perbaiki sekali: `sudo docker run --rm -v dompetku_openwa_data:/d --entrypoint chown <image> -R 997:997 /d`, lalu ulangi `up`.

### 5. Sesi bot dan memautkan nomor

Fungsi bantu untuk memanggil API OpenWA dari dalam container (tanpa port host). Kunci admin dibaca dari env container dan ditulis ke berkas sementara di tmpfs container, tidak muncul di argv; body JSON lewat stdin:

```bash
owa() { # owa <METHOD> <path>; body JSON dari stdin (GET: </dev/null)
  sudo docker compose --project-directory /opt/dompetku -f /opt/dompetku/compose.yml --profile web \
    exec -T openwa sh -c 'umask 077; printf "header = \"X-API-Key: %s\"\n" "$API_MASTER_KEY" >/tmp/.k
      curl -sS -K /tmp/.k -X "$1" -H "Content-Type: application/json" --data-binary @- \
        -w "\n%{http_code}\n" "http://127.0.0.1:2785$2"; s=$?; rm -f /tmp/.k; exit $s' sh "$1" "$2"
}
```

Matikan timer deploy selama memautkan, supaya deploy tidak membuat ulang container di tengah jalan:

```bash
sudo systemctl stop dompetku-deploy.timer
systemctl is-active dompetku-deploy.service  # "inactive" = lanjut; "activating" = deploy berjalan, tunggu lalu ulangi; "failed" = deploy terakhir gagal, boleh lanjut
```

Buat sesi dan nyalakan (nama bebas, 3–50 huruf/angka/tanda hubung; rute memakai `id` UUID, bukan nama):

```bash
echo '{"name":"dompetku-bot"}' | owa POST /api/sessions    # 201, catat "id"
SID=<id dari keluaran>
owa POST "/api/sessions/$SID/start" </dev/null             # 2xx
owa GET "/api/sessions/$SID" </dev/null                    # "status":"qr_ready"
```

#### 5A. Kode pairing (utama: tanpa port, tanpa tunnel)

```bash
echo '{"phoneNumber":"62812xxxxxxx"}' | owa POST "/api/sessions/$SID/pairing-code"   # 201 {"pairingCode":"ABCD1234",...}
```

Di HP bot: WhatsApp → Perangkat tertaut → Tautkan perangkat → **Tautkan dengan nomor telepon** (label menu bisa berbeda per versi WhatsApp), masukkan kode 8 karakter dalam 5 menit. Lalu `owa GET "/api/sessions/$SID" </dev/null` sampai `"status":"ready"`. Beberapa akun menolak kode pairing dengan galat umum (dokumentasi OpenWA); bila begitu pakai 5B.

#### 5B. QR lewat tunnel SSH sementara (cadangan)

Port hanya dibuka di loopback VM selama memindai, lewat berkas override yang dihapus sesudahnya:

```bash
sudo tee /opt/dompetku/compose.openwa-pairing.yml >/dev/null <<'YAML'
# SEMENTARA: hapus sesudah memindai QR (runbook-wa 5B).
services:
  openwa:
    ports: ['127.0.0.1:2785:2785']
YAML
cd /opt/dompetku
sudo flock /run/lock/dompetku-deploy.lock docker compose -f compose.yml -f compose.openwa-pairing.yml --profile web up -d --no-deps openwa
sudo ss -ltnp | grep ':2785 '   # hanya 127.0.0.1:2785
```

Dari laptop pemilik: `ssh -N -L 2785:127.0.0.1:2785 <VM DB>` (cara SSH yang biasa dipakai ke VM DB), buka `http://localhost:2785`, masuk dengan `API_MASTER_KEY` dari password manager, buka sesi `dompetku-bot`, pindai QR dari HP bot (Perangkat tertaut → Tautkan perangkat). Bentuk login dasbor dengan API key: **UNVERIFIED**. QR juga bisa diambil lewat API (`owa GET "/api/sessions/$SID/qr"` mengembalikan PNG data URL), tetapi QR berganti tiap beberapa detik sehingga menyalinnya ke laptop biasanya terlambat.

Bersihkan segera sesudah status `ready` (tutup tunnel lebih dulu):

```bash
cd /opt/dompetku
sudo rm /opt/dompetku/compose.openwa-pairing.yml
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps openwa   # dibuat ulang tanpa port
sudo docker port "$(sudo docker compose --profile web ps -q openwa)"   # kosong
sudo ss -ltnp | grep ':2785 ' || echo tertutup                           # tertutup
```

Sesi tersimpan di volume, jadi pembuatan ulang tidak memutus pautan (`AUTO_START_SESSIONS=true`); cek `owa GET "/api/sessions/$SID" </dev/null` tetap `ready`.

#### Key API untuk web

Web tidak memakai kunci admin. Buat key `operator` yang hanya berlaku untuk sesi bot dan hanya dari alamat `wa-proxy` di network `wa` (`172.16.26.2`: request web sampai ke OpenWA dengan alamat sumber `wa-proxy`); responsnya langsung disaring ke `web.env.new` tanpa ditampilkan (key hanya dikembalikan sekali):

```bash
sudo install -m 600 /opt/dompetku/env/web.env /opt/dompetku/env/web.env.new
printf '{"name":"dompetku-web","role":"operator","allowedSessions":["%s"],"allowedIps":["172.16.26.2"]}' "$SID" |
  owa POST /api/auth/api-keys |
  sudo bash -c 'set -eu; f=/opt/dompetku/env/web.env.new; umask 077
    k=$(sed -n "s/.*\"apiKey\":\"\(owa_k1_[0-9a-f]\{64\}\)\".*/\1/p" | head -n 1); [ -n "$k" ] || { echo "key tidak ada di respons"; exit 1; }
    { grep -v "^OPENWA_API_KEY=" "$f"; printf "OPENWA_API_KEY=%s\n" "$k"; } >"$f.tmp"; chmod 600 "$f.tmp"; mv "$f.tmp" "$f"; echo key-tersimpan'
```

`allowedIps` (IPv4 atau CIDR IPv4) dicocokkan dengan alamat socket peer: `TRUSTED_PROXIES` sengaja tidak diisi, jadi OpenWA mengabaikan `X-Forwarded-For` (dan `wa-proxy` juga membuangnya), dan bentuk `::ffff:172.16.26.2` dinormalkan ke `172.16.26.2` (`src/common/utils/ip.ts` tag `v0.27.1`). Key ini tidak bisa dipakai dari alamat lain, termasuk dari `openwa` sendiri (`172.16.26.3`). `sendText` web ditolak `403` = alamat `wa-proxy` berubah (`compose.yml`) tanpa key baru: buat key baru dengan alamat yang benar, lalu cabut yang lama (`owa GET /api/auth/api-keys`, `DELETE /api/auth/api-keys/<id>`).

### 6. [PEMILIK] Tambahan `web.env`

Masih di `web.env.new` dari langkah 5 (berisi `OPENWA_API_KEY` baru). Rahasia webhook dibuat langsung di VM; satu-satunya salinan di VM ada di `web.env` (OpenWA menyimpannya sendiri lewat pendaftaran webhook di langkah 7):

```bash
sudo bash -c 'set -eu; f=/opt/dompetku/env/web.env.new; umask 077; s=$(openssl rand -hex 32)
  { grep -v -e "^WA_WEBHOOK_SECRET=" -e "^OPENWA_URL=" -e "^OPENWA_SESSION=" "$f"
    printf "WA_WEBHOOK_SECRET=%s\nOPENWA_URL=http://wa-proxy:2786\nOPENWA_SESSION=%s\n" "$s" "'"$SID"'"; } >"$f.tmp"
  chmod 600 "$f.tmp"; mv "$f.tmp" "$f"'
sudo nano /opt/dompetku/env/web.env.new   # isi WA_BOT_NUMBER=<angka E.164 tanpa +>; WA_MAX_AMOUNT=25000000 dan WA_RATE_PER_MIN=10 dari contoh dibiarkan, kecuali pemilik memutuskan lain (kosong = bawaan kode 100000000 dan 30)
f=/opt/dompetku/env/web.env.new
sudo grep -c '^WA_WEBHOOK_SECRET=[0-9a-f]\{64\}$' "$f"                              # 1
sudo grep -c '^OPENWA_URL=http://wa-proxy:2786$' "$f"                                # 1
sudo grep -c '^OPENWA_API_KEY=owa_k1_[0-9a-f]\{64\}$' "$f"                           # 1
sudo grep -c '^OPENWA_SESSION=[0-9a-f]\{8\}-[0-9a-f-]\{27\}$' "$f"                   # 1
sudo grep -c '^WA_BOT_NUMBER=62[0-9]\{8,13\}$' "$f"                                  # 1
sudo grep -c '^DATABASE_URL=' "$f"                                                   # 1 (isi lama tetap)
sudo stat -c '%a %U' "$f"                                                             # 600 root
sudo mv /opt/dompetku/env/web.env.new /opt/dompetku/env/web.env
cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web
```

Tunggu web `healthy` dan `curl` health dari VM App seperti langkah 2, lalu ulangi pemeriksaan `/api/wa` dari VM App (langkah 2): tetap `404 0`. Sesudahnya perintah `ow curl … -X POST … http://wa-proxy:8081/api/wa/webhook` di langkah 4 menjawab `401` (fitur hidup, tanpa tanda tangan, diteruskan `wa-proxy` ke web); `503` = konfigurasi WA di `web.env` tidak lengkap/salah (log web `[wa] config_error`); `502` = `wa-proxy` tidak menjangkau web (web belum ikut `wa_web`, langkah 2).

### 7. Mendaftarkan webhook

Body disusun dari `web.env` di shell root (rahasia lewat pipa, tidak di argv), lalu dikirim lewat `owa`:

```bash
sudo bash -c 'set -eu; s=$(sed -n "s/^WA_WEBHOOK_SECRET=//p" /opt/dompetku/env/web.env)
  printf "{\"url\":\"http://wa-proxy:8081/api/wa/webhook\",\"events\":[\"message.received\"],\"secret\":\"%s\",\"retryCount\":3}" "$s"' |
  owa POST "/api/sessions/$SID/webhooks"     # 201; respons tidak memuat secret
owa GET "/api/sessions/$SID/webhooks" </dev/null   # tepat satu webhook, url http://wa-proxy:8081/api/wa/webhook
sudo systemctl start dompetku-deploy.timer
```

`"retryCount":3` diambil dari contoh dokumentasi API (batas 0–5), perilakunya **UNVERIFIED**; bila API menjawab `400` karena field itu, hapus `,\"retryCount\":3` dari body dan kirim ulang (bawaan OpenWA dipakai).

`400` dengan pesan SSRF = `SSRF_ALLOWED_HOSTS` tidak sampai ke container atau `wa-proxy` belum berjalan di network `wa` (langkah 4). Nama host webhook harus persis `wa-proxy` (OpenWA mematok alamat hasil resolve saat pendaftaran; `172.16.26.2` dipatok di `compose.yml`).

### 8. Verifikasi ujung ke ujung

1. Di app (pemilik): menu WhatsApp → Hubungkan → kode muncul.
2. Dari WhatsApp pribadi pemilik, kirim ke nomor bot: `hubung KODE`. Harapan: balasan "Nomor terhubung".
3. Kirim `25rb kopi`. Harapan: balasan konfirmasi dan entri muncul di Transaksi. Kirim `batal`: entri dibatalkan.
4. Log tanpa teks pesan dan nominal:

   ```bash
   cd /opt/dompetku
   sudo docker compose --profile web logs --since 10m web | grep '\[wa\]'      # tanpa isi pesan, tanpa nominal
   sudo docker compose --profile web logs --since 10m openwa | grep -i webhook  # tanpa 401/timeout berulang
   sudo docker compose --profile web logs --since 10m wa-proxy | grep -c '"status":200'   # >= 1 (webhook dan send-text); tanpa header dan isi pesan
   p=$(sudo docker compose --profile web ps -q wa-proxy)
   # ow: fungsi dari langkah 4. Header palsu, bukan key sungguhan:
   ow curl -s -o /dev/null -X POST -H 'X-API-Key: owa_PALSU_cek_log' -H 'X-OpenWA-Signature: sha256=PALSU_cek_log' -d '{}' http://wa-proxy:8081/api/wa/webhook
   sudo docker logs "$p" 2>&1 | grep -c PALSU_cek_log      # 0: header tidak dicatat
   sudo docker logs "$p" 2>&1 | grep -c '"headers"'        # 0: tidak ada log (akses atau galat) yang memuat header
   sudo bash -c 'docker logs "$0" 2>&1 | grep -cFf <(sed -n "s/^OPENWA_API_KEY=//p" /opt/dompetku/env/web.env)' "$p"   # 0: key web tidak pernah tercatat (key tidak masuk argumen perintah)
   ```

   Tidak ada balasan dan tidak ada log `[wa]` sama sekali = bentuk payload OpenWA tidak cocok dengan yang dibaca web (`kind`/`isGroup` di fixture **UNVERIFIED**), atau webhook tidak sampai (cek log openwa). Log `[wa] ignored <alasan>` menunjukkan pesan dikenali tapi diabaikan: `not_message` (event bukan pesan, atau JSON tidak terbaca), `not_private` (grup, broadcast, atau pengirim bukan `@c.us`/`@lid`), `from_me` (pesan bot sendiri), `not_text` (media/stiker tanpa teks). Pesan pribadi berteks dari HP pemilik yang tetap menghasilkan `not_private` atau `not_message` = bentuk payload versi OpenWA ini berbeda; laporkan sebagai bug adaptor (`apps/web/src/server/wa/openwa.ts`).

5. Nomor yang tidak terhubung (mis. HP lain) mengirim pesan: balasan petunjuk "belum terhubung" paling banyak sekali per jam, tanpa entri.

## Operasi

- **Bot tidak membalas:** `sudo docker compose --profile web logs --since 10m wa-proxy` lebih dulu: tidak ada baris `/api/wa/webhook` = webhook tidak sampai ke `wa-proxy` (log openwa, langkah 7); `404`/`405`/`413` = path, metode, atau ukuran tidak sesuai allowlist; `502` = web tidak terjangkau dari `wa-proxy`; baris send-text `403` = `allowedIps`/`allowedSessions` key web (langkah 5). Lalu `sudo docker compose --profile web logs --since 10m web | grep '\[wa\]'`. Tidak ada balasan dan tidak ada log `[wa]` = bentuk payload OpenWA tidak cocok (`kind`/`isGroup` **UNVERIFIED**) atau webhook tidak sampai (log openwa, langkah 7); log `[wa] ignored <alasan>` = pesan dikenali tapi diabaikan (alasan: langkah 8 butir 4); `[wa] config_error` = `web.env` WA tidak lengkap/salah (webhook menjawab `503`; log ini terjadi sebelum verifikasi tanda tangan, jadi dibatasi satu baris per 60 detik per proses: jumlah baris bukan jumlah request); `[wa] rate_limited`, `[wa] unlinked_quiet` = sengaja diam.
- **Status sesi:** `owa GET "/api/sessions/$SID" </dev/null` (`ready` = tersambung). `SID` = `OPENWA_SESSION` di `web.env` (`sudo sed -n 's/^OPENWA_SESSION=//p' /opt/dompetku/env/web.env`; bukan rahasia).
- **Sesi putus** (status `disconnected`/`failed`, atau HP bot menghapus perangkat tertaut): coba `owa POST "/api/sessions/$SID/start" </dev/null`. Bila kembali `qr_ready`, pautan hilang: ulangi langkah 5A (atau 5B) dengan `SID` yang sama. Key web dan webhook tetap berlaku (terikat ke `SID`).
- **Putuskan nomor bot** (mis. HP/SIM bot hilang, ganti nomor): `owa POST "/api/sessions/$SID/logout" </dev/null` (menghapus kredensial sesi di volume dan perangkat tertaut), juga hapus perangkat di HP bot bila masih ada. Nomor pengguna yang terhubung diputus dari app (menu WhatsApp → Putuskan), bukan di OpenWA. Nomor pengguna juga diputus otomatis saat reset kata sandi selesai atau saat masuk dengan kode pemulihan (event audit `wa_unlinked`, `via` `password_reset`/`session_revoked`); sesudahnya bot menjawab petunjuk "belum terhubung" sampai user menghubungkan ulang dari app.
- **Matikan sementara:** `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web stop openwa wa-proxy`. Deploy berikutnya menyalakan keduanya lagi selama `openwa.env` ada.
- **Caddyfile `wa-proxy` berubah** (PR): salin ke `/opt/dompetku/wa-proxy/Caddyfile`, validasi seperti langkah 2 (`docker run … caddy validate`), lalu `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web restart wa-proxy` (Caddy `admin off` tidak memuat ulang sendiri; `install` membuat inode baru). Ulangi pemeriksaan pemisahan langkah 4.
- **`firewall.sh` berubah** (PR): salin ke `/opt/dompetku/bin/firewall.sh`, `sudo /opt/dompetku/bin/firewall.sh up` (membangun ulang rantai egress), ulangi pemeriksaan egress langkah 4. Sesudah Docker di-restart atau VM reboot, `dompetku-firewall.service` memasang aturan lagi (`After`/`PartOf` docker).
- **Rotasi rahasia webhook:** buat rahasia baru di `web.env` (pola langkah 6), `owa GET "/api/sessions/$SID/webhooks"` untuk id lama, `owa DELETE "/api/sessions/$SID/webhooks/<id>" </dev/null`, daftarkan ulang (langkah 7), lalu buat ulang web. Pesan di antara kedua langkah gagal HMAC (`401`) dan dikirim ulang OpenWA.
- **Rotasi key web:** buat key baru (langkah 5, bagian key), buat ulang web, lalu cabut key lama (`DELETE /api/auth/api-keys/<id>`).
- **Naik versi OpenWA:** PR yang mengganti tag dan digest di `compose.yml`, rilis yang berumur paling sedikit 7 hari (prosedur `docs/ops/ci-keamanan.md`, baca `CHANGELOG.md` bagian "Upgrade notes" versi di antaranya); workflow `openwa-image.yml` (Trivy) harus hijau di PR itu. Sesudah merge, salin `compose.yml` ke VM (langkah 2, baris `install compose.yml`); deployer menaikkan openwa pada rilis web berikutnya, atau manual `sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps openwa`. Sebelum naik versi, ambil cuplikan lokal volume untuk mundur (bagian Backup) dan hapus sesudah versi baru stabil.

## Rollback

Fitur mati tanpa menghapus sesi:

```bash
sudo mv /opt/dompetku/env/openwa.env /opt/dompetku/env/openwa.env.off
cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web rm -sf openwa wa-proxy
```

Lalu kosongkan variabel WA di `web.env` (pola `.new`, `grep -v` baris `WA_*` dan `OPENWA_*`) dan buat ulang web: tanpa variabel itu route webhook menjawab `404` dan menu WhatsApp di app tampil sebagai fitur mati. Deploy berikutnya mencatat `"openwa":"openwa_env_missing"` dan tidak menyalakan `openwa` maupun `wa-proxy`. Aturan firewall egress boleh tetap terpasang (hanya berlaku untuk subnet `wa_egress`).

Rollback penuh pemasangan (mengembalikan berkas sebelum WA). Urutan penting: `openwa` dan `wa-proxy` dihapus selagi `compose.yml` baru masih terpasang (compose lama tidak mengenal layanan itu, container akan yatim dan menahan network).

1. Jalankan "Fitur mati" di atas, termasuk mengosongkan `WA_*`/`OPENWA_*` di `web.env`. Verifikasi: `sudo docker ps -a --filter name=openwa --filter name=wa-proxy -q` kosong; `sudo grep -cE '^(WA|OPENWA)_[A-Z_]*=.' /opt/dompetku/env/web.env` = 0 (tidak ada variabel WA yang terisi; baris kosong `NAMA=` boleh).
2. Kembalikan berkas, restart gw, keluarkan web dari network `wa_web`, lalu hapus network (tanpa `|| true`: gagal = masih ada container yang terpasang, cari dengan `docker network inspect`):

   ```bash
   sudo systemctl stop dompetku-deploy.timer
   systemctl is-active dompetku-deploy.service  # "inactive" = lanjut; "activating" = deploy berjalan, tunggu lalu ulangi; "failed" = deploy terakhir gagal, boleh lanjut
   sudo mv /opt/dompetku/compose.yml.pre-wa /opt/dompetku/compose.yml
   sudo mv /opt/dompetku/bin/deploy.pre-wa /opt/dompetku/bin/deploy
   sudo mv /opt/dompetku/gw/Caddyfile.pre-wa /opt/dompetku/gw/Caddyfile
   cd /opt/dompetku
   sudo docker compose restart gw
   sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web   # dibuat ulang tanpa network wa_web
   sudo docker network inspect dompetku_wa dompetku_wa_web dompetku_wa_egress -f '{{ .Name }}: {{ range .Containers }}{{ .Name }} {{ end }}'   # tanpa nama container
   sudo docker network rm dompetku_wa dompetku_wa_web dompetku_wa_egress
   sudo docker network ls --format '{{ .Name }}' | grep -x -e dompetku_wa -e dompetku_wa_web -e dompetku_wa_egress || echo terhapus   # terhapus
   sudo rm -r /opt/dompetku/wa-proxy
   ```

3. Firewall: hapus hanya aturan egress (tanpa `firewall.sh down`, yang juga melepas aturan gw sesaat), lalu kembalikan skrip lama:

   ```bash
   sudo iptables -D DOCKER-USER -s 172.16.27.0/24 -m conntrack --ctstate NEW -m comment --comment dompetku-wa-egress -j DOMPETKU-WA-EGRESS
   sudo iptables -D INPUT -s 172.16.27.0/24 -m conntrack --ctstate NEW -m comment --comment dompetku-wa-host -j DROP
   sudo iptables -F DOMPETKU-WA-EGRESS && sudo iptables -X DOMPETKU-WA-EGRESS
   sudo mv /opt/dompetku/bin/firewall.sh.pre-wa /opt/dompetku/bin/firewall.sh
   sudo iptables -S | grep -c dompetku-wa || echo bersih                      # bersih
   sudo iptables -S DOCKER-USER | grep -c dompetku-gw                          # 2 (aturan gw tetap)
   sudo systemctl start dompetku-deploy.timer
   ```

   Unit `dompetku-firewall.service` yang baru hanya mengubah `Description`; boleh tetap terpasang.

Menghapus akun bot sepenuhnya (tidak bisa dibatalkan): `logout` dulu (Operasi), lalu `sudo docker volume rm dompetku_openwa_data`.

## Backup dan akses ke `openwa_data`

Isi volume: kredensial Baileys (`/app/data/baileys`; siapa pun yang memilikinya bisa memakai akun bot WhatsApp tanpa HP), SQLite OpenWA (`openwa.sqlite`: teks pesan 7 hari terakhir, nomor pengirim, webhook beserta rahasianya; `main.sqlite`: hash API key, audit), `.env.generated`.

**Keputusan: `openwa_data` tidak ikut backup** (WAL-G dan dump bulanan hanya Postgres; tidak ditambah). Alasan:

- Kehilangan volume dipulihkan dalam beberapa menit: langkah 4–7 (sesi baru, pautan baru, key web baru, webhook baru). Tidak ada data DompetKu di sana; entri tercatat di Postgres.
- Backup berarti salinan kredensial akun bot di bucket dengan retention terkunci 30 hari (`docs/ops/backup-oci.md`): salinan yang bocor tidak bisa dihapus.
- Kredensial Baileys berputar (kunci Signal); salinan lama sering tidak bisa dipakai lagi dan bisa membuat WhatsApp memutus perangkat (**UNVERIFIED**).

Pengecualian: sebelum naik versi OpenWA, cuplikan lokal sementara untuk mundur, root saja, dihapus sesudah versi baru stabil:

```bash
sudo install -d -m 700 /var/backups/dompetku-openwa
cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web stop openwa
sudo docker run --rm --network none -v dompetku_openwa_data:/d:ro -v /var/backups/dompetku-openwa:/b \
  --entrypoint tar <image openwa yang berjalan> -C /d -czf /b/openwa-data-$(date -u +%Y%m%d).tgz .
sudo chmod 600 /var/backups/dompetku-openwa/*.tgz
# ... naik versi; bila stabil: sudo shred -u /var/backups/dompetku-openwa/*.tgz
```

Akses (masuk daftar akses yang ditinjau pemilik bersama `env/*.env`):

- Siapa pun yang root di VM DB atau anggota grup `docker` (setara root) bisa membaca volume, `openwa.env`, dan env container (`docker inspect`). Cek berkala: `getent group docker` hanya akun admin yang dikenal.
- Izin direktori volume (sekali sesudah langkah 4, dan sesudah volume dibuat ulang):

  ```bash
  d=$(sudo docker volume inspect -f '{{ .Mountpoint }}' dompetku_openwa_data)
  sudo chmod 700 "$d" && sudo find "$d" -type f -exec chmod go-rwx {} +
  sudo stat -c '%a %u' "$d"                                       # 700 997
  sudo find "$d" -type f -perm /077 | head                        # kosong
  ```

- `env/openwa.env` dan `env/web.env`: `600 root`. Tidak disalin ke laptop, chat, atau repo.

## Firewall dan egress

`infra/db-vm/bin/firewall.sh` (dipanggil `dompetku-firewall.service`, `up`/`down` idempoten) memasang tiga kelompok aturan. Tidak disimpan ke `/etc/iptables/rules.v4` (milik app lain di VM); bila `netfilter-persistent save` sempat menyimpannya, `up` tetap tidak menggandakan aturan.

1. **Port gw** (`10.0.1.68:8443`/`9443`) hanya dari VM App, di `DOCKER-USER` (seperti sebelumnya).
2. **Egress `openwa`** (subnet `wa_egress` `172.16.27.0/24`, dipatok di `compose.yml` dan dicek sama oleh `firewall-test.sh`), hanya koneksi **baru** (`--ctstate NEW`; balasan tidak disentuh):
   - `DOCKER-USER` (paket yang diteruskan keluar bridge) → rantai `DOMPETKU-WA-EGRESS`: `RETURN` untuk DNS UDP/TCP 53 ke `169.254.169.254`, lalu `DROP` ke `169.254.0.0/16` (metadata instance OCI, link-local), `10.0.0.0/8` (VCN, termasuk VM App dan alamat VM DB; port Docker yang dipublikasikan di alamat itu juga, karena tujuan sesudah DNAT adalah alamat container `172.x`), `172.16.0.0/12` (network Docker lain), `192.168.0.0/16`, `100.64.0.0/10` (CGNAT).
   - `INPUT` (port yang terikat di host, termasuk lewat gateway bridge `172.16.27.1` dan alamat host lain): `DROP` semua koneksi baru dari subnet itu, sebagai aturan pertama (sebelum `ACCEPT 10.0.0.0/16` milik host). Di OCI Ubuntu `INPUT` menerima tcp/22 baru dari mana pun, jadi tanpa aturan ini sshd terjangkau.
   - Sisanya (internet: WebSocket `web.whatsapp.com`, media `*.whatsapp.net`/`*.cdn.whatsapp.net` di TCP 443) tetap boleh. Pembatasan per host tidak dibuat: daftar host WhatsApp tidak stabil (**UNVERIFIED** untuk Baileys versi ini).

3. **Port host dari network internal `wa` dan `wa_web`.** Docker memberi bridge network internal alamat host (`.1`) secara bawaan; aturan network internal Docker hanya men-DROP paket yang diteruskan (`FORWARD`), tidak `INPUT`. Jadi `openwa` (`172.16.26.3`) bisa membuka `172.16.26.1:22` (sshd) dan port host lain yang diterima `INPUT` VM DB (8123 dan 3000 dari mana pun, `inventaris-vm.md`) lewat antarmuka `wa`-nya. Dua lapis: (a) `compose.yml` memasang `com.docker.network.bridge.gateway_mode_ipv4: isolated` di `wa` dan `wa_web` (Docker >= 28, hanya untuk network internal): bridge tanpa alamat host sama sekali; (b) `firewall.sh` men-`DROP` koneksi baru di `INPUT` dari `172.16.26.0/24` dan `172.16.28.0/24` juga (aturan pertama), seandainya opsi itu hilang. Dibuktikan lokal dengan Docker 29.9.2: tanpa opsi, container network internal membuka port host di `.1`; dengan opsi, tidak; dengan `firewall.sh up`, gateway `wa_egress` juga tidak. Di VM: pemeriksaan langkah 2 dan 4.

DNS: di network compose, container memakai resolver tertanam Docker `127.0.0.11` (di namespace container, tidak terkena iptables host). Resolver itu meneruskan nama luar ke resolver host; di Ubuntu dengan systemd-resolved Docker memakai `/run/systemd/resolve/resolv.conf`, di OCI isinya resolver VCN `169.254.169.254`, dan kueri itu dikirim dari namespace container (sumber `172.16.27.x`), jadi melewati `DOCKER-USER`. Karena itu DNS ke `169.254.169.254` dikecualikan (hanya port 53; metadata di port 80 tetap tertutup). Akibatnya `openwa` masih bisa me-resolve nama internal VCN (informasi, bukan akses). Bila resolver host bukan `169.254.169.254`, `WA_DNS` di `firewall.sh` diganti lewat PR (langkah 2 memeriksanya).

Hal yang harus dicek di VM (langkah 2 dan 4): backend firewall Docker `iptables` (dengan backend nftables, `DOCKER-USER` tidak dipanggil dan aturan gw serta egress tidak berlaku); network WhatsApp (`wa`, `wa_web`, `wa_egress`) memasang `enable_ipv6: false` eksplisit, jadi tetap IPv4 saja walau `daemon.json` menyalakan IPv6 bawaan (`default-network-opts`), dan aturan `iptables` saja cukup (tanpa `ip6tables`); network DompetKu lain tanpa `enable_ipv6` (IPv4 selama `daemon.json` tidak mengubah bawaan); pemeriksaan dari dalam `openwa` (langkah 4) membuktikan aturan berlaku, bukan hanya terpasang.

Port sementara langkah 5B terikat ke `127.0.0.1`, alamat yang tidak dirutekan dari host lain (Docker 29.1 di VM DB juga memblokir akses langsung dari luar ke port loopback yang dipublikasikan). Paparan nyatanya adalah pengguna lokal lain di VM DB selama port terbuka: mereka bisa membuka dasbor, tetapi tetap butuh `API_MASTER_KEY` untuk masuk atau memanggil API.

## Risiko

- **Protokol tidak resmi: nomor bot bisa diblokir.** OpenWA/Baileys meniru WhatsApp Web; melanggar ketentuan WhatsApp untuk otomatisasi. Nomor bot bisa diblokir kapan saja tanpa peringatan dan tanpa banding yang bisa diandalkan, dan perubahan protokol di sisi WhatsApp bisa mematikan bot sampai OpenWA dirilis ulang. Tidak ada pengerasan teknis yang menutup ini. Mitigasi: nomor khusus (bukan nomor pribadi), bot hanya membalas orang yang menulis lebih dulu (tanpa broadcast), app tetap jalur utama, rencana cadangan bila diblokir = nomor baru + pautan ulang (langkah 5–7) atau jalur resmi (WhatsApp Cloud API) sebagai adaptor baru (spec §5.4). Risiko ini diterima pemilik (daftar periksa).
- **Kompromi container `openwa`: yang sudah ditutup.** `openwa` tidak berbagi network dengan `web`, `postgres`, `gw`, atau `worker`. Ke web ia hanya bisa `POST /api/wa/webhook` lewat `wa-proxy` (route auth, halaman, dan API lain = `404`; `X-Forwarded-For` dan header identitas lain dibuang, jadi jeda auth berbasis IP dan IP audit tidak bisa dipalsukan dari jalur ini). Egress ke metadata instance OCI, VCN (VM App), dan network Docker lain diblokir `firewall.sh`. Port yang terikat di host VM DB (sshd dan lainnya) tertutup dua lapis: bridge `wa`/`wa_web` tanpa alamat host (gateway terisolasi; sebelum perbaikan ini `172.16.26.1:22` terjangkau dari `openwa`) dan `INPUT` men-`DROP` koneksi baru dari `wa_egress`, `wa`, dan `wa_web`. `wa-proxy` meneruskan webhook ke satu path tetap dan tidak mencatat header (key web, tanda tangan) di log mana pun. Bukti: pemeriksaan langkah 2, 4, dan 8 di VM; `wa-proxy-test.sh` (19 skenario, Caddy 2.11.7); `firewall-test.sh` (10 skenario); uji lokal Docker 29.9.2 (fix wave 2). Jalur ini belum diuji di VM sampai langkah 4 dijalankan.
- **Kompromi container `openwa`: webhook palsu yang sah.** HMAC webhook **tidak** melindungi dari `openwa` yang disusupi: OpenWA harus memegang rahasia webhook untuk menandatangani kiriman (tersimpan di SQLite-nya, volume `openwa_data`). Penyerang di `openwa` bisa membuat webhook bertanda tangan sah dengan pengirim nomor terhubung **mana pun**, lalu web membuat atau membatalkan (`batal`) entri atas nama user pemilik nomor itu. `wa-proxy` tidak menutup celah ini (webhook bertanda tangan sah ke path yang benar memang diteruskan); yang bisa membantu hanya deteksi/alert (mis. lonjakan entri WhatsApp, entri dari nomor yang tidak sedang mengirim pesan) atau tidak memercayai `openwa` sama sekali (Cloud API resmi, spec §5.4).

  Yang membatasi dampaknya: hanya nomor yang sudah dihubungkan dan diverifikasi user bisa membuat entri (nomor lain hanya mendapat petunjuk); nominal per pesan dibatasi `WA_MAX_AMOUNT` (contoh `web.env.example`: Rp25.000.000; bawaan kode bila kosong Rp100.000.000); batas laju per nomor (`WA_RATE_PER_MIN`, contoh: 10/menit; bawaan kode 30/menit); `batal` hanya untuk catatan WhatsApp terakhir dalam 10 menit dan versi yang belum diubah; balasan bot juga dikirim ke nomor korban, jadi pemilik nomor melihat balasan ✅ yang mengejutkan dan itu membuka pemalsuan (kecuali penyerang juga menahan balasan); entri tercatat di ledger dan `app.wa_messages` (entri WhatsApp tidak punya event audit), dan bisa dibatalkan/dipulihkan dari app. Tidak ada akses ke data lain lewat jalur ini (webhook tidak mengembalikan isi ledger). Yang dibutuhkan penyerang: kompromi `openwa` **dan** nomor korban sudah terhubung; nomor korban terlihat di pesan masuk 7 hari terakhir di SQLite OpenWA.

  Batas banjir entri palsu: sampai `WA_RATE_PER_MIN` entri per menit per nomor terhubung, masing-masing sampai `WA_MAX_AMOUNT`. `web.env.example` dikirim dengan `WA_MAX_AMOUNT=25000000` dan `WA_RATE_PER_MIN=10` (paling banyak 10 entri palsu per menit per nomor, masing-masing paling besar Rp25.000.000); bawaan kode bila variabel kosong tetap Rp100.000.000 dan 30 (spec). Naikkan di `web.env` hanya bila memang mencatat nominal lebih besar lewat WhatsApp; nominal lebih besar dicatat lewat app (balasan "Gunakan app"). Membersihkan banjir: "Membersihkan entri WhatsApp palsu" di bawah.

- **Membersihkan entri WhatsApp palsu** (sesudah `openwa` dimatikan: Rollback "Fitur mati", dan sesudah nomor yang terdampak diputus dari app). Cari dulu, hanya baca. `<T>` = waktu mulai yang dicurigai (mis. `2026-11-20 14:00+07`); jalankan lewat alat akses manual (`docs/ops/akses-db-manual.md`, tercatat di audit) dengan SQL dari stdin:

  ```bash
  sudo /opt/dompetku/bin/dompetku-psql -- "cek entri wa palsu" <<'SQL'
  begin read only;
  select m.created_at, m.entry_id, e.space_kind, e.kind, abs(l.amount) as nominal, e.occurred_on,
         left(e.description, 40) as keterangan, p.display_name as pencatat, e.voided_at is not null as dibatalkan
    from app.wa_messages m
    join app.entries e on e.id = m.entry_id
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    left join app.profiles p on p.user_id = m.user_id
   where m.status = 'recorded' and m.entry_id is not null
     and m.created_at > '<T>'::timestamptz
   order by m.created_at;
  rollback;
  SQL
  ```

  `app.wa_messages` tidak menyimpan teks pesan, jadi daftar ini = semua entri yang dibuat lewat WhatsApp sejak `<T>` (asli maupun palsu); cocokkan dengan pemilik nomor. Pesan `pending` (`status = 'pending'`, `entry_id` kosong) bisa juga sudah membuat entri bila status akhirnya gagal disimpan; entri seperti itu tidak muncul di sini, cari di Transaksi pada jam yang sama. Membatalkan: dari app, oleh anggota ruang itu, per entri (Transaksi → entri → Batalkan transaksi); entri masuk Sampah dan bisa dipulihkan dari sana. **Tidak ada pembatalan massal**, dan jangan mengubah `app.entries` lewat SQL (melewati saldo, riwayat, dan idempotensi ledger). Banyak entri = minta pemilik ruang membatalkannya satu per satu dari daftar di atas.

- **Kompromi container `openwa`: yang tersisa.** Penyerang di `openwa` tetap bisa: memakai akun bot WhatsApp (membaca pesan masuk, termasuk teks 7 hari terakhir di SQLite; mengirim pesan ke siapa pun dari nomor bot, yang juga mempercepat pemblokiran nomor); membuat webhook palsu yang sah (butir di atas); memanggil API OpenWA-nya sendiri; menyerang parser HTTP `wa-proxy` (Caddy resmi, image dipatok digest, permukaan kecil); keluar ke internet mana pun (eksfiltrasi pesan atau kredensial bot, kendali jarak jauh; egress tidak difilter per host, lihat Firewall dan egress); me-resolve nama internal lewat resolver VCN. Ia tidak bisa membaca kredensial web: `OPENWA_API_KEY` key web hanya berlaku dari alamat `wa-proxy`, dan `WA_WEBHOOK_SECRET` memang sudah ia pegang.
- **Kebocoran sesi** = pengambilalihan akun bot (bukan akun pengguna). Tindakan: logout sesi (Operasi), hapus perangkat di HP bot, pautkan ulang, rotasi key web dan rahasia webhook.
- **Image pihak ketiga.** Tidak ada tanda tangan pemilik; kepercayaan = digest yang dipatok dari GHCR proyek OpenWA, rilis yang sudah berumur paling sedikit 7 hari (waktu bagi komunitas menemukan rilis yang disusupi atau rusak). Image `arm64` juga memuat paket Chromium Debian yang tidak dipakai Baileys (permukaan CVE lebih besar). Dipindai Trivy mingguan dan di setiap PR yang mengubah pin (`.github/workflows/openwa-image.yml`, `docs/ops/ci-keamanan.md`).
- **Rilis sangat sering** (0.27.1 sampai 0.29.1 dalam 5 hari). Versi dipatok; naik versi hanya lewat PR dengan membaca CHANGELOG. `0.27.1` belum memuat perbaikan `0.28.0`/`0.29.x` (antara lain sesi Baileys di SQLite yang menahan proses saat banyak chat tersimpan, batas ukuran body JSON, log tanpa karakter kontrol); naikkan ke `0.29.1` lewat PR sesudah 2026-11-14 18:52 WIB bila Trivy dan uji di VM hijau; pengecualian Trivy `.trivyignore-openwa.yaml` untuk Chromium/apt 0.27.1 kedaluwarsa 2026-11-21, kosongkan saat bump.

## Daftar periksa pemilik

- [ ] SIM khusus dan HP bot siap, WhatsApp terpasang dan dipakai sebentar (langkah 1).
- [ ] Berkas terpasang, subnet `172.16.26.0/24`, `172.16.27.0/24`, `172.16.28.0/24` bebas, kedua Caddyfile `Valid configuration`, gw di-restart, `/api/wa/*` = `404 0` tanpa `Cache-Control` dari VM App, diulang sesudah langkah 6 (langkah 2, 6).
- [ ] Backend firewall Docker `iptables`, resolver host `169.254.169.254`, `firewall.sh up` dijalankan dan aturan terlihat (rantai egress, tiga `DROP` INPUT dari `172.16.26.0/24`, `172.16.27.0/24`, `172.16.28.0/24`) (langkah 2).
- [ ] Web hanya di `dompetku_app`, `dompetku_internal`, `dompetku_wa_web` (`172.16.28.128/25`); `wa_web` `isolated`, IPv6 mati, tanpa alamat `172.16.28.x` di host (langkah 2).
- [ ] Digest image diperiksa ulang: `0.27.1`, `arm64`, uid 997 (langkah 2). Bila ingin versi lain, PR dulu (rilis >= 7 hari).
- [ ] `env/openwa.env` dibuat di VM, `API_MASTER_KEY` di password manager pemilik (langkah 3).
- [ ] `wa-proxy` berjalan non-root di `172.16.26.2`/`172.16.28.2`; `openwa` `healthy`, tanpa port host, hanya `wa` (`172.16.26.3`) + `wa_egress` (langkah 4).
- [ ] Pemeriksaan pemisahan dan egress dari dalam `openwa` dan `web` sesuai harapan: web, postgres, IMDS (`169.254.169.254`), VM App, port host lewat gateway (`172.16.26.1:22`, `172.16.27.1:22`, `172.16.28.1:22`) tidak terjangkau; `wa` `isolated`, tanpa alamat `172.16.26.x` di host; WhatsApp terjangkau (langkah 4).
- [ ] Nomor bot tertaut, status `ready`; override 5B dihapus bila dipakai; timer deploy dinyalakan lagi (langkah 5, 7).
- [ ] Key web `operator` dengan `allowedSessions` = sesi bot dan `allowedIps` = `172.16.26.2` tersimpan di `web.env`; tambahan `web.env` (`OPENWA_URL=http://wa-proxy:2786`) diverifikasi tanpa mencetak isi (langkah 5, 6).
- [ ] Webhook terdaftar tepat satu, `http://wa-proxy:8081/api/wa/webhook` (langkah 7).
- [ ] Uji `hubung KODE`, catat, `batal` lulus; log web dan `wa-proxy` tanpa teks pesan; log `wa-proxy` tanpa header (`PALSU_cek_log`, `"headers"`, key web: ketiganya `0`) (langkah 8).
- [ ] Izin volume `700`, grup `docker` ditinjau (Backup dan akses).
- [ ] Keputusan backup `openwa_data` (tidak di-backup) disetujui atau diubah.
- [ ] Workflow `openwa-image.yml` hijau di PR (atau temuan diputuskan: pengecualian bertanggal, versi lain, atau tunda fitur); `workflow_dispatch` sekali sesudah merge dan notifikasi Actions aktif (`docs/ops/ci-keamanan.md`).
- [ ] **Risiko yang diterima pemilik: webhook palsu yang sah.** `openwa` yang disusupi memegang rahasia webhook dan bisa membuat/membatalkan entri atas nama nomor terhubung mana pun, dibatasi `WA_MAX_AMOUNT` (contoh Rp25.000.000), `WA_RATE_PER_MIN` (contoh 10/menit per nomor), dan bisa dibatalkan dari app (Risiko). `wa-proxy` tidak menutupnya. Pilih: terima, tambahkan deteksi/alert, turunkan batas, atau jangan nyalakan fitur.
- [ ] **Risiko yang diterima pemilik: nomor bot diblokir WhatsApp**, dan `openwa` yang disusupi bisa memakai akun bot dan keluar ke internet (Risiko). Pilih: terima, atau tunggu adaptor Cloud API resmi.
