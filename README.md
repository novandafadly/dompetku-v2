# DompetKu v2

Aplikasi keuangan pribadi untuk dua orang (ruang Pribadi + Bersama), self-hosted.

Tahap M0a: fondasi dan prototipe klik di atas data demo; belum ada DB atau auth.

- Desain: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md`
- Rencana M0a: `docs/superpowers/plans/2026-10-30-dompetku-v2-m0a-prototype.md`

## Prasyarat

- Node 24 LTS (`.nvmrc`; lokal minimal 22.12)
- pnpm 10 (`corepack enable`)

## Perintah

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e            # butuh `pnpm build` lebih dulu
pnpm --filter @dompetku/web dev
```

## Pratinjau

Prototipe M0a bisa dijalankan lokal dengan data demo (tanpa DB):

```sh
pnpm install
NEXT_PUBLIC_PROTOTYPE=1 pnpm build
NEXT_PUBLIC_PROTOTYPE=1 pnpm --filter @dompetku/web start
```

Buka `http://localhost:3000`. `NEXT_PUBLIC_PROTOTYPE` dibaca saat build, jadi setel di kedua perintah.

Pratinjau daring lewat Vercel dijelaskan di `docs/adr/0003-preview.md`. Formulir penilaian ada di `docs/review/m0a-penilaian.md`.

## Struktur

- `apps/web` Next.js (App Router)
- `packages/domain` logika murni (uang, tanggal, tipe)
- `docs/spec` spesifikasi; `docs/adr` keputusan arsitektur

Lihat `CONTRIBUTING.md` untuk alur kerja.
