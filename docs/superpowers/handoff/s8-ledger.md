# SDD ledger — plan: docs/superpowers/plans/2026-11-04-dompetku-v2-s8-bersama.md

Spec: IPD §5 S8 + PRD/AFD/BSD (lihat header plan). Konteks subagent: docs/superpowers/handoff/s8-konteks-subagent.md. Baseline: main 7bc4533 (S7 #15, dompetku-psql #16, subnet worker_db #17, Menu Keluar #18, plan S8 #19); pgTAP 966.

## Keputusan pemilik (2026-11-04)
- K1–K6 disetujui sesuai rekomendasi plan (K1 tanpa nama dompet di feed; K2 Setor utama + Diambil sekunder, tanpa persentase/peringkat; K3 bulan kalender WIB; K4 kategori "Kontribusi Farida" tidak dihitung; K5 halaman Aktivitas ringan; K6 undang sesudah S8 live).
- Prasyarat P1–P4 menurut pemilik sudah terpenuhi; Farida sudah pernah daftar dan login di produksi (Bersama produksi sudah dua anggota, B1 tidak tampil di produksi).
- Pemilik: kerjakan task satu per satu.

## Progress
Ruling R1: PR #18 (item Keluar di Menu, `features/shell/menu-sheet.tsx`) menambah JS shell; setiap task UI S8 mengukur ulang budget prototipe Beranda dari main sesudah #18 sebelum menambah apa pun — biaya: tidak ada.
Task 1: implementasi commit 9ced62c (bingkai S8-A1..D1a, 11 konflik + 9 keputusan agen tercatat di bingkai).
Task 1: review desain + task → Needs fixes (5 Important: tanggal mundur ambigu, baris href null, cabang empty/!hasOperasional dua anggota, fallback per op, budget muat malas harus melapor js-all-kB + selector demo bukan lewat barrel). Minor #6–#15 ikut ronde 1.
Ruling R2: label Kontribusi tetap `Setor`/`Diambil` sesuai K2 yang disetujui pemilik (usul `Disetor` dicatat untuk critique Task 12) — biaya: tidak paralel secara tata bahasa.
Ruling R3: konflik bingkai 1–10 diterima sesuai rekomendasi bingkai (reviewer setuju); `Semua` menggantikan `Lihat semua`; S8-B1a menunggu pemilik, bawaan tetap salinan S7 sampai dijawab — biaya: tidak ada.
