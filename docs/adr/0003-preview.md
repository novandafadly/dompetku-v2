# ADR 0003: Tempat pratinjau M0a

Status: diusulkan, menunggu konfirmasi pemilik (2026-10-30)

## Konteks

Novanda dan Farida perlu mencoba prototipe M0a di HP masing-masing sebelum M0b dimulai. Produksi nanti self-hosted di OCI (M0b), jadi M0a hanya butuh tempat pratinjau sementara.

Repo ini privat. Prototipe berjalan di atas data demo fiktif, tanpa secret dan tanpa DB.

## Keputusan

Pratinjau memakai Vercel Preview dari repo privat lewat integrasi Git Vercel.

- Proyek Vercel `dompetku-v2`, terpisah dari proyek v1.
- Root Directory `apps/web`.
- Variabel lingkungan `NEXT_PUBLIC_PROTOTYPE=1`.
- Deployment Protection: Vercel Authentication tetap menyala. Tanpa login Vercel, pratinjau tidak bisa dibuka.
- Setiap push ke branch menghasilkan deploy pratinjau sendiri. Tidak ada workflow GitHub Actions untuk ini.

### Akses Farida

Paket Hobby tidak punya anggota tim atau viewer, jadi Farida tidak bisa lolos Vercel Authentication. Pilihan akses:

1. Utama: Shareable Link (tautan bypass proteksi deployment). Novanda membuatnya per deployment dari Vercel (Share), lalu mengirimkannya ke Farida. Farida cukup membuka tautan itu di HP, tanpa akun Vercel. Setelah M0a selesai, Novanda mencabut tautannya.
2. Alternatif: tim Vercel Pro dengan Farida sebagai anggota (viewer). Berbayar; dipakai kalau tautan per deployment terlalu merepotkan.

Pilihan 1 menjadi asumsi sampai pemilik mengonfirmasi (menunggu konfirmasi pemilik). Tautan bypass berlaku seperti kata sandi: siapa pun yang memegangnya bisa membuka pratinjau, jadi jangan diposting di tempat umum.

Produksi tidak berubah: tetap self-hosted di OCI pada M0b.

## Risiko dan mitigasi

- Tautan pratinjau bocor: tanpa Shareable Link, Vercel Authentication menolak semua orang selain Novanda. Shareable Link dibuat per deployment dan dicabut setelah M0a. Isinya pun hanya data fiktif.
- Seseorang mengira ini produksi: data di memori, kembali ke awal saat halaman dimuat ulang, dan tidak ada DB.
- Secret terbawa ke Vercel: tidak ada secret di proyek ini. Jangan menambahkan variabel selain `NEXT_PUBLIC_PROTOTYPE`.
- Batas paket gratis: cukup untuk dua penilai. Kalau terlampaui, pratinjau berhenti sementara dan tidak memengaruhi apa pun di repo.
- Ketergantungan pada layanan pihak ketiga: hanya untuk M0a. Tidak ada kode yang bergantung pada Vercel.

## Cara membongkar setelah M0a

1. Pastikan penilaian selesai dan ADR 0004 (hasil penilaian M0a) sudah ditulis.
2. Di Vercel, buka proyek `dompetku-v2`, Settings, Advanced, Delete Project.
3. Di GitHub, cabut akses aplikasi Vercel ke repo ini (Settings, Applications) kalau tidak dipakai lagi.
4. Cabut semua Shareable Link. Kalau memakai tim Pro, hapus Farida dari tim bila timnya tidak dipakai untuk hal lain.
