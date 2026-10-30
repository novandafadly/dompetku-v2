# ADR 0003: Tempat pratinjau M0a

Status: diterima (2026-10-30)

## Konteks

Novanda dan Farida perlu mencoba prototipe M0a di HP masing-masing sebelum M0b dimulai. Produksi nanti self-hosted di OCI (M0b), jadi M0a hanya butuh tempat pratinjau sementara.

Repo ini privat. Prototipe berjalan di atas data demo fiktif, tanpa secret dan tanpa DB.

## Keputusan

Pratinjau memakai Vercel Preview dari repo privat lewat integrasi Git Vercel.

- Proyek Vercel `dompetku-v2`, terpisah dari proyek v1.
- Root Directory `apps/web`.
- Variabel lingkungan `NEXT_PUBLIC_PROTOTYPE=1`.
- Deployment Protection: Vercel Authentication. Hanya akun Vercel yang masuk tim yang bisa membuka tautan.
- Setiap push ke branch menghasilkan deploy pratinjau sendiri. Tidak ada workflow GitHub Actions untuk ini.

Paket gratis tidak punya proteksi kata sandi. Karena itu Novanda dan Farida masing-masing butuh akun Vercel, dengan Farida sebagai anggota tim (atau viewer) pada proyek ini.

Produksi tidak berubah: tetap self-hosted di OCI pada M0b.

## Risiko dan mitigasi

- Tautan pratinjau bocor: Vercel Authentication menolak orang di luar tim. Isinya pun hanya data fiktif.
- Seseorang mengira ini produksi: data di memori, kembali ke awal saat halaman dimuat ulang, dan tidak ada DB.
- Secret terbawa ke Vercel: tidak ada secret di proyek ini. Jangan menambahkan variabel selain `NEXT_PUBLIC_PROTOTYPE`.
- Batas paket gratis: cukup untuk dua penilai. Kalau terlampaui, pratinjau berhenti sementara dan tidak memengaruhi apa pun di repo.
- Ketergantungan pada layanan pihak ketiga: hanya untuk M0a. Tidak ada kode yang bergantung pada Vercel.

## Cara membongkar setelah M0a

1. Pastikan penilaian selesai dan ADR 0004 (hasil penilaian M0a) sudah ditulis.
2. Di Vercel, buka proyek `dompetku-v2`, Settings, Advanced, Delete Project.
3. Di GitHub, cabut akses aplikasi Vercel ke repo ini (Settings, Applications) kalau tidak dipakai lagi.
4. Hapus Farida dari tim Vercel bila timnya tidak dipakai untuk hal lain.
