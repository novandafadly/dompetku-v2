# Kritik Visual Delivery Gate S18 — Analisis AI, Foto Struk, & Banner Offline PWA

Pemeriksaan dilakukan pada mode nyata di 3 lebar (`320`, `390`, `1280`) dan 2 tema (`dark`, `light`) untuk:

1. `/pribadi/analisis` (Ringkasan SQL, Pos pengeluaran terbesar, kartu Ringkasan AI & kuota)
2. `/pribadi/transaksi/[id]` (Seksi Foto struk terenkripsi dengan 1 lampiran)
3. `/pribadi/beranda` (Banner status offline PWA `Sedang offline · Mode baca saja`)

## Temuan & Perbaikan

| No  | Keparahan | Layar / Lebar                             | Temuan                                                                                                                                                                                | Perbaikan                                                                                                                                                                                                                                                                                                       |
| --- | --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Penting   | Beranda offline / `1280` (terang & gelap) | `<PwaBridge />` awalnya dirender di luar `<RuangShell>` dengan `sticky top-0`, sehingga menimpa bagian atas wordmark `DompetKu` di bilah samping kiri desktop (`fixed left-0 top-0`). | `<PwaBridge />` dipindahkan ke dalam area konten utama (`children` pertama `<RuangShell>`) sebagai banner kartu tenang (`rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 laptop:max-w-180`). Diverifikasi ulang pada `1280` terang & `390` gelap: 0 tumpang tindih dengan sidebar maupun bilah atas. |

## Pemeriksaan Kriteria Panel Malam & Antislop

- **320 px tanpa gulir horizontal:** Lolos pada Analisis AI, Detail transaksi + Foto struk, dan Beranda offline. Nama kategori panjang terpotong rapi dengan `truncate`, angka `MoneyText` tetap sejajar tabular.
- **Hierarki & kontras gelap/terang:** Kartu `heroCard` & `card` memakai token `surface`/`surface-2`/`border`/`hairline`, kontras teks utama & nominal terjaga baik di tema gelap maupun terang.
- **Target sentuh >= 44 px:** Pemilih periode (`min-h-11`), tombol `Tambah foto struk`, tombol hapus struk (`size-11`), tautan `Struk 1` (`min-h-11`), dan tombol `Buat analisis AI` (`size="lg"`) semuanya >= 44 px.
- **Antislop:** 0 `Rp 0`, 0 tanda seru, 0 emoji, 0 istilah Inggris keuangan terlarang, 0 frasa `"rumah tangga"`.

**Keputusan Delivery Gate:** **LOLOS** (0 Blocker, 0 Penting tersisa).
