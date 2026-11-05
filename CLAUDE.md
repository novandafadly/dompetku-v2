# DompetKu v2: panduan sesi

Aplikasi keuangan pribadi + bersama untuk Novanda dan Farida. Repo private, juga bahan portofolio (screenshot saja).

## Aturan kerja

- Kerja di branch fitur baru dari `main` terbaru (`claude/<milestone>-<topik>`). Jangan push langsung ke `main`. Pemilik mengizinkan agen membuat dan merge PR sendiri (2026-11-01) dengan syarat: CI hijau di head PR dan review (task + keamanan untuk uang/auth/DB) bersih. Merge = rilis + deploy otomatis ke VM (migrasi jalan di DB produksi).
- v1 (`novandafadly/dompetku`, Supabase `yvapmbjtuhqvsunkmkxw`) read-only: hanya SELECT dan metadata.
- Tidak ada secret di repo; pakai `.env.example`.
- Commit kecil, pesan jelas (Conventional Commits, bahasa Indonesia), trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, pastikan tidak ada proses Playwright lain).
- Eksekusi plan: superpowers subagent-driven-development (implementer per task, task review, fix loop, review akhir). Logika uang/RLS/DB pakai model terkuat.
- UI: antislop mode DURING, arah visual di `DESIGN.md` (Panel Malam, handoff `docs/design/panel-malam/`). Jalankan Delivery Gate antislop sebelum menyerahkan UI.
- Balas pemilik dalam bahasa Indonesia, ringkas.

## Peta dokumen

- Spec induk (disetujui): `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (§9 = keputusan tim, §9.4 milestone).
- Spec turunan: `docs/spec/{design,ui-ux,frontend}.md` (ui-ux Lampiran A digantikan ADR 0005, lalu ADR 0006).
- ADR: `docs/adr/` (0001 stack, 0002 budget JS 162 kB, 0003 pratinjau Vercel, 0005 gelap premium (digantikan), 0006 Panel Malam, 0004 hasil penilaian M0a (lulus), 0007 Better Auth 1.7.12.
- Keputusan yang diambil agen atas nama pemilik selama M0a: `docs/m0a-keputusan.md`.
- Tim produk (riset awal): `docs/team/`.

## Status (2026-11-05)

- **M0a (prototipe data demo) selesai** di branch `claude/m0a-prototype`: Beranda, Catat, Transaksi, Dompet, onboarding, auth tiruan (Terima undangan → Buat akun → Amankan); arah visual Panel Malam dari handoff Claude Design (ADR 0006, laporan `docs/design/panel-malam/IMPLEMENTATION-REPORT.md`); e2e 215/215.
- Pratinjau: Vercel project `dompetku-v2` (Root `apps/web`, env `NEXT_PUBLIC_PROTOTYPE=1`, Vercel Authentication). Akses MCP Vercel agen hanya baca (buat/ubah project = 403). Browser sandbox tidak bisa membuka `*.vercel.app` kecuali pemilik menambahkannya di network setting.
- `main` berisi M0a, M0b S1–S4, M1 S5 (PR #2–#11) dan S6 (PR #14): infra VM, deployer cosign, Postgres + backup, migrasi 0001–0010 (ruang, undangan, audit, Better Auth) dan 0100–0108 (ledger, Catat, kategori), pgTAP 600+ asersi di job CI `db`, auth sungguhan (ADR 0007, tes `test:int` + `e2e:auth` di job CI `auth`). Image `ghcr.io/novandafadly/dompetku-web` ditandatangani cosign berkunci tanpa Rekor (`docs/ops/ci-keamanan.md`).
- **S6 (Catat, kategori + saran, edit/void/undo, Sampah, `product_events`, "Tidak ada pengeluaran hari ini") selesai dan di-merge ke `main` (PR #14):** UI nyata di atas ledger, migrasi 0106–0108. Catatan teknis: BSD §16 "Catatan S6"; `docs/design/s6-bingkai.md`; `docs/superpowers/handoff/s6.md`.
- **S7 (transfer antar ruang, talangan + reimburse, "Pindahkan ke ruang lain", Cocokkan saldo / saldo awal / arsip, Bersama solo dan kosong, worker pg-boss, `dq_reconcile` 01:00 WIB) di-merge ke `main` (PR #15, 2026-11-04); deploy ke VM menunggu langkah pemilik `docs/ops/runbook-s7-worker.md`:** migrasi 0109–0113 (nama dompet unik, talangan, pindah ruang, 10 cek DQ + skema `pgboss`, `purge_voided` dua lintasan). Angka: pgTAP 965 (966 sesudah PR `dompetku-psql`), unit web 1906, worker unit 34 + int 8, `test:int` 154, e2e prototipe 290, `e2e:auth` 21, `e2e:ledger` 38 (+7 screenshot dilewati), `deploy-test.sh` 25; budget JS Beranda prototipe 161,5 / nyata 157,4 kB (batas 162). Catatan teknis: BSD §16 "Catatan S7"; ruling dan temuan: `docs/superpowers/handoff/s7-ledger.md`; desain + critique: `docs/design/s7-bingkai.md`; serah-terima: `docs/superpowers/handoff/s7.md`; pasang worker: `docs/ops/runbook-s7-worker.md`.
- **S8 (Bersama penuh: feed Aktivitas + Kontribusi di Beranda Bersama, halaman `/bersama/aktivitas`, onboarding Farida, biaya kaki keluar Bersama, registry ID tes) selesai di branch `ccr-48ce6bf9-qkb933`; PR menunggu CI dan pemilik:** migrasi 0114–0115 (`api.shared_activity`, `api.member_contributions`; fungsi baca, tanpa tabel baru), salinan tanpa "rumah tangga" (R4). Angka: pgTAP 1071 (CI `db`), unit web 2022, `test:int` 172, e2e prototipe 296, e2e:bersama 22, e2e:ledger 38, e2e:auth 22; budget JS Beranda prototipe 161,7 / nyata 157,5 kB (batas 162, headroom 0,3). Catatan teknis: BSD §16 "Catatan S8"; ruling dan temuan: `docs/superpowers/handoff/s8-ledger.md`; desain + critique: `docs/design/s8-bingkai.md`; serah-terima + langkah pemilik: `docs/superpowers/handoff/s8.md`.
- **Belum live untuk pengguna:** pemilik perlu mengikuti `docs/ops/auth.md` (Resend SPF/DKIM, `web.env`, `owner_email`, bootstrap akun). Sesudah bootstrap, halaman ruang memakai ledger nyata.

## Tertunda

1. **Penilaian M0a selesai:** lulus tanpa permintaan perubahan (ADR 0004).
2. **Konfirmasi pemilik:** Shareable Link untuk Farida disetujui; subdomain `dompet.novandafadly.com`; kedua VM `aarch64`, web + worker di VM DB (IPD §1). Rahasia diisi pemilik langsung di VM, tidak lewat chat. Favicon dibuat pemilik dari `docs/design/favicon-prompt.md`; pasang berkasnya saat dikirim. (Lime/violet, label kapital, teks handoff, dan arah visual Panel Malam sudah disetujui 2026-10-31.)
3. **Enam dokumen produk** di `docs/product/` (PRD, TRD, AFD, DBD, BSD, IPD) selesai dan sudah lewat satu putaran review tim (`docs/product/review/`); 18 keputusan pemilik disetujui (`review/keputusan-pemilik.md`). BSD **disetujui pemilik 2026-10-31** (§15 terjawab, periode gajian §8.2a) dan `bsd-check` lulus di PG 16 dan PG 17.11 (`docs/product/bsd-check/`); pindah ke pgTAP di CI M0b. Pertanyaan terbuka sisa: TRD §7.
4. **Peran designer:** tambah kursi "design reviewer" di setiap task UI, dan design critique pada pratinjau Panel Malam.
5. Budget JS tetap 162 kB rute (target 150 kB di M2 dibatalkan pemilik); Panel Malam memakai 160,9 kB.
6. **Berikutnya:** pemilik merge PR S8 (CI hijau) lalu mengikuti `docs/superpowers/handoff/s8.md` (prasyarat P1–P4, `docs/ops/auth.md` langkah 7 undang Farida, smoke dua akun; menurut pemilik P1–P4 dan akun Farida sudah ada). Lalu **S9** (anggaran, laporan, tagihan dasar, Beranda "aman dipakai"). Aturan M1: setiap page `[ruang]` memanggil `requireDataUser()` dan setiap kueri data lewat `withUser`.
7. **Ditunda kecil:** daftar event audit reserved wajib diperbarui saat event sistem baru ditambah (tes katalog sudah menjaga); tes `99_konkurensi` bisa meninggalkan `app.settings env='test'` di DB CI bila gagal di tengah; dbmate tanpa `--strict` (0009/0010 boleh terpasang setelah 0100+).
8. **Ditunda S6 (sisa kecil):** temuan critique S6: galat S6-C2 mode keyboard terpotong ellipsis, nama dompet panjang memakai empat baris di daftar Dompet, keterangan riwayat dompet terpotong saat nominal panjang. (Seed demo sudah keluar dari JS mode nyata di S7 Task 9; initializer `useCatat` diperbaiki Task 14.)
9. **Ditunda S7:** keputusan pemilik 2026-11-04 sudah dijalankan: `dompetku-psql` dibuat (`infra/db-vm/bin/`, `docs/ops/akses-db-manual.md`; alert anomali "koneksi admin tanpa event" ditunda sampai log Postgres dikirim ke luar VM); SBOM/Trivy `worker.mjs` = opsi B (tetap dibundel, osv-scanner PR + mingguan `osv-mingguan.yml`, `docs/ops/ci-keamanan.md`). Sisa: DQ07 tidak memicu alert (R20); password `worker.env` salah baru tertangkap sesudah web terpasang dan ikut rollback. Utang: chip saran Catat bergeser +24 px saat dipilih; kontrol Talangan di sheet Ubah belum ada (`Tidak diganti` tidak bisa dibalik dari UI); nama dompet panjang terpotong di sheet reimburse dan daftar Dompet; arah ambil Bersama→Pribadi hanya dijaga `s7.int`; biaya kaki keluar Bersama tidak ditampilkan; worker: `unhandledRejection` hanya log; urutan cek `create_reimbursement` (M5, aman di bawah RLS FORCE); flaky C9 akar tidak terbukti (tes dikuatkan); Delivery Gate antislop dijalankan sebagai daftar periksa (ulangi bila skill tersedia).
10. **Ditunda S8:** butir "Dibawa ke S9" di `docs/superpowers/handoff/s8.md` (biaya di riwayat dompet, loader `not_found` mid-request, `partnerName` bawaan, label Catatan/Keterangan, critique minor di `s8-bingkai.md`, duplikasi tes, kategori `Kontribusi Farida`).
