# ADR 0001: Stack dan keputusan M0a

Status: diterima (2026-10-30)

## Keputusan

1. Monorepo pnpm 10 (`apps/*`, `packages/*`), tanpa Turborepo.
2. M0a tanpa DB dan tanpa auth: semua data dari data demo deterministik lewat store klien in-memory. DB, auth, worker dibuat di M0b.
3. Build Next.js `output: 'standalone'`, `typedRoutes`, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
4. Versi dikunci lewat `pnpm-lock.yaml`; pnpm menolak rilis berumur kurang dari 3 hari (`minimumReleaseAge: 4320`).

## Versi terpasang

| Paket                                                | Versi                                         | Alasan singkat                                                                               |
| ---------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Node.js (CI, `.nvmrc`)                               | 24 LTS (`engines`: >=22.12)                   | LTS aktif; multi-arch                                                                        |
| pnpm                                                 | 10.28.0                                       | Dependensi ketat, cache CI cepat                                                             |
| next                                                 | 16.4.3                                        | `proxy.ts`, Turbopack, `useOptimistic`/`useActionState` stabil                               |
| react / react-dom                                    | 19.3.1                                        | Dipasang versi stabil terbaru (rencana menyebut 19.2)                                        |
| typescript                                           | 5.9.3                                         | `typescript-eslint` 8 mendukung <6.1; TS 7 belum didukung                                    |
| tailwindcss / @tailwindcss/postcss                   | 4.3.3                                         | Token sebagai CSS variable lewat `@theme`; palet bawaan bisa dimatikan                       |
| eslint / @eslint/js                                  | 9.39.5                                        | `eslint-plugin-jsx-a11y` 6.10 baru mendukung ESLint sampai 9                                 |
| typescript-eslint                                    | 8.72.1                                        | Preset `strictTypeChecked`                                                                   |
| eslint-config-next                                   | 16.4.3                                        | Aturan Next + react-hooks                                                                    |
| eslint-plugin-jsx-a11y                               | 6.10.2                                        | Aksesibilitas JSX                                                                            |
| eslint-plugin-better-tailwindcss                     | 4.10.0                                        | Menegakkan token: kelas tak dikenal, konflik, nilai arbitrer                                 |
| eslint-plugin-boundaries                             | 5.4.0                                         | Batas impor `features/*` dan `components/ui`                                                 |
| eslint-import-resolver-typescript                    | 4.4.5                                         | Resolver agar boundaries mengenali impor alias `@/`                                          |
| prettier                                             | 3.9.10                                        | Format                                                                                       |
| vitest                                               | 5.0.5                                         | Tes unit; satu runner untuk semua workspace                                                  |
| @playwright/test                                     | 1.64.1                                        | E2E; image CI `mcr.microsoft.com/playwright:v1.64.1-noble`                                   |
| @types/node                                          | 24.19.2                                       | Sejalan Node 24                                                                              |
| @radix-ui/react-\*                                   | dialog 1.3.1, toast 1.3.1, alert-dialog 1.2.1 | Primitif aksesibel; hanya diimpor dari `components/ui`; paket per komponen, bukan `radix-ui` |
| cmdk                                                 | 1.1.1                                         | Daftar kategori yang bisa dicari (combobox)                                                  |
| @phosphor-icons/react                                | 2.1.10                                        | Ikon; menggantikan `lucide-react` dari tabel R0                                              |
| @testing-library/react (+ dom, jest-dom, user-event) | 16.3.3                                        | Tes komponen                                                                                 |
| happy-dom                                            | 21.0.4                                        | Lingkungan DOM vitest; bukan jsdom, karena `engines` jsdom 30 menolak Node 22.22             |
| fast-check                                           | 4.10.2                                        | Tes properti di `packages/domain`                                                            |
| @axe-core/playwright                                 | 4.14.0                                        | Audit aksesibilitas di E2E                                                                   |

Belum dipasang (M0b): `zod`, `react-hook-form`.

## Catatan

- Rencana menyebut aturan `no-unregistered-classes`; di plugin versi 4.10 aturan itu bernama `no-unknown-classes`. Larangan nilai arbitrer memakai `no-restricted-classes`.
- Tabel R0 `frontend.md` menyebut `lucide-react`; rencana M0a memutuskan Phosphor. Rencana yang berlaku.
- Font bukan bagian scaffold; ditambahkan di task desain.

## Konsekuensi

Tanpa DB/auth, prototipe tidak menyimpan apa pun lintas muat ulang. Itu disengaja: M0a menilai bentuk dan alur, bukan persistensi.
