# Sesi Claude Code untuk server (M0b)

Sesi cloud tidak bisa SSH. Pekerjaan di VM dijalankan oleh sesi Claude Code yang punya akses SSH (di laptop pemilik yang tersambung SSH, atau langsung di VM). Sesi cloud tetap mengurus repo, dokumen, dan CI.

## Persiapan (sekali)

1. Cabut token yang pernah dikirim lewat chat (Healthchecks, Resend, GHCR), buat yang baru. GHCR: token fine-grained atau klasik dengan izin `read:packages` saja.
2. Pilih tempat Claude Code berjalan:
   - **Disarankan: di laptop**, dengan `ssh` ke kedua VM (alias `dk-app` dan `dk-db` di `~/.ssh/config`). Tidak ada kredensial GitHub di VM.
   - Di VM: clone repo memakai deploy key read-only khusus repo ini, bukan token pribadi.
3. Clone repo dan pindah ke branch kerja:

   ```bash
   git clone git@github.com:novandafadly/dompetku-v2.git && cd dompetku-v2 && git checkout claude/m0a-prototype
   ```

4. Jalankan `claude` di folder repo dengan mode izin bawaan (setiap perintah ditanyakan dulu). Jangan pakai mode bypass di server produksi.
5. Tempel prompt di bawah garis.

## Aturan rahasia

Token dan kata sandi tidak pernah ditempel ke chat. Claude menyiapkan file env berisi nama variabel kosong; pemilik mengisi nilainya sendiri dengan editor di VM, lalu `chmod 600`.

---

Kamu bekerja di repo DompetKu v2. Baca dulu `CLAUDE.md`, lalu `docs/product/IPD.md` (§1 dan §3, sprint S1), `docs/product/TRD.md` (arsitektur, keamanan, backup), dan `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` §9.5 dan §7a. Balas saya dalam bahasa Indonesia, ringkas.

Tugas: sprint **S1 (provisioning dan jaringan)** di dua VM OCI, keduanya `aarch64`:

- VM App (`dk-app`): 1 vCPU, RAM 5,8 GiB, disk 86% terpakai. Hanya reverse proxy untuk DompetKu.
- VM DB (`dk-db`): 3 vCPU, RAM 17 GiB, disk 55%. Tempat Postgres, `gw`, web, dan worker DompetKu.
- Domain: `dompet.novandafadly.com` (DNS saya ubah sendiri; beri tahu record persisnya).

Aturan:

1. **Inventaris dulu, hanya baca.** Sebelum mengubah apa pun, petakan isi kedua VM: container dan compose project yang berjalan, port yang terbuka, reverse proxy yang ada, firewall (iptables/nftables, security list yang terlihat), disk, cron/timer, versi Docker. Ada aplikasi lain di VM ini (termasuk v1 dan insiden port `:5435`); semuanya tidak boleh terganggu. Tulis hasilnya ke `docs/ops/inventaris-vm.md` tanpa rahasia (sensor token, password, isi file env).
2. **Rencana sebelum eksekusi.** Dari inventaris, tulis `docs/ops/runbook-s1.md`: langkah berurutan, perintah persis, cara verifikasi, dan cara rollback tiap langkah. Tunjukkan ringkasannya ke saya dan tunggu persetujuan sebelum menjalankan perubahan.
3. **Eksekusi bertahap.** Satu langkah, verifikasi, lanjut. Compose project `dompetku` terpisah dari app lain; Postgres tanpa port host; `gw` (Caddy) mTLS hanya dari IP privat VM App; reverse proxy VM App memakai yang sudah ada bila ada; TLS untuk domain; tidak ada port baru yang terbuka ke publik selain 443 (dan 80 untuk ACME bila perlu); `unattended-upgrades` aktif.
4. **Jangan** menghapus, menghentikan, atau mengubah container, volume, atau konfigurasi milik aplikasi lain. Jangan menyentuh database atau Supabase v1. Tanpa `docker system prune`, tanpa `rm -rf` di luar `/opt/dompetku`.
5. **Rahasia:** buat file `/opt/dompetku/env/*.env` berisi nama variabel tanpa nilai (contoh di `.env.example` repo bila ada), `chmod 600`, pemilik `root`. Saya yang mengisi nilainya. Jangan pernah mencetak isi file itu.
6. **Selesai bila** kriteria keluar S1 di IPD terpenuhi: HTTPS ke domain menjawab dari `gw` (boleh halaman sementara), Postgres tanpa port host, header forward hanya dipercaya dari `gw`, `x-middleware-subrequest` dibuang, app lain tetap normal (bandingkan dengan inventaris).
7. Commit `docs/ops/*.md` dan file konfigurasi tanpa rahasia ke branch baru `claude/m0b-s1-infra` (Conventional Commits bahasa Indonesia, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), push ke branch itu, jangan ke `main`, jangan buat PR.

Bila ada hal yang bertentangan dengan dokumen atau berisiko mengganggu app lain, berhenti dan tanya saya.
