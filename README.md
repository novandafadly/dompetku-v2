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

## Struktur

- `apps/web` Next.js (App Router)
- `packages/domain` logika murni (uang, tanggal, tipe)
- `docs/spec` spesifikasi; `docs/adr` keputusan arsitektur

Lihat `CONTRIBUTING.md` untuk alur kerja.
