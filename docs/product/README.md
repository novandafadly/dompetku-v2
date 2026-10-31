# Dokumen produk DompetKu v2

Revisi 2026-10-31 setelah satu putaran review tim (PM, backend, security, designer; temuan di `review/`) dan 18 keputusan pemilik (`review/keputusan-pemilik.md`, semua rekomendasi disetujui). Menunggu persetujuan pemilik atas dokumennya. Spec induk `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (§9) tetap mengikat.

| Dokumen       | Isi                                                                                                    | Status            |
| ------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| [PRD](PRD.md) | Masalah, pengguna, tujuan, cerita pengguna dan kriteria terima M0 sampai M8, metrik (target)           | revisi review     |
| [TRD](TRD.md) | Arsitektur dan syarat nonfungsional: performa, backup/RPO, keamanan                                    | ditulis agen lain |
| [AFD](AFD.md) | Diagram alur Mermaid: onboarding, masuk, Catat, transfer antar ruang, batalkan/urungkan, undang Farida | revisi review     |
| [DBD](DBD.md) | Cetak biru desain Panel Malam: token, tipografi, komponen, layout, aksesibilitas, budget JS            | revisi review     |
| [BSD](BSD.md) | DDL lengkap: tabel, constraint, fungsi, RLS, role                                                      | ditulis agen lain |
| [IPD](IPD.md) | Rencana implementasi M0b sampai M8 per sprint, dependensi, risiko                                      | revisi review     |

Ringkasan keputusan pemilik yang tercermin: faktor kuat wajib (passkey ATAU kata sandi + TOTP, kode pemulihan semua akun), undangan lewat email dengan tolak/cabut/kirim ulang dan terpakai setelah akun diamankan, sesi idle 7 hari/absolut 30 hari, Resend, layar Sampah di M1, urutan sprint baru, definisi "7 hari berturut-turut", ambang M0a, Web Vitals LCP < 2,5 s / INP < 200 ms / CLS < 0,1, dan proses utang desain.

Dokumen lama yang sebagian digantikan ditandai di barisan paling atasnya: `docs/spec/ui-ux.md`, `docs/spec/design.md`, `docs/spec/frontend.md`.
