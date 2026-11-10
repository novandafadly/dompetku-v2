# Runbook: Catat via WhatsApp (OpenWA) di VM DB

Dasar: spec `docs/superpowers/specs/2026-11-09-catat-wa-openwa-design.md` §5.1 dan §6. OpenWA (`github.com/rmyndharis/OpenWA`) berjalan sebagai layanan compose `openwa` di project `dompetku`, engine Baileys, SQLite di volume `openwa_data`. Tanpa rahasia di dokumen ini; semua nilai rahasia diisi pemilik langsung di VM, tidak lewat chat.

Fakta OpenWA di dokumen ini diambil dari README, `.env.example`, `Dockerfile`, `docker-entrypoint.sh`, dan `docs/06-api-specification.md` pada tag `v0.29.1`. Yang belum bisa dibuktikan tanpa sesi nyata ditandai **UNVERIFIED**; uji di VM sebelum diandalkan.

## Yang berubah

| Bagian                               | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/db-vm/compose.yml`            | Layanan `openwa` (profil `web`): `ghcr.io/rmyndharis/openwa:0.29.1@sha256:5d4e2d71…a817a` (indeks multi-arch, ada `linux/arm64`), user `997:997`, read-only + tmpfs `/tmp`, volume `openwa_data:/app/data`, `cap_drop: ALL`, `no-new-privileges`, 512 MiB, 0,5 CPU, `pids_limit` 256, tanpa port host. Network `wa` (internal, `172.16.26.0/24`, hanya `openwa` + `web`) dan `wa_egress` (hanya `openwa`, keluar ke WhatsApp). `web` ikut network `wa`. |
| `infra/db-vm/gw/Caddyfile`           | `/api/wa` dan `/api/wa/*` dijawab `404` di gw sebelum proxy ke web: webhook tidak terjangkau dari publik, hanya dari `openwa` lewat network `wa`.                                                                                                                                                                                                                                                                                                       |
| `infra/db-vm/deploy/deploy`          | Sesudah web (dan worker) sehat: `compose up -d --no-deps openwa` bila `env/openwa.env` ada. Gagal tidak me-rollback web. Tanpa env: container lama dihentikan. Rollback web tidak menyentuh openwa. Hasil di field audit `openwa` (`deploy/README.md`).                                                                                                                                                                                                 |
| `infra/db-vm/env/openwa.env.example` | Contoh `/opt/dompetku/env/openwa.env`: hanya `API_MASTER_KEY` (rahasia), `API_KEY_PEPPER` opsional, `LOG_LEVEL`. Nilai non-rahasia dipatok di `compose.yml`.                                                                                                                                                                                                                                                                                            |
| `infra/db-vm/deploy/web.env.example` | `OPENWA_URL=http://openwa:2785` (bukan `127.0.0.1`: itu container web sendiri) dan keterangan variabel WA.                                                                                                                                                                                                                                                                                                                                              |

Pengaturan yang dipatok di `compose.yml` (menang atas `openwa.env`) dan alasannya:

| Variabel                                     | Nilai               | Alasan                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE_TYPE`, `DATABASE_TYPE`               | `baileys`, `sqlite` | Tanpa Chromium, tanpa Redis/Postgres. `DATABASE_NAME` sengaja tidak diisi: untuk SQLite nilainya jadi path berkas dan di rootfs read-only membuat boot-loop.                                             |
| `RESOLVE_LID_TO_PHONE`                       | `true`              | Pengirim `@lid` mendapat `senderPhone`. Tanpa ini nomor `@lid` tidak pernah bisa dihubungkan.                                                                                                            |
| `AUTO_START_SESSIONS`                        | `true`              | Bawaan production mati: tanpa ini setiap restart/recreate container (deploy dengan digest baru, reboot VM) membuat bot diam sampai `POST /start` manual.                                                 |
| `WEBHOOK_SSRF_PROTECT`, `SSRF_ALLOWED_HOSTS` | `true`, `web`       | Guard SSRF menolak webhook ke alamat privat; `web` diizinkan secara eksplisit, tujuan lain tetap dijaga. Host di daftar ini di-resolve saat pendaftaran webhook, jadi web harus sudah ikut network `wa`. |
| `WEBHOOK_TIMEOUT`                            | `20000`             | Lihat "Timeout webhook" di bawah.                                                                                                                                                                        |
| `MESSAGE_RETENTION_DAYS`                     | `7`                 | OpenWA menyimpan teks pesan (nominal, keterangan) di SQLite-nya; bawaan `0` = selamanya.                                                                                                                 |
| `MAX_CONCURRENT_SESSIONS`                    | `1`                 | Satu nomor bot.                                                                                                                                                                                          |
| `UPDATE_CHECK_ENABLED`, `ENABLE_SWAGGER`     | `false`             | Tanpa panggilan ke `api.github.com`; Swagger (skema + versi tanpa API key) tidak disajikan.                                                                                                              |
| `CSP_UPGRADE_INSECURE_REQUESTS`              | `false`             | Dasbor hanya dibuka lewat tunnel ke `http://localhost` (langkah 5B); tanpa ini layar putih.                                                                                                              |

### Timeout webhook

Handler `POST /api/wa/webhook` di web menunggu `sendText` ke OpenWA (batas 10 detik) sebelum menjawab. `WEBHOOK_TIMEOUT` bawaan OpenWA 10 000 ms, jadi saat OpenWA lambat menerima kiriman balasan, OpenWA memutus webhook lebih dulu dan mengirim ulang. Pengiriman ulang aman (entri idempoten lewat `clientId` dari id pesan, `replayed: true`), tetapi pengguna bisa menerima balasan ganda. Karena itu `WEBHOOK_TIMEOUT=20000`; nilai ini harus tetap lebih besar dari batas `sendText` web bila salah satunya diubah.

### `/api/wa/*` diblokir di gw

Webhook hanya untuk OpenWA. Request publik ke `https://dompet.novandafadly.com/api/wa/...` berhenti di gw dengan `404` dan tidak sampai ke web. OpenWA memanggil `http://web:3000/api/wa/webhook` langsung lewat network `wa` (tidak lewat nginx/gw). HMAC (`X-OpenWA-Signature`) tetap diperiksa web.

## Langkah

Isi `infra/db-vm/deploy/` disalin ke `/tmp/dompetku-wa/`, `infra/db-vm/compose.yml` ke `/tmp/dompetku-wa/compose.yml`, `infra/db-vm/gw/Caddyfile` ke `/tmp/dompetku-wa/Caddyfile`, dan `infra/db-vm/env/openwa.env.example` ke `/tmp/dompetku-wa/openwa.env.example`, lebih dulu (dari `main` sesudah PR ini di-merge, sehingga image web yang berjalan sudah memuat route webhook).

Semua perintah manual yang memanggil `docker compose` untuk mengganti layanan dibungkus `flock /run/lock/dompetku-deploy.lock` (kunci deployer), seperti runbook S7.

### 1. [PEMILIK] Prasyarat

- **SIM khusus bot.** Nomor baru (prabayar), bukan nomor utama pemilik atau Farida. Akun bot bisa diblokir WhatsApp kapan saja (lihat Risiko); nomor utama tidak boleh ikut taruhan itu.
- **HP untuk nomor bot** dengan WhatsApp atau WhatsApp Business terpasang dan terdaftar dengan SIM itu. OpenWA tertaut sebagai "perangkat tertaut" (linked device), jadi akun utamanya tetap di HP ini. HP perlu online sesekali: WhatsApp memutus perangkat tertaut bila HP utama lama tidak online (sekitar 14 hari menurut dokumentasi WhatsApp; **UNVERIFIED** untuk versi sekarang).
- Pakai nomor itu sebentar seperti akun biasa (foto profil, nama "DompetKu", beberapa chat) sebelum ditautkan. Akun baru yang langsung dipakai otomatis lebih berisiko diblokir (**UNVERIFIED**, pengalaman komunitas, bukan aturan resmi).
- Catat nomor bot dalam bentuk angka E.164 tanpa `+` (mis. `62812…`). Nomor tidak rahasia, tetapi tidak perlu ditempel di chat.

### 2. Berkas, gw, dan web di network `wa` (sesi VM)

```bash
sudo cp /opt/dompetku/compose.yml /opt/dompetku/compose.yml.pre-wa
sudo cp /opt/dompetku/bin/deploy /opt/dompetku/bin/deploy.pre-wa
sudo cp /opt/dompetku/gw/Caddyfile /opt/dompetku/gw/Caddyfile.pre-wa
cd /tmp/dompetku-wa
sudo install -m 755 deploy /opt/dompetku/bin/deploy
sudo install -m 644 compose.yml /opt/dompetku/compose.yml   # layanan openwa, network wa + wa_egress
sudo install -m 644 Caddyfile /opt/dompetku/gw/Caddyfile
sudo install -m 644 README.md /opt/dompetku/deploy/README.md
sudo install -m 644 web.env.example /opt/dompetku/deploy/web.env.example
sudo install -m 644 openwa.env.example /opt/dompetku/deploy/openwa.env.example
```

Subnet `172.16.26.0/24` belum boleh dipakai network lain (alasan sama dengan `worker_db` di runbook S7):

```bash
sudo docker network inspect $(sudo docker network ls -q) -f '{{ .Name }} {{ range .IPAM.Config }}{{ .Subnet }} {{ end }}' | grep ' 172\.16\.26\.'   # kosong
```

Bila tidak kosong: berhenti, catat nama network itu, tanyakan ke sesi Claude.

Image OpenWA: pastikan digest di `compose.yml` adalah rilis yang dimaksud dan ada varian `arm64`. Digest diambil dari GHCR 2026-11-10 (tag `0.29.1` = `0.29` = `latest` saat itu):

```bash
cd /opt/dompetku
sudo docker compose --profile web pull openwa
sudo docker compose --profile web config --images | grep openwa   # ghcr.io/rmyndharis/openwa:0.29.1@sha256:5d4e2d71d3802e6cd66ac92ff3543f2eb391d20e7db711e8641c5127644a817a
img=ghcr.io/rmyndharis/openwa@sha256:5d4e2d71d3802e6cd66ac92ff3543f2eb391d20e7db711e8641c5127644a817a
sudo docker image inspect -f '{{ .Architecture }} {{ .Os }}' "$img"                      # arm64 linux
sudo docker run --rm --network none --entrypoint id "$img" openwa                        # uid=997(openwa) gid=997(openwa)
sudo docker run --rm --network none --entrypoint sh "$img" -c 'command -v curl'          # /usr/bin/curl (dipakai healthcheck dan langkah 5)
```

Untuk naik versi nanti, digest diambil dari indeks multi-arch tag rilis (bukan digest per arsitektur), diganti bersama tag lewat PR. `docker compose pull` gagal keras bila digest tidak cocok dengan tag; jangan pernah menghapus `@sha256:…`.

gw: validasi lalu muat ulang. gw putus sebentar (koneksi aktif terputus); jalankan di luar jam pakai:

```bash
cd /opt/dompetku
sudo docker compose run --rm --no-deps gw caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile   # "Valid configuration"
sudo docker compose up -d gw
```

Web ikut network `wa` (deploy berikutnya juga melakukannya; manual agar langkah 4 tidak menunggu rilis):

```bash
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web
c=$(sudo docker compose --profile web ps -q web)
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' "$c"   # dompetku_app dompetku_internal dompetku_wa
sudo docker network inspect dompetku_wa -f '{{ .Internal }} {{ (index .IPAM.Config 0).Subnet }}' # true 172.16.26.0/24
```

Verifikasi dari VM App:

```bash
curl -s https://dompet.novandafadly.com/api/health                                                       # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://dompet.novandafadly.com/api/wa/webhook -d '{}'  # 404
curl -s -o /dev/null -w '%{http_code}\n' https://dompet.novandafadly.com/api/wa                           # 404
```

Verifikasi lain:

- `cd /opt/dompetku && sudo docker compose --profile web config --services` memuat `openwa`; tanpa profil tetap `gw`, `postgres`.
- `diff /opt/dompetku/compose.yml.pre-wa /opt/dompetku/compose.yml` hanya menambah blok `openwa`, network `wa`/`wa_egress`, volume `openwa_data`, `wa` di daftar network web, dan komentar.
- `sudo test -e /opt/dompetku/env/openwa.env || echo belum-ada` = `belum-ada`. Deploy yang terjadi sekarang mencatat `"openwa":"openwa_env_missing"`.

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

### 4. Menyalakan `openwa`

```bash
cd /opt/dompetku
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps openwa
c=$(sudo docker compose --profile web ps -q openwa)
sudo docker inspect -f '{{ .State.Health.Status }} {{ .Config.User }} {{ .HostConfig.ReadonlyRootfs }}' "$c"   # healthy 997:997 true (tunggu sampai 60 detik)
sudo docker inspect -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' "$c"              # dompetku_wa dompetku_wa_egress
sudo docker port "$c"                                                                                         # kosong
sudo docker compose --profile web logs --tail 50 openwa                                                       # tanpa FATAL/boot-loop
```

Pemisahan network (dari dalam `openwa`):

```bash
sudo docker compose --profile web exec -T openwa curl -sS -m 5 -o /dev/null http://postgres:5432; echo "kode $?"   # Could not resolve host (6)
sudo docker compose --profile web exec -T openwa curl -sS -m 5 -o /dev/null -w '%{http_code}\n' -X POST -d '{}' http://web:3000/api/wa/webhook
# 404 bila fitur WA di web belum dinyalakan (langkah 6), 401 sesudahnya (tanpa tanda tangan)
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

Web tidak memakai kunci admin. Buat key `operator` yang hanya berlaku untuk sesi bot dan hanya dari subnet network `wa`; responsnya langsung disaring ke `web.env.new` tanpa ditampilkan (key hanya dikembalikan sekali):

```bash
sudo install -m 600 /opt/dompetku/env/web.env /opt/dompetku/env/web.env.new
printf '{"name":"dompetku-web","role":"operator","allowedSessions":["%s"],"allowedIps":["172.16.26.0/24"]}' "$SID" |
  owa POST /api/auth/api-keys |
  sudo bash -c 'set -eu; f=/opt/dompetku/env/web.env.new; umask 077
    k=$(sed -n "s/.*\"apiKey\":\"\(owa_k1_[0-9a-f]\{64\}\)\".*/\1/p" | head -n 1); [ -n "$k" ] || { echo "key tidak ada di respons"; exit 1; }
    { grep -v "^OPENWA_API_KEY=" "$f"; printf "OPENWA_API_KEY=%s\n" "$k"; } >"$f.tmp"; chmod 600 "$f.tmp"; mv "$f.tmp" "$f"; echo key-tersimpan'
```

`allowedIps` dicocokkan dengan IP sumber web di network `wa`. Bila nanti `sendText` web ditolak `403` padahal sesi benar (mis. OpenWA melihat alamat dalam bentuk `::ffff:172.16.26.x`, **UNVERIFIED**), buat key baru tanpa `allowedIps` dan cabut yang lama (`owa GET /api/auth/api-keys`, lalu `DELETE /api/auth/api-keys/<id>`).

### 6. [PEMILIK] Tambahan `web.env`

Masih di `web.env.new` dari langkah 5 (berisi `OPENWA_API_KEY` baru). Rahasia webhook dibuat langsung di VM; satu-satunya salinan di VM ada di `web.env` (OpenWA menyimpannya sendiri lewat pendaftaran webhook di langkah 7):

```bash
sudo bash -c 'set -eu; f=/opt/dompetku/env/web.env.new; umask 077; s=$(openssl rand -hex 32)
  { grep -v -e "^WA_WEBHOOK_SECRET=" -e "^OPENWA_URL=" -e "^OPENWA_SESSION=" "$f"
    printf "WA_WEBHOOK_SECRET=%s\nOPENWA_URL=http://openwa:2785\nOPENWA_SESSION=%s\n" "$s" "'"$SID"'"; } >"$f.tmp"
  chmod 600 "$f.tmp"; mv "$f.tmp" "$f"'
sudo nano /opt/dompetku/env/web.env.new   # isi WA_BOT_NUMBER=<angka E.164 tanpa +>; WA_MAX_AMOUNT/WA_RATE_PER_MIN boleh kosong (bawaan 100000000 dan 30)
f=/opt/dompetku/env/web.env.new
sudo grep -c '^WA_WEBHOOK_SECRET=[0-9a-f]\{64\}$' "$f"                              # 1
sudo grep -c '^OPENWA_URL=http://openwa:2785$' "$f"                                  # 1
sudo grep -c '^OPENWA_API_KEY=owa_k1_[0-9a-f]\{64\}$' "$f"                           # 1
sudo grep -c '^OPENWA_SESSION=[0-9a-f]\{8\}-[0-9a-f-]\{27\}$' "$f"                   # 1
sudo grep -c '^WA_BOT_NUMBER=62[0-9]\{8,13\}$' "$f"                                  # 1
sudo grep -c '^DATABASE_URL=' "$f"                                                   # 1 (isi lama tetap)
sudo stat -c '%a %U' "$f"                                                             # 600 root
sudo mv /opt/dompetku/env/web.env.new /opt/dompetku/env/web.env
cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web
```

Tunggu web `healthy` dan `curl` health dari VM App seperti langkah 2. Sesudahnya perintah `curl … http://web:3000/api/wa/webhook` di langkah 4 menjawab `401` (fitur hidup, tanpa tanda tangan); `503` = konfigurasi WA di `web.env` tidak lengkap/salah (log web `[wa] config_error`).

### 7. Mendaftarkan webhook

Body disusun dari `web.env` di shell root (rahasia lewat pipa, tidak di argv), lalu dikirim lewat `owa`:

```bash
sudo bash -c 'set -eu; s=$(sed -n "s/^WA_WEBHOOK_SECRET=//p" /opt/dompetku/env/web.env)
  printf "{\"url\":\"http://web:3000/api/wa/webhook\",\"events\":[\"message.received\"],\"secret\":\"%s\",\"retryCount\":3}" "$s"' |
  owa POST "/api/sessions/$SID/webhooks"     # 201; respons tidak memuat secret
owa GET "/api/sessions/$SID/webhooks" </dev/null   # tepat satu webhook, url http://web:3000/api/wa/webhook
sudo systemctl start dompetku-deploy.timer
```

`400` dengan pesan SSRF = `SSRF_ALLOWED_HOSTS` tidak sampai ke container atau web belum ikut network `wa` (langkah 2).

### 8. Verifikasi ujung ke ujung

1. Di app (pemilik): menu WhatsApp → Hubungkan → kode muncul.
2. Dari WhatsApp pribadi pemilik, kirim ke nomor bot: `hubung KODE`. Harapan: balasan "Nomor terhubung".
3. Kirim `25rb kopi`. Harapan: balasan konfirmasi dan entri muncul di Transaksi. Kirim `batal`: entri dibatalkan.
4. Log tanpa teks pesan dan nominal:

   ```bash
   cd /opt/dompetku
   sudo docker compose --profile web logs --since 10m web | grep '\[wa\]'      # tanpa isi pesan, tanpa nominal
   sudo docker compose --profile web logs --since 10m openwa | grep -i webhook  # tanpa 401/timeout berulang
   ```

5. Nomor yang tidak terhubung (mis. HP lain) mengirim pesan: balasan petunjuk "belum terhubung" paling banyak sekali per jam, tanpa entri.

## Operasi

- **Status sesi:** `owa GET "/api/sessions/$SID" </dev/null` (`ready` = tersambung). `SID` = `OPENWA_SESSION` di `web.env` (`sudo sed -n 's/^OPENWA_SESSION=//p' /opt/dompetku/env/web.env`; bukan rahasia).
- **Sesi putus** (status `disconnected`/`failed`, atau HP bot menghapus perangkat tertaut): coba `owa POST "/api/sessions/$SID/start" </dev/null`. Bila kembali `qr_ready`, pautan hilang: ulangi langkah 5A (atau 5B) dengan `SID` yang sama. Key web dan webhook tetap berlaku (terikat ke `SID`).
- **Putuskan nomor bot** (mis. HP/SIM bot hilang, ganti nomor): `owa POST "/api/sessions/$SID/logout" </dev/null` (menghapus kredensial sesi di volume dan perangkat tertaut), juga hapus perangkat di HP bot bila masih ada. Nomor pengguna yang terhubung diputus dari app (menu WhatsApp → Putuskan), bukan di OpenWA.
- **Matikan sementara:** `cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web stop openwa`. Deploy berikutnya menyalakannya lagi selama `openwa.env` ada.
- **Rotasi rahasia webhook:** buat rahasia baru di `web.env` (pola langkah 6), `owa GET "/api/sessions/$SID/webhooks"` untuk id lama, `owa DELETE "/api/sessions/$SID/webhooks/<id>" </dev/null`, daftarkan ulang (langkah 7), lalu buat ulang web. Pesan di antara kedua langkah gagal HMAC (`401`) dan dikirim ulang OpenWA.
- **Rotasi key web:** buat key baru (langkah 5, bagian key), buat ulang web, lalu cabut key lama (`DELETE /api/auth/api-keys/<id>`).
- **Naik versi OpenWA:** PR yang mengganti tag dan digest di `compose.yml` (baca `CHANGELOG.md` bagian "Upgrade notes" versi di antaranya). Sesudah merge, salin `compose.yml` ke VM (langkah 2, baris `install compose.yml`); deployer menaikkan openwa pada rilis web berikutnya, atau manual `sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps openwa`. Sebelum naik versi, ambil cuplikan lokal volume untuk mundur (bagian Backup) dan hapus sesudah versi baru stabil.

## Rollback

Fitur mati tanpa menghapus sesi:

```bash
sudo mv /opt/dompetku/env/openwa.env /opt/dompetku/env/openwa.env.off
cd /opt/dompetku && sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web rm -sf openwa
```

Lalu kosongkan variabel WA di `web.env` (pola `.new`, `grep -v` baris `WA_*` dan `OPENWA_*`) dan buat ulang web: tanpa variabel itu route webhook menjawab `404` dan menu WhatsApp di app tampil sebagai fitur mati. Deploy berikutnya mencatat `"openwa":"openwa_env_missing"` dan tidak menyalakan openwa.

Rollback penuh pemasangan (mengembalikan berkas sebelum WA):

```bash
sudo mv /opt/dompetku/compose.yml.pre-wa /opt/dompetku/compose.yml
sudo mv /opt/dompetku/bin/deploy.pre-wa /opt/dompetku/bin/deploy
sudo mv /opt/dompetku/gw/Caddyfile.pre-wa /opt/dompetku/gw/Caddyfile
cd /opt/dompetku
sudo docker compose up -d gw
sudo flock /run/lock/dompetku-deploy.lock docker compose --profile web up -d --no-deps web   # keluar dari network wa
sudo docker network rm dompetku_wa dompetku_wa_egress || true
```

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

`infra/db-vm/bin/firewall.sh` hanya membatasi koneksi **masuk** ke port gw (`10.0.1.68:8443`/`9443` hanya dari VM App) di rantai `DOCKER-USER`. Tidak ada aturan egress untuk network Docker, jadi `openwa` (tanpa port host, hanya koneksi keluar lewat `wa_egress`) tidak butuh perubahan firewall. Port loopback sementara langkah 5B tidak terjangkau dari luar (VM DB memakai Docker 29.1; sejak Docker 28 akses dari host lain ke port yang dipublikasikan di `127.0.0.1` diblokir). Bila nanti egress dibatasi (iptables atau security list OCI), `openwa` perlu TCP 443 keluar ke server WhatsApp (WebSocket `web.whatsapp.com` dan media `*.whatsapp.net`/`*.cdn.whatsapp.net`; daftar host tidak stabil, **UNVERIFIED** untuk Baileys versi ini), jadi pembatasan per host tidak praktis; batasi per port saja.

## Risiko

- **Protokol tidak resmi.** OpenWA/Baileys meniru WhatsApp Web; melanggar ketentuan WhatsApp untuk otomatisasi. Nomor bot bisa diblokir tanpa peringatan, dan perubahan protokol di sisi WhatsApp bisa mematikan bot sampai OpenWA dirilis ulang. Mitigasi: nomor khusus, bot hanya membalas orang yang menulis lebih dulu (tanpa broadcast), app tetap jalur utama. Jalur resmi (WhatsApp Cloud API) = adaptor baru (spec §5.4).
- **Kompromi container `openwa`.** Penyerang di `openwa` hanya menjangkau web lewat network `wa` (semua route web, bukan hanya webhook, tanpa melewati gw; webhook tetap butuh HMAC yang tidak ada di `openwa.env`) dan internet lewat `wa_egress`; tidak menjangkau postgres, gw, atau worker. Ia bisa memakai akun bot dan membaca pesan masuk 7 hari terakhir.
- **Kebocoran sesi** = pengambilalihan akun bot (bukan akun pengguna). Tindakan: logout sesi (Operasi), hapus perangkat di HP bot, pautkan ulang, rotasi key web dan rahasia webhook.
- **Image pihak ketiga.** Tidak ada tanda tangan pemilik; kepercayaan = digest yang dipatok dari GHCR proyek OpenWA. Image `arm64` juga memuat paket Chromium Debian yang tidak dipakai Baileys (permukaan CVE lebih besar). Cakupan pemindaian: `docs/ops/ci-keamanan.md`.
- **Rilis sangat sering** (0.27.1 sampai 0.29.1 dalam 5 hari). Versi dipatok; naik versi hanya lewat PR dengan membaca CHANGELOG.

## Daftar periksa pemilik

- [ ] SIM khusus dan HP bot siap, WhatsApp terpasang dan dipakai sebentar (langkah 1).
- [ ] Berkas terpasang, subnet `172.16.26.0/24` bebas, gw valid dan `/api/wa/*` = `404` dari VM App, web ikut `dompetku_wa` (langkah 2).
- [ ] Digest image diperiksa ulang: `arm64`, uid 997 (langkah 2). Bila ingin versi lain, PR dulu.
- [ ] `env/openwa.env` dibuat di VM, `API_MASTER_KEY` di password manager pemilik (langkah 3).
- [ ] `openwa` `healthy`, tanpa port host, hanya network `wa` + `wa_egress` (langkah 4).
- [ ] Nomor bot tertaut, status `ready`; override 5B dihapus bila dipakai; timer deploy dinyalakan lagi (langkah 5, 7).
- [ ] Key web `operator` terbatas sesi + subnet tersimpan di `web.env`; tambahan `web.env` diverifikasi tanpa mencetak isi (langkah 5, 6).
- [ ] Webhook terdaftar tepat satu (langkah 7).
- [ ] Uji `hubung KODE`, catat, `batal` lulus; log tanpa teks pesan (langkah 8).
- [ ] Izin volume `700`, grup `docker` ditinjau (Backup dan akses).
- [ ] Keputusan backup `openwa_data` (tidak di-backup) disetujui atau diubah.
