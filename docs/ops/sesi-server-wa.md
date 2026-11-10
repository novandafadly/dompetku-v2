# Sesi Claude Code untuk server: pasang Catat lewat WhatsApp

Sesi cloud tidak bisa SSH. Pemasangan fitur WhatsApp (OpenWA, `wa-proxy`, aturan firewall, gw) dijalankan oleh sesi Claude Code yang punya akses SSH ke VM (aturan umum dan persiapan sama dengan `docs/ops/sesi-server.md`). Sesi ini memakai `docs/ops/runbook-wa.md` sebagai skrip utama: prompt di bawah hanya mengatur cara kerjanya.

## Persiapan (sekali)

1. SIM khusus bot sudah aktif, WhatsApp atau WhatsApp Business terpasang di HP-nya dan sudah dipakai sebentar (runbook langkah 1). Catat nomornya dalam bentuk angka tanpa `+` (mis. `62812…`).
2. Claude Code berjalan **di laptop** dengan `ssh` ke `dk-db` dan `dk-app` (alias di `~/.ssh/config`), mode izin bawaan (setiap perintah ditanyakan dulu). Jangan pakai mode bypass di server produksi.
3. Clone repo dan pindah ke branch fitur (PR #27 belum merge):

   ```bash
   git clone git@github.com:novandafadly/dompetku-v2.git && cd dompetku-v2 && git checkout ccr-6fc4b982-0wmz1i
   ```

4. Pastikan CI PR #27 hijau (termasuk workflow `openwa-image.yml`; bila merah, putuskan dulu: pengecualian bertanggal, versi lain, atau tunda) dan keputusan di `docs/superpowers/handoff/wa.md` ("Keputusan pemilik") sudah kamu jawab.
5. Tempel prompt di bawah garis.

## Aturan rahasia

Rahasia tidak pernah ditempel ke chat, ke argumen perintah, atau ke log. Yang menyangkut rahasia (`API_MASTER_KEY`, key operator web, rahasia webhook) kamu buat dan isi sendiri langsung di VM (`read -rs`, editor, `chmod 600`, pemilik `root`); Claude hanya menyiapkan berkas kosong dan memeriksa keberadaan dan izinnya (`test -s`, `stat`), tidak pernah mencetak isinya.

---

Kamu bekerja di repo DompetKu v2, branch `ccr-6fc4b982-0wmz1i` (PR #27, belum merge). Baca dulu `CLAUDE.md`, lalu `docs/ops/runbook-wa.md` (seluruhnya), `docs/superpowers/handoff/wa.md`, `docs/superpowers/specs/2026-11-09-catat-wa-openwa-design.md` §5.1 dan §6, `docs/ops/runbook-s7-worker.md` (gaya pasang worker) dan `docs/ops/akses-db-manual.md`.

Tugas: memasang fitur Catat lewat WhatsApp di VM DB (`dk-db`, aarch64, 3 vCPU, 17 GiB, Docker dengan compose project `dompetku`) dan memeriksa gerbang di VM App (`dk-app`, nginx), mengikuti `docs/ops/runbook-wa.md` langkah demi langkah. Langkah bertanda **[PEMILIK]** dan semua yang menyangkut rahasia saya kerjakan sendiri: kamu menyiapkan dan memeriksa, saya yang mengisi.

Aturan:

1. **Inventaris dulu, hanya baca.** Sebelum mengubah apa pun: versi Docker dan compose, container dan network yang berjalan, subnet yang terpakai (`172.16.25.0/24`, `172.16.26.0/24`, `172.16.27.0/24`, `172.16.28.0/24`, `172.24.0.0/16` harus bebas atau milik DompetKu), backend firewall (`iptables`, `DOCKER-USER`), `dompetku-firewall.service`, versi deployer yang terpasang di `/opt/dompetku`, resolver host, status timer deploy. Tulis ringkasannya dan tunggu persetujuan saya sebelum langkah pertama.
2. **Satu langkah, satu verifikasi, lalu lanjut.** Tunjukkan perintah persis dan hasil harapannya sebelum menjalankan (runbook sudah memuatnya). Berhenti di setiap titik "UNVERIFIED" atau bila hasil berbeda dari harapan runbook; jangan menebak.
3. **Sebelum berkas apa pun dipasang:** hentikan timer deploy dan pastikan `dompetku-deploy.service` `inactive` (runbook langkah 2); cadangkan berkas lama ke `*.pre-wa`; jalankan `caddy validate` untuk KEDUA Caddyfile (gw dan wa-proxy) di VM dan tunjukkan `Valid configuration`; periksa ulang digest image (`0.27.1`, indeks multi-arch ada `linux/arm64`, uid 997) dengan registry API, jangan memakai versi lain tanpa PR.
4. **Pemeriksaan keamanan wajib lulus sebelum nomor bot ditautkan** (runbook langkah 2, 4, 5, 8): (a) dari dalam container `openwa`: `web:3000`, `postgres`, `169.254.169.254`, VM App `10.0.0.149`, dan port host lewat gateway (`172.16.26.1:22`, `172.16.27.1:22`, `172.16.28.1:22`) semuanya tidak terjangkau; internet 443 terjangkau; (b) dari VM App: `https://dompet.novandafadly.com/api/wa/webhook` dan `/api/wa` menjawab `404` dengan badan kosong dan tanpa `Cache-Control`, diulang sesudah `web.env` diisi; (c) `wa-proxy` berjalan non-root, hanya di `wa` dan `wa_web`, `openwa` hanya di `wa` dan `wa_egress`, tanpa port host; (d) `docker logs wa-proxy` tidak memuat header atau key (hitung `grep -c` dengan nilai palsu seperti di runbook, jangan dengan key asli); (e) `iptables -S DOCKER-USER` dan `INPUT` memuat aturan `wa_egress` dan tiga DROP INPUT; (f) izin volume `openwa_data` `700` dan berkas env `600` milik `root`. Catat hasil tiap pemeriksaan (angka atau `OK/GAGAL`), tanpa isi rahasia.
5. **Jangan** menghapus, menghentikan, atau mengubah container, volume, network, atau konfigurasi milik aplikasi lain (Postgres, `gw`, web, dan worker DompetKu juga hanya diubah sesuai runbook), tanpa `docker system prune`, tanpa `rm -rf` di luar berkas yang runbook sebutkan, tanpa menyentuh Supabase v1. **Jangan merge PR #27** dan jangan mengubah workflow atau rahasia di GitHub: merge dan deploy adalah keputusan saya. Bila sebuah langkah butuh image web baru (migrasi 0123, route webhook), berhenti dan beri tahu saya supaya saya yang merge dan menunggu deployer.
6. **Rollback siap.** Sebelum setiap perubahan, tulis perintah rollback-nya (runbook bagian Rollback) dan simpan di catatan sesi; bila verifikasi gagal, kembalikan keadaan sebelumnya dulu, baru analisis.
7. **Rahasia:** tidak pernah dicetak, ditempel, atau diberikan sebagai argumen. Untuk nilai yang harus saya isi, siapkan berkas kosong dengan nama variabel dan beri tahu saya persis perintah yang saya jalankan sendiri di VM.
8. **Selesai bila** daftar periksa pemilik di runbook terpenuhi sampai uji ujung ke ujung (`hubung KODE`, catat `25rb makan siang`, `batal`) lulus dan semua pemeriksaan pemisahan (aturan 4) tercatat `OK`. Tulis hasilnya (tanpa rahasia) ke `docs/ops/hasil-wa-server.md`: tanggal, versi image, daftar pemeriksaan dengan hasil, penyimpangan dari runbook, dan hal yang belum bisa diverifikasi. Commit ke branch baru `claude/wa-server-hasil` dari branch PR (Conventional Commits bahasa Indonesia, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); jangan push ke `main`.

Bila ada hal yang bertentangan dengan dokumen, berisiko mengganggu aplikasi lain, atau menunjukkan bahwa isolasi tidak tercapai (mis. `openwa` bisa menjangkau `web` atau port host), berhenti, jangan lanjut menautkan nomor, dan tanya saya.
