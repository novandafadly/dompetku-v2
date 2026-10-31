# Berkontribusi

- Kerja di branch, buka PR ke `main`; CI (`check`, `e2e`, `security`) harus hijau.
- Commit mengikuti Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Tes dulu: tulis tes yang gagal, lalu implementasi.
- Jangan commit secret. `.env.example` tanpa nilai.
- Actions GitHub dipatok SHA penuh dengan komentar versi.
- Format uang/tanggal hanya lewat `@dompetku/domain`; jangan pakai `date-fns`, `moment`, atau `Intl.DateTimeFormat` di luar `packages/domain/src/date.ts`.
- `radix-ui` hanya diimpor dari `apps/web/src/components/ui`.
- Warna dan ukuran dari token desain; nilai arbitrer ditolak lint.
