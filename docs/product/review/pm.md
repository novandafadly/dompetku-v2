# Review kursi PM: PRD, IPD, AFD

Tanggal: 2026-10-31. Cakupan: `docs/product/{PRD,IPD,AFD}.md`. Pembanding: Spec induk (§9 mengikat), ADR, `docs/m0a-keputusan.md`, kode `apps/web/src/app`, BSD (untuk nama fungsi dan alur). Dokumen tidak diubah.

Format: `[tingkat] DOK §bagian: masalah. Usulan: perbaikan.`

Catatan keadaan terbaru (CLAUDE.md, 2026-10-31): e2e kini 215/215, lime/violet dan label kapital sudah dikonfirmasi pemilik, target JS 150 kB dibatalkan, favicon dibuat pemilik. Ketiga dokumen sudah selaras dengan ini kecuali yang tertulis di bawah.

## Ringkasan

| Tingkat | PRD | IPD | AFD | Total |
| ------- | --- | --- | --- | ----- |
| Kritis  | 0   | 2   | 0   | 2     |
| Penting | 7   | 6   | 7   | 20    |
| Minor   | 6   | 4   | 5   | 15    |

## PRD

- [Penting] PRD §6 (M1, M2): gerbang tidak memakai ID tes registry QA (`qa.md` Lampiran A: M1 = T1 sampai T5, T12, T13, T16, T18; M2 = T17). T12, T13, T16, T17 tidak muncul di gerbang mana pun di PRD maupun IPD, jadi bisa lolos tanpa dites. Usulan: tambah kolom "ID tes" per milestone yang mencakup seluruh T1 sampai T18 dan S1 sampai S7, dan periksa tiap ID punya milestone.
- [Penting] PRD §6 (M3 sampai M6): kriteria hanya merujuk "T6 sampai T10", "T11", "T14 dan T15" ke dokumen lain. PRD tidak bisa diuji berdiri sendiri. Usulan: tulis satu baris per tes (masukan, hasil yang diharapkan) atau kutip ringkas dari `qa.md`.
- [Penting] PRD §5: tidak ada kriteria terima per cerita. Butir seperti "saya yakin klik ganda tidak membuat entri ganda" tidak teruji sebagaimana tertulis. Usulan: tiap cerita punya 1 sampai 3 butir Given/When/Then atau tautan eksplisit ke baris uji di §6.
- [Penting] PRD §6 (M1, M2): "7 hari berturut-turut" tidak didefinisikan (cukup 1 entri per hari? tombol "Tidak ada pengeluaran hari ini" dihitung? hari WIB? boleh libur sehari?). IPD Pertanyaan terbuka 5 mengakui hal serupa. Usulan: definisikan sama dengan north star: tiap hari dari 7 hari berturut-turut berstatus "tercatat", dan `dq_reconcile` bernilai 0 tiap hari.
- [Penting] PRD §5 (M0b): gerbang M0b memuat audit log, rate limit dan lockout, reset password mencabut sesi, daftar perangkat dan cabut sesi (Spec §5.3), serta deployer pull-based dengan rollback, tetapi tidak ada ceritanya. Hanya "uji turunan" yang menyinggung sebagian. Usulan: tambah cerita (atau butir turunan) untuk audit log yang bisa dibaca pemilik, cabut sesi perangkat, reset kata sandi, dan deploy dengan rollback otomatis.
- [Penting] PRD §5: fitur Spec §9.4 tanpa cerita: tombol "Tidak ada pengeluaran hari ini" (M2 di IPD, padahal north star bergantung padanya), utang berjalan tanpa efek kas (M3), tagihan rutin lanjutan (M5), kategori dan menu Kategori. Usulan: tambah cerita dan petakan ke milestone; periksa seluruh baris §9.4 satu per satu.
- [Penting] PRD §7: "median waktu catat" dan "≥ 70% catatan ≤ 3 ketukan" tidak bisa diukur dengan skema `product_events` di BSD (`user_id, space_kind, event, at`): tidak ada id korelasi satu sesi Catat dan tidak ada jumlah ketukan. Usulan: tetapkan daftar event dan kolom (mis. `catat_dibuka`, `catat_disimpan` dengan `catat_id` dan `ketukan`, tanpa nominal), atau turunkan metrik ketukan menjadi uji Playwright saja dan hapus dari telemetri.
- [Minor] PRD §7 (north star): penyebut "persen hari tercatat" tidak jelas (mulai tanggal berapa, F sebelum bergabung, hari yang belum lewat, bulan tidak penuh). Usulan: tulis rumus dan jendela hitung (mis. 30 hari terakhir sejak akun aktif).
- [Minor] PRD §7 (RPO/RTO): cara ukur "uji restore mingguan" hanya membuktikan RTO dan keutuhan; RPO terbukti lewat latihan PITR bulanan. Usulan: pisahkan kolom cara ukur RPO dan RTO.
- [Minor] PRD §6 (M0a, M7): "dinilai" dan "pemilik menyetujui" tidak punya ambang atau daftar periksa; PRD §9.1 sudah mengakui untuk M0a. Usulan: daftar periksa persetujuan M7 (arsip v1 terverifikasi, screenshot ada, v1 mati) dan ambang M0a (lihat Keputusan pemilik).
- [Minor] PRD §3 butir 2 vs §7: tujuan "≤ 3 ketukan dari layar mana pun" bertabrakan dengan target "≥ 70% catatan ≤ 3 ketukan". Jalur "Kategori lain…" dan ganti dompet melebihi 3 ketukan. Usulan: tujuan = jalur tercepat tersedia ≤ 3 ketukan; metrik = proporsi catatan nyata.
- [Minor] PRD §5 (M0b): "72 jam" tidak ditemukan di Spec induk; angka ini berasal dari prototipe dan BSD. Usulan: catat sumbernya sebagai keputusan agen, atau konfirmasi pemilik.
- [Minor] PRD §9 butir 6: aturan faktor kuat tidak sama di tiga dokumen (PRD: pertanyaan terbuka; AFD §1: passkey, lalu TOTP, lalu pemulihan wajib semua; IPD S3: passkey, TOTP, pemulihan tanpa aturan wajib). Usulan: satu keputusan pemilik lalu samakan ketiganya.

## IPD

- [Kritis] IPD §3 (S3 dan S4): urutan terbalik. Auth (S3) membutuhkan `households`, `spaces`, `space_members` (BSD: `invitations.household_id` FK ke `households`, `api.accept_invitation` memanggil `private.provision_user` yang membuat ruang Pribadi dan keanggotaan, `tg_user_cap` menghitung anggota Bersama), padahal tabel itu baru dibuat di S4. Batas 2 user dan undangan tidak bisa dites di S3. Usulan: pindahkan tabel `households/spaces/space_members/invitations`, `app.my_space_ids()` dan `provision_user` ke S2 (migrasi dasar) atau awal S3.
- [Kritis] IPD §4 (S7) vs §5 (S10): `dq_reconcile` 01:00 WIB dijadwalkan di S7 dan gerbang M1 ("selisih rekonsiliasi 0") bergantung padanya, tetapi `apps/worker` dan pg-boss baru dibangun di S10. Tidak ada pelaksana job pada M1; `purge_voided`, `purge_idempotency`, dan `purge_audit` juga tertunda. Usulan: bangun kerangka worker minimal (pg-boss, `job_runs`, alert) di S5 atau S7, atau jadwalkan `jobs.dq_reconcile` lewat timer host di M1 dan pindahkan ke worker di S10.
- [Penting] IPD §3 (S3, S4): passkey (WebAuthn) butuh origin HTTPS tetap (rpID = domain) dan app terdeploy, sedangkan deployer baru di S4. Usulan: masukkan deploy minimal (manual terdokumentasi atau deployer versi awal) ke S3, atau tukar urutan sehingga deployer lebih dulu.
- [Penting] IPD §3 (S4) kriteria keluar: "isolasi ruang lulus pgTAP (dua user x semua tabel x semua operasi)" mustahil di S4 karena tabel ledger baru ada di S5. Gerbang M0b di Spec juga menulis "isolasi ruang lulus pgTAP". Usulan: batasi S4 pada tabel yang ada (ruang, undangan, `product_events`, audit), dan tambahkan "isolasi penuh semua tabel" sebagai kriteria S5 dan tiap sprint tabel baru.
- [Penting] IPD §5 (S9, S10): "aman dipakai" nyata (S9) memakai `api.safe_to_spend` yang menjumlah jadwal tagihan (`bill_schedule`), dan aturan satu kewajiban (`tg_obligation_xor`) melibatkan tagihan dan anggaran wajib. Tagihan rutin dasar baru di S10. Usulan: pindahkan `create_bill` dan UI tagihan dasar ke S9, atau pecah "aman dipakai" menjadi dua langkah dan nyatakan angka S9 belum memuat tagihan.
- [Penting] IPD §4 (S6, S7) vs §5 (S10): `product_events` baru di S7 dan tombol "Tidak ada pengeluaran hari ini" di S10 (sudah ada di M0a), padahal gerbang M1 dan north star "persen hari tercatat" memakai keduanya. Catat dibangun di S6 tanpa event. Usulan: pasang `product_events` dan tombol itu di S6, ukur mulai pemakaian pertama.
- [Penting] IPD §1 dan S5: BSD ditulis sebagai "celah terbesar, wajib sebelum M1", tetapi BSD draf sudah ada. Status sebenarnya: draf, belum direview backend dan security. BSD memuat role dan skema `auth` yang dibutuhkan S2 dan S3, bukan hanya S5. Selain itu BSD divalidasi di PostgreSQL 16.15 (BSD "Status validasi") sedangkan S2 memasang 17. Usulan: gerbang "BSD disetujui" sebelum S2; tambah tugas S2 menjalankan `bsd-check` di PG 17.
- [Penting] IPD §0, §2: penilaian M0a (ADR 0004) tidak punya posisi di urutan. Layar auth S3 mengikuti AFD dan bisa berubah karena umpan balik N dan F; S6 sudah bergantung ADR 0004 tetapi S3 tidak. Usulan: tambah gerbang "ADR 0004 terbit" sebelum S3 (layar auth) dan catat bila M0b infra (S1, S2) boleh jalan paralel.
- [Minor] IPD §4 (S7): kriteria keluar "Gerbang M1 terpenuhi" melingkar, karena gerbang itu 7 hari pakai setelah S7. Usulan: daftar kriteria S7 yang teruji (tes konkurensi, ID tes M1, `dq_reconcile` hijau, hari pertama pakai dimulai) dan pisahkan "periode pakai" sebagai langkah tersendiri.
- [Minor] IPD §5 (S9): "CLS < 0,05" berasal dari `frontend.md` R11, bukan Spec §9, dan TRD §NFR menulis Web Vitals Belum diputuskan. Dua dokumen bertentangan. Usulan: satu keputusan, hapus yang lain.
- [Minor] IPD §2: kolom "Perkiraan" dijumlah tidak pernah (±35 sampai 45 minggu kerja), dan S1 sampai S4 bergantung pada kecepatan pemilik menyediakan akses. Usulan: tambah kolom "menunggu pemilik" dan total rentang, tetap berlabel perkiraan.
- [Minor] IPD §6 (S18): foto struk terenkripsi butuh penyimpanan (bucket atau DB) dan kunci, belum ada di infra S1 sampai S4 maupun TRD. Usulan: catat keputusan penyimpanan lampiran sebagai prasyarat S18.

## AFD

- [Penting] AFD §4: menyebut `api.create_space_transfer`; di BSD hanya ada `api.create_transfer` yang menangani transfer satu ruang dan antar ruang. Cek "anggota kedua ruang" di BSD menghasilkan `DK404` (bukan anggota disamakan dengan tidak ada), sedangkan `space_mismatch` adalah ketidakcocokan `p_space_id` dengan ruang akun; `cross_space_not_allowed` dan `cross_space_kantor` tidak ada di AFD. Usulan: ganti nama fungsi dan kode galat sesuai BSD.
- [Penting] AFD §1 dan §6 vs BSD §Undangan: `api.accept_invitation` menandai token terpakai saat akun dibuat, sebelum faktor kuat aktif, sedangkan AFD §6 menulis "token hangus" setelah akun diamankan. Bila Farida berhenti setelah `/buat-akun`, undangan sudah terpakai, user kedua sudah dihitung (batas 2), Novanda tidak bisa mengundang ulang, dan jalur Farida melanjutkan tidak digambar. Usulan: gambarkan jalur "lanjutkan mengamankan" (login password lalu sesi `pending_2fa` diarahkan ke `/amankan`) dan tambahkan ke BSD/TRD.
- [Penting] AFD §1: cabang "Tolak" menulis "Token dicabut", tetapi tidak ada fungsi BSD untuk itu (`api.revoke_invitation` hanya untuk pembuat yang login). Di prototipe "Tolak" hanya menuju `/masuk`. Usulan: tambah `api.decline_invitation(token_hash)` di BSD, atau ubah AFD: Tolak hanya meninggalkan halaman dan token berlaku sampai 72 jam atau dicabut Novanda.
- [Penting] AFD §6: "perilaku bila email Farida diketik salah" Belum diputuskan, padahal BSD sudah menolak undangan baru selagi ada undangan terbuka (`invitations_one_open`), dan tidak ada layar untuk melihat atau mencabut undangan. Novanda bisa terkunci sampai 72 jam. Usulan: tambah alur "Undangan tertunda" (lihat status, Cabut, Kirim ulang) dan layar pendukung.
- [Penting] AFD §2 vs kode M0a: di prototipe, `/masuk` dengan email dan kata sandi langsung ke `/amankan` (layar pendaftaran faktor), bukan verifikasi TOTP seperti diagram. AFD tidak mencatat selisih ini, dan kasus "login dengan akun yang belum punya faktor kuat" tidak digambar. Usulan: tambah catatan prototipe dan cabang `pending_2fa` tanpa faktor menuju `/amankan`.
- [Penting] AFD §5: teks dialog di kode ("dari Sampah") menjanjikan layar Sampah, tetapi layar itu tidak ada dan BSD tidak punya fungsi baca entri void untuk daftar Sampah (hanya `void_entry`, `restore_entry`, `jobs.purge_voided`). Usulan: putuskan Sampah ada di M1 (tambah fungsi baca dan layar, lihat desain) atau ubah teks sampai Sampah ada.
- [Penting] AFD cakupan: alur wajib M1 yang belum digambar: Tambah dompet dan Cocokkan saldo (`api.reconcile_balance`), edit transaksi dengan konflik versi `DK409` (dua pengguna di Bersama), talangan dan reimburse, "Pindahkan ke ruang lain" (`move_entry_to_space` belum ditulis di BSD), tombol "Tidak ada pengeluaran hari ini". Usulan: tambah diagram untuk tiap alur atau tandai sebagai tertunda eksplisit.
- [Minor] AFD pembuka: daftar rute prototipe tidak memuat `/[ruang]/transaksi/[id]`, `/[ruang]/dompet/[id]`, `/dev/ui`, dan `/` yang mengalihkan ke `/pribadi/beranda`. Usulan: lengkapi.
- [Minor] AFD §3: jalur "Kategori lain…" atau mengganti dompet melebihi 3 ketukan, dan pintasan `c` mengurangi satu; aturan hitung ketukan belum tertulis. Usulan: tulis aturan hitung (mana dihitung, mana tidak) agar sejalan dengan metrik.
- [Minor] AFD §3: kode galat tampil ke pengguna belum lengkap; `before_opening` (tanggal sebelum dompet dibuka, mudah terjadi dengan pemilih tanggal 13 hari ke belakang), `account_archived`, `DK409` tidak ada. Usulan: tambah ke daftar galat dan jalur pemulihan.
- [Minor] AFD §5: aturan purge melewati entri yang dirujuk `reimburses_entry_id` dan memurge pasangan `space_transfer` berdua (BSD §10) belum tertulis. Usulan: tambah satu kalimat.
- [Minor] AFD §1: panjang kata sandi 12 sudah ditandai "dapat berubah"; kebijakan akhir ada di BSD/M0b, tetapi AFD tidak menyebut penolakan kata sandi bocor atau lemah. Usulan: ikuti kebijakan Better Auth setelah ditetapkan.

## Keputusan pemilik

1. Aturan faktor kuat: passkey saja, atau password plus TOTP, atau passkey plus TOTP wajib keduanya (PRD §9.6, AFD §1, IPD S3).
2. Definisi "7 hari berturut-turut" untuk gerbang M1 dan M2 (entri per hari, tombol "Tidak ada pengeluaran", hari WIB).
3. Ambang lulus penilaian M0a dan daftar periksa persetujuan M7.
4. Setujui perubahan urutan IPD: tabel ruang dan undangan lebih awal (S3), worker minimal atau timer sebelum S7, tagihan dasar di S9, `product_events` dan tombol "Tidak ada pengeluaran" di S6.
5. Layar Sampah: dibangun di M1, atau teks dialog diubah sampai ada.
6. Alur undangan: perilaku "Tolak", email salah (cabut dan kirim ulang), dan nasib akun setengah jadi bila Farida berhenti sebelum mengamankan.
7. Telemetri ketukan dan waktu catat: tambah event dan kolom di `product_events`, atau ukur lewat uji otomatis saja.
8. Target Web Vitals (CLS < 0,05): dipakai atau dibuang.
9. Pendaftaran pemilik pertama, "lupa kata sandi", dan penyedia email (dibutuhkan S3).
10. Urutan penilaian M0a terhadap M0b: infra jalan paralel, tetapi layar auth menunggu ADR 0004?
