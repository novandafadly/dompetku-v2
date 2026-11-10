# Hasil pemasangan Catat via WhatsApp di VM DB (2026-11-10)

Mengikuti `docs/ops/runbook-wa.md` (dari `main` `2e12c46`, PR #27). Dikerjakan agen di VM DB (`rtp-prod-db-01`) dan VM App (`rtp-prod-app-01`); langkah bertanda [PEMILIK] dan semua rahasia diisi pemilik sendiri. Dokumen ini tanpa nomor, kode, key, atau rahasia apa pun.

## Status

**Pemasangan, gerbang keamanan, dan ketiga uji akhir lulus** (`hubung KODE`, catat `25rb makan siang`, `batal`).

Percobaan pertama catat ditolak `saldo_negatif` karena dompet bawaan pemilik tidak cukup saldo (2 pesan; perilaku sengaja, spec 4.4 dan keputusan 6, bukan kegagalan pasang). Sesudah dompet bawaan pemilik bisa dipakai (cara penyiapannya tidak tercatat di sini), uji ulang lulus dengan bukti log web berurutan (UTC, tanpa isi pesan): 16:35:32 `linked`, 16:38:09 `recorded`, 16:42:28 `cancelled`, 16:44:29 `recorded`, 16:44:38 `cancelled`. Total sejak pasang: 3 `linked`, 2 `recorded`, 2 `cancelled`, 2 `rejected saldo_negatif`. Log `wa-proxy` dan web bersih dari teks pesan, header, key, dan rahasia; galat web 0. Pemilik melaporkan uji dilakukan oleh dua orang (pemilik dan Farida); log sengaja tanpa identitas, jadi pembagiannya tidak bisa dibuktikan dari log.

## Hasil per langkah

| Langkah runbook                | Hasil                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventaris                     | Docker 29.1.3 (backend firewall `iptables`), subnet 172.16.26/27/28.0/24 bebas (hanya `worker_db` 172.16.25.0/24), resolver host `169.254.169.254`, berkas terpasang = versi `main` sebelum WA (tanpa drift)                                                                                                              |
| 2. Berkas, gw, firewall, web   | Backup `*.pre-wa` (hash cocok), 9 berkas terpasang (hash cocok), digest image `0.27.1` = tag di GHCR, arm64, uid 997, `curl` ada; kedua Caddyfile `Valid configuration`; gw di-restart; `firewall.sh up` idempoten (13 aturan sebelum dan sesudah); web di `wa_web` (`isolated`, tanpa alamat host, IPv6 mati), `healthy` |
| Gerbang VM App                 | POST/GET `/api/wa`, `/api/wa/webhook`, `/api/wa/x/y` = `404` 0 B tanpa `Cache-Control`, juga sesudah web memakai konfigurasi WA (bukan `401`)                                                                                                                                                                             |
| 3. `env/openwa.env` [PEMILIK]  | `600 root`, satu `API_MASTER_KEY` 64 hex, tanpa pepper. Percobaan pertama tidak menghasilkan berkas (penyebab tidak diketahui); dijalankan ulang, lulus                                                                                                                                                                   |
| 4. Nyalakan, pemisahan, egress | Lihat bagian Pemeriksaan pemisahan di bawah                                                                                                                                                                                                                                                                               |
| 5. Sesi, pairing [PEMILIK]     | Sesi `dompetku-bot` `qr_ready` lalu `ready` lewat kode pairing (5A); 5B tidak dipakai; key web `operator` (`allowedIps` `172.16.26.2`, `allowedSessions` hanya sesi bot) tersimpan, satu key web di OpenWA                                                                                                                |
| 6. `web.env` [PEMILIK]         | 7 variabel WA terisi (pola diverifikasi tanpa mencetak isi), `web.env.pre-wa` sebagai rollback, web dibuat ulang `healthy`                                                                                                                                                                                                |
| 7. Webhook [PEMILIK]           | Tepat satu: `http://wa-proxy:8081/api/wa/webhook`, `message.received`, aktif, `retryCount` 3 diterima; daftar tanpa field secret; timer deploy dinyalakan lagi                                                                                                                                                            |
| 8. Ujung ke ujung              | `hubung KODE`, catat, dan `batal` lulus (lihat Status). Pada jendela uji terakhir (30 menit) ada 5 kejadian di log web, 5 webhook `200`, dan 5 balasan `send-text` `201` di `wa-proxy`, jadi payload `message.received` teks pribadi terbaca adaptor                                                                      |
| Izin volume dan akses          | `openwa_data` `700` uid 997, tidak ada berkas dengan izin group/other, `openwa` tetap `healthy`; grup `docker` hanya `ubuntu`                                                                                                                                                                                             |

## Pemeriksaan pemisahan (semua lulus sebelum pairing)

- Dari `openwa`: `web:3000` kode 6, alamat web di `wa_web` kode 28, `postgres:5432` kode 6, `wa-proxy:2786` kode 7; di `:8081` POST sign-in `404`, GET webhook `405`, POST webhook `404` (sebelum fitur WA web hidup), `401` sesudahnya.
- Egress dari `openwa`: IMDS, VM App, `10.0.1.68:8443` kode 28; `172.16.26.1:22` kode 7; `172.16.27.1:22` kode 28; DNS dan HTTPS ke `web.whatsapp.com` jalan (curl `-k` dan Node dengan verifikasi, HTTP 200). Penghitung `DROP` di `DOMPETKU-WA-EGRESS` naik (IMDS 5, VCN 10, Docker 5 paket).
- Dari `web`: `openwa:2785` `ENOTFOUND`, `wa-proxy:2786` `404`, `172.16.28.1:22` `EHOSTUNREACH`.
- Log `wa-proxy`: `PALSU_cek_log` 0, `"headers"` 0, key web asli 0, rahasia webhook 0.

## Penyimpangan dari runbook dan temuan

1. **`/data` dan `/config` `wa-proxy` berizin `755 root`** (tmpfs compose di Docker 29.1.3), sedangkan Caddy berjalan uid 65532: log start memuat satu `error` dan satu `warn` (`mkdir /data/caddy: permission denied`, gagal membersihkan penyimpanan sertifikat). Tidak berdampak fungsi (`auto_https off`, `admin off`, `persist_config off`; semua cek perilaku lulus). Runbook berharap "tanpa error". Diterima pemilik, **perbaikan lewat PR** (usulan: `mode=1777` atau `uid=65532` pada tmpfs; belum diuji). CI lolos karena `wa-proxy-test.sh` memakai `docker run --tmpfs` (dugaan, belum dibuktikan).
2. **Image OpenWA tanpa `/etc/ssl/certs`:** `curl` di dalamnya gagal `(77) error setting certificate file`. Cek internet langkah 4 harus memakai `curl -k` atau Node (Baileys memakai Node). Koreksi runbook.
3. **`web.env` hidup tidak punya `WA_MAX_AMOUNT` dan `WA_RATE_PER_MIN`**; langkah 6 menganggapnya "dari contoh dibiarkan" padahal `web.env.new` disalin dari `web.env` hidup. Ditambahkan `25000000` dan `10` (nilai contoh). Tanpa itu berlaku bawaan kode 100000000 dan 30. Koreksi runbook.
4. **Alias `dk-db`/`dk-app` tidak ada.** VM App = mesin lokal; VM DB lewat `ssh -i ~/.ssh/db_key.pem ubuntu@10.0.1.68`.
5. **Run deploy sesudah pasang tidak mencatat `openwa_env_missing`:** tidak ada rilis baru, jadi `openwa_sync` tidak teramati. Belum terverifikasi.
6. **Butir UNVERIFIED terselesaikan:** `retryCount: 3` diterima; `gateway_mode_ipv4: isolated` bekerja di Docker 29.1.3 (bridge tanpa alamat host); pesan pribadi berteks dikenali adaptor.
7. **Dompet bawaan:** WhatsApp tidak bisa memilih dompet; kata `cimb` jatuh ke keterangan. Dompet = catatan terakhir pemilik di ruang itu, atau `operasional` pertama; `saldo_negatif` ditolak. Pengaturan dompet bawaan tercatat P1 di spec.

## Keadaan akhir VM DB

- Container: `dompetku-wa-proxy-1` (running, 65532, read-only), `dompetku-openwa-1` (healthy, 997, read-only, tanpa port host), web, worker, postgres, gw tetap.
- Network `dompetku_wa` dan `dompetku_wa_web` (internal, `isolated`, IPv6 mati), `dompetku_wa_egress` 172.16.27.0/24; volume `dompetku_openwa_data` (`700`).
- Firewall: rantai `DOMPETKU-WA-EGRESS` (2 `RETURN` DNS + 5 `DROP`), 3 `DROP` `INPUT` dari 172.16.26/27/28.0/24, 2 aturan gw lama utuh.
- Berkas rollback: `compose.yml.pre-wa`, `bin/deploy.pre-wa`, `gw/Caddyfile.pre-wa`, `bin/firewall.sh.pre-wa`, `bin/dompetku-firewall.service.pre-wa`, `env/web.env.pre-wa`. Prosedur: bagian Rollback di runbook.
- Timer deploy aktif. Pembantu `/tmp/dompetku-wa/owa.sh` (tanpa rahasia) boleh dihapus.

## Daftar periksa pemilik

| Butir                                                                             | Status                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------- |
| SIM dan HP bot siap                                                               | selesai (dikonfirmasi pemilik)                    |
| Berkas, subnet, Caddyfile, gw, `/api/wa/*` `404 0` (diulang sesudah langkah 6)    | selesai                                           |
| Backend firewall `iptables`, resolver, `firewall.sh up`, aturan terlihat          | selesai                                           |
| Web di `wa_web`, `isolated`, tanpa alamat host                                    | selesai                                           |
| Digest image `0.27.1`, arm64, uid 997                                             | selesai                                           |
| `env/openwa.env`; `API_MASTER_KEY` di password manager pemilik                    | selesai (penyimpanan oleh pemilik)                |
| `wa-proxy` dan `openwa` berjalan sesuai harapan                                   | selesai (catatan temuan 1)                        |
| Pemisahan dan egress                                                              | selesai                                           |
| Nomor bot `ready`; timer dinyalakan                                               | selesai                                           |
| Key web dan `web.env`                                                             | selesai                                           |
| Webhook tepat satu                                                                | selesai                                           |
| Uji `hubung KODE`                                                                 | selesai                                           |
| Uji catat `25rb makan siang` dan `batal`                                          | selesai (2 `recorded`, 2 `cancelled`)             |
| Log web dan `wa-proxy` tanpa teks pesan dan header                                | selesai                                           |
| Izin volume `700`, grup `docker`                                                  | selesai                                           |
| Keputusan `openwa_data` tidak di-backup                                           | menunggu pemilik                                  |
| Workflow `openwa-image.yml` hijau, `workflow_dispatch` sekali, notifikasi Actions | tidak diperiksa (di GitHub, di luar lingkup agen) |
| Risiko diterima: webhook palsu sah (terpasang `25000000` dan `10`)                | menunggu pemilik                                  |
| Risiko diterima: nomor bot diblokir                                               | menunggu pemilik                                  |

## Tindak lanjut

1. **Run deploy berikutnya** (merge ke `main` memicu Release dan deploy): pastikan baris audit `/var/log/dompetku/deploy.log` mencatat `"openwa":"openwa_ok"` dan bot tetap membalas. `openwa_sync` belum pernah teramati.
2. **Fitur `@nama`** (pilih dompet per pesan, `@kantor` eksplisit di ruang Pribadi; fase `dompet cimb` ditunda): desain disetujui pemilik, dikerjakan di sesi terpisah, belum dimulai di repo.
3. PR perbaikan tmpfs `wa-proxy` (temuan 1) dan koreksi runbook (temuan 2 dan 3).
4. Bump OpenWA ke `0.29.1` sesudah 2026-11-14 18:52 WIB (pengecualian Trivy `0.27.1` kedaluwarsa 2026-11-21).
5. Pemilik memutuskan tiga butir daftar periksa yang menunggu.
