# ADR 0004: Hasil penilaian M0a

- Status: Diterima
- Tanggal: 2026-10-31

## Konteks

M0a (prototipe data demo, arah visual Panel Malam) dinilai pemilik dan Farida dengan formulir `docs/review/m0a-penilaian.md`. Ambang lulus (keputusan pemilik #13, PRD §6.1): tidak ada butir "tidak bisa dipakai"; butir lain menjadi issue berlabel `m0a-feedback`.

## Keputusan

- Pemilik menyatakan penilaian M0a **oke** (2026-10-31): tidak ada butir "tidak bisa dipakai" dan tidak ada perubahan yang diminta. M0a lulus.
- Formulir tidak diisi per tugas; tidak ada issue `m0a-feedback` yang dibuat.
- Alur layar auth M0a (Masuk, Undang, Terima undangan → Buat akun → Amankan) dipakai sebagai dasar layar auth sungguhan S4, mengikuti AFD dan BSD. Keadaan yang belum punya bingkai (galat auth, undangan tidak berlaku, tautan terkirim) dirancang mengikuti pola Panel Malam dan dinilai pemilik di pratinjau (keputusan pemilik #18).

## Akibat

- Gerbang S4 "ADR 0004 terbit" terpenuhi; S4 boleh mulai setelah bingkai auth tersedia.
- Skor per tugas tidak tersedia, jadi metrik dasar PRD (misalnya ketukan Catat) diukur dari `product_events` setelah M1, bukan dari penilaian ini.
