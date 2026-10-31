# DompetKu v2: panduan sesi

Aplikasi keuangan pribadi + bersama untuk Novanda dan Farida. Repo private, juga bahan portofolio (screenshot saja).

## Aturan kerja

- Kerja di branch `claude/m0a-prototype` (atau branch fitur baru). Jangan push ke `main`, jangan buat/merge PR tanpa persetujuan pemilik.
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
- ADR: `docs/adr/` (0001 stack, 0002 budget JS 162 kB, 0003 pratinjau Vercel, 0005 gelap premium (digantikan), 0006 Panel Malam; 0004 dicadangkan untuk hasil penilaian M0a).
- Keputusan yang diambil agen atas nama pemilik selama M0a: `docs/m0a-keputusan.md`.
- Tim produk (riset awal): `docs/team/`.

## Status (2026-10-31)

- **M0a (prototipe data demo) selesai** di branch `claude/m0a-prototype`: Beranda, Catat, Transaksi, Dompet, onboarding, auth tiruan (Terima undangan → Buat akun → Amankan); arah visual Panel Malam dari handoff Claude Design (ADR 0006, laporan `docs/design/panel-malam/IMPLEMENTATION-REPORT.md`); e2e 215/215.
- Pratinjau: Vercel project `dompetku-v2` (Root `apps/web`, env `NEXT_PUBLIC_PROTOTYPE=1`, Vercel Authentication). Akses MCP Vercel agen hanya baca (buat/ubah project = 403). Browser sandbox tidak bisa membuka `*.vercel.app` kecuali pemilik menambahkannya di network setting.
- Belum ada PR ke `main`.

## Tertunda

1. **Penilaian M0a** oleh pemilik dan Farida (`docs/review/m0a-penilaian.md`), lalu ADR 0004 + issue berlabel `m0a-feedback`.
2. **Konfirmasi pemilik:** akses Farida via Shareable Link (ADR 0003). Favicon dibuat pemilik dari `docs/design/favicon-prompt.md`; pasang berkasnya saat dikirim. (Lime/violet, label kapital, teks handoff, dan arah visual Panel Malam sudah disetujui 2026-10-31.)
3. **Enam dokumen produk** di `docs/product/`, disusun dari bahan yang ada (bukan dari nol), dokumen lama ditandai "digantikan oleh":
   - PRD (user story, kriteria terima per milestone, metrik)
   - TRD (arsitektur, NFR: performa, backup/RPO, keamanan)
   - AFD (diagram alur Mermaid: onboarding, Catat, transfer antar ruang, batalkan/urungkan, undang Farida)
   - DBD (dari `DESIGN.md` + ADR 0006 + handoff Panel Malam)
   - BSD (DDL lengkap: tabel, constraint, fungsi, RLS, roles; celah terbesar, wajib sebelum M1)
   - IPD (M0b–M8 per sprint, dependensi, risiko)
     Lalu satu putaran review tim (PM, backend, security, designer) sebelum disetujui pemilik. Pemilik mungkin menambah plugin (dev-workflow-plugin, designer-skills); cek skill yang tersedia di awal sesi.
4. **Peran designer:** tambah kursi "design reviewer" di setiap task UI, dan design critique pada pratinjau Panel Malam.
5. Budget JS tetap 162 kB rute (target 150 kB di M2 dibatalkan pemilik); Panel Malam memakai 160,9 kB.
6. Berikutnya: M0b (infra OCI, auth, backup) lalu M1 (ledger inti).
