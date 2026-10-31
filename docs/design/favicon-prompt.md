# Prompt favicon DompetKu

Tempel teks di bawah garis ke Claude Code atau Gemini. Hasilnya taruh di `apps/web/src/app/` (nama berkas sesuai daftar), atau kirim ke agen untuk dipasang.

---

Buatkan ikon aplikasi (favicon + ikon PWA) untuk **DompetKu**, aplikasi pencatat keuangan pribadi dan bersama untuk dua orang (pasangan). Antarmukanya bahasa Indonesia, gelap secara bawaan, gaya "Panel Malam": tenang, padat, modern, tidak ramai.

**Warna (wajib dari palet ini):**

- Latar gelap `#0F1211`, permukaan `#1A1F1D`
- Aksen utama lime `#C4EE6A` (warna ruang Pribadi)
- Aksen kedua violet `#B6A3FF` (warna ruang Bersama), opsional
- Teks terang `#EDF1EE`

**Bentuk:**

- Satu simbol sederhana yang tetap terbaca di 16×16 px. Boleh huruf "D" atau "DK", bentuk dompet, atau gabungan keduanya. Kamu yang pilih; beri 3 opsi dulu, masing-masing dengan alasan satu kalimat.
- Garis tebal, sudut membulat lembut, tanpa gradasi, tanpa bayangan, tanpa teks kecil, tanpa simbol mata uang ($, Rp), tanpa koin atau grafik naik yang klise.
- Kontras simbol dengan latar minimal 3:1, dan tetap jelas di tab browser terang maupun gelap.

**Berkas yang diminta (setelah satu opsi dipilih):**

1. `icon.svg`: SVG bersih (viewBox 0 0 32 32), tanpa font eksternal, tanpa elemen tersembunyi.
2. `favicon.ico`: berisi 16×16 dan 32×32.
3. `apple-icon.png`: 180×180, latar penuh `#0F1211` (tanpa transparansi), simbol di area aman tengah.
4. `icon-192.png` dan `icon-512.png`: untuk PWA.
5. `icon-maskable-512.png`: simbol di dalam lingkaran aman 80% di tengah, latar penuh.

Sertakan juga potongan SVG sumbernya supaya bisa diubah nanti.
