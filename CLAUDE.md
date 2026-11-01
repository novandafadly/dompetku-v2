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

## Status (2026-11-01)

- **M0a (prototipe data demo) selesai** di branch `claude/m0a-prototype`: Beranda, Catat, Transaksi, Dompet, onboarding, auth tiruan (Terima undangan → Buat akun → Amankan); arah visual Panel Malam dari handoff Claude Design (ADR 0006, laporan `docs/design/panel-malam/IMPLEMENTATION-REPORT.md`); e2e 215/215.
- Pratinjau: Vercel project `dompetku-v2` (Root `apps/web`, env `NEXT_PUBLIC_PROTOTYPE=1`, Vercel Authentication). Akses MCP Vercel agen hanya baca (buat/ubah project = 403). Browser sandbox tidak bisa membuka `*.vercel.app` kecuali pemilik menambahkannya di network setting.
- `main` berisi M0a, M0b S1–S4 dan M1 S5 (PR #2–#11): infra VM, deployer cosign, Postgres + backup, migrasi 0001–0010 (ruang, undangan, audit, Better Auth) dan 0100–0105 (ledger), pgTAP 600+ asersi di job CI `db`, auth sungguhan (ADR 0007, tes `test:int` + `e2e:auth` di job CI `auth`). Image `ghcr.io/novandafadly/dompetku-web` ditandatangani cosign berkunci tanpa Rekor (`docs/ops/ci-keamanan.md`).
- **Belum live untuk pengguna:** pemilik perlu mengikuti `docs/ops/auth.md` (Resend SPF/DKIM, `web.env`, `owner_email`, bootstrap akun). Halaman ruang masih menampilkan data demo sampai S6 menyambungkan UI ke ledger.

## Tertunda

1. **Penilaian M0a selesai:** lulus tanpa permintaan perubahan (ADR 0004).
2. **Konfirmasi pemilik:** Shareable Link untuk Farida disetujui; subdomain `dompet.novandafadly.com`; kedua VM `aarch64`, web + worker di VM DB (IPD §1). Rahasia diisi pemilik langsung di VM, tidak lewat chat. Favicon dibuat pemilik dari `docs/design/favicon-prompt.md`; pasang berkasnya saat dikirim. (Lime/violet, label kapital, teks handoff, dan arah visual Panel Malam sudah disetujui 2026-10-31.)
3. **Enam dokumen produk** di `docs/product/` (PRD, TRD, AFD, DBD, BSD, IPD) selesai dan sudah lewat satu putaran review tim (`docs/product/review/`); 18 keputusan pemilik disetujui (`review/keputusan-pemilik.md`). BSD **disetujui pemilik 2026-10-31** (§15 terjawab, periode gajian §8.2a) dan `bsd-check` lulus di PG 16 dan PG 17.11 (`docs/product/bsd-check/`); pindah ke pgTAP di CI M0b. Pertanyaan terbuka sisa: TRD §7.
4. **Peran designer:** tambah kursi "design reviewer" di setiap task UI, dan design critique pada pratinjau Panel Malam.
5. Budget JS tetap 162 kB rute (target 150 kB di M2 dibatalkan pemilik); Panel Malam memakai 160,9 kB.
6. **Berikutnya: S6** (Catat, kategori + saran, edit/void/undo, Sampah, `product_events`, "Tidak ada pengeluaran hari ini") di atas ledger S5, lalu S7 (transfer, talangan, worker minimal: pg-boss, `dq_reconcile` 01:00 WIB). Aturan M1: setiap page `[ruang]` memanggil `requireDataUser()` dan setiap kueri data lewat `withUser`.
7. **Ditunda kecil:** daftar event audit reserved wajib diperbarui saat event sistem baru ditambah (tes katalog sudah menjaga); tes `99_konkurensi` bisa meninggalkan `app.settings env='test'` di DB CI bila gagal di tengah; dbmate tanpa `--strict` (0009/0010 boleh terpasang setelah 0100+).
