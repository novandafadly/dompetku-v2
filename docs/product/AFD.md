# AFD: diagram alur aplikasi DompetKu v2

Status: draf revisi setelah review tim dan 18 keputusan pemilik (`review/keputusan-pemilik.md`). Tanggal: 2026-10-31.
Sumber: Spec §5.3, §5.4, §9.1 sampai §9.3; `docs/design/panel-malam/README.md` (layar A1 sampai A4, C1 sampai C5, D1 sampai D4); kode M0a di `apps/web/src/app/` dan `apps/web/src/features/`. Alur auth di M0a adalah tiruan; langkah server dan kode galat di bawah adalah rencana M0b/M1 (rinci di BSD dan TRD).

Rute prototipe: `/` (mengalihkan ke `/pribadi/beranda`), `/masuk`, `/undang`, `/terima-undangan`, `/buat-akun`, `/amankan`, `/[ruang]/{beranda,transaksi,dompet,rencana}`, `/[ruang]/transaksi/[id]`, `/[ruang]/dompet/[id]`, dan `/dev/ui` (galeri keadaan, hanya dev), dengan `[ruang]` = `pribadi` atau `bersama`.

Nama fungsi mengikuti `BSD.md` (skema `api.*`). Fungsi undangan dan Sampah: `api.decline_invitation`, `api.revoke_invitation`, `api.resend_invitation`, `api.trash_list`, `api.restore_entry`, `api.purge_entry`.

**Selisih prototipe M0a dan rencana.** Di prototipe, `/masuk` dengan email dan kata sandi langsung menuju `/amankan` (pendaftaran faktor), bukan verifikasi TOTP; semua langkah auth tiruan. Diagram di bawah adalah rencana M0b.

## 0. Aturan lintas alur

- **Faktor kuat wajib (satu aturan, sama di PRD, AFD, IPD):** passkey ATAU kata sandi + TOTP. Kode pemulihan dibuat untuk semua akun, termasuk yang hanya punya passkey. Sesi `pending_2fa` (belum punya faktor kuat aktif atau belum login dengan faktor kedua) hanya boleh membuka `/amankan` atau layar verifikasi, tidak halaman data.
- **Sesi:** idle 7 hari, absolut 30 hari. Gagal login memberi jeda bertahap, tanpa kunci permanen.
- **Penyedia email:** Resend (undangan, lupa kata sandi, alert).

## 1. Onboarding Farida (undangan sampai Beranda)

```mermaid
flowchart TD
  A["Tautan undangan di email dibuka"] --> B{"Token valid: belum terpakai, tidak dicabut, tidak ditolak, < 72 jam?"}
  B -- "tidak" --> B1["Halaman galat seragam: undangan tidak berlaku, minta Novanda kirim ulang"]
  B -- "ya" --> C["/terima-undangan: lihat apa yang terlihat dan tidak terlihat (api.invitation_peek)"]
  C -- "Tolak" --> C1["`api.decline_invitation`: undangan hangus, selesai. Novanda melihat status Ditolak dan bisa kirim ulang"]
  C -- "Terima undangan" --> D["/buat-akun: email dari token, kata sandi baru"]
  D --> D1{"Kata sandi lolos kebijakan?"}
  D1 -- "tidak" --> D2["Galat inline, fokus ke kolom"]
  D2 --> D
  D1 -- "ya" --> E["Akun dibuat, sesi pending_2fa. Undangan BELUM terpakai; akun setengah jadi tidak dihitung kuota 2 user"]
  E --> F["/amankan langkah 1: buat passkey"]
  F -- "passkey gagal, dibatalkan, atau tidak didukung" --> G
  F -- "berhasil" --> H
  G["/amankan langkah 2: TOTP, masukkan kode 6 digit"] --> G1{"Kode benar?"}
  G1 -- "tidak" --> G2["Galat inline, boleh coba lagi, rate limit"]
  G2 --> G
  G1 -- "ya" --> H["Langkah 3: tampilkan kode pemulihan sekali"]
  H --> H1{"Pengguna konfirmasi sudah menyimpan?"}
  H1 -- "belum" --> H
  H1 -- "sudah" --> H2["api.accept_invitation: undangan terpakai, F anggota Bersama, ruang Pribadi dibuat, kuota 2 user terisi"]
  H2 --> I["Sesi naik penuh, amr tersimpan"]
  I --> J["/pribadi/beranda: checklist Mulai dari sini (3 langkah)"]
  E -. "berhenti di sini" .-> K["Login berikutnya: kata sandi lalu sesi pending_2fa tanpa faktor diarahkan ke /amankan (lanjutkan mengamankan)"]
  K --> F
  E -. "lewat 72 jam tanpa selesai" .-> L["Akun setengah jadi dihapus; undangan kedaluwarsa; Novanda kirim ulang"]
```

**Keadaan.** `undangan_valid`, `akun_dibuat (pending_2fa)`, `faktor_kuat_aktif`, `pemulihan_dikonfirmasi`, `undangan_terpakai`, `sesi_penuh`.
**Aturan pemakaian undangan (keputusan pemilik).** Undangan baru terpakai setelah akun diamankan (faktor kuat aktif dan kode pemulihan dikonfirmasi). Titik panggil `api.accept_invitation` mengikuti BSD yang disesuaikan; sebelum itu Novanda masih bisa mencabut atau mengirim ulang.
**Jalur galat.** Token kedaluwarsa, sudah dipakai, dicabut, ditolak, atau salah: respons dan halaman seragam, tanpa membocorkan alasan. Email di form berasal dari token dan tidak bisa diganti. Sesi `pending_2fa` ditolak oleh `requireUser` untuk semua halaman data. Pengguna ke-3 ditolak oleh batas keras 2 user di DB (`user_limit`).
**Catatan.** Prototipe M0a: tiap langkah tiruan, panjang minimal kata sandi 12 (final mengikuti kebijakan Better Auth di BSD/M0b, termasuk penolakan kata sandi bocor atau lemah). Novanda (pemilik) tidak lewat undangan: akunnya lahir dari allowlist `AUTH_ALLOWED_EMAILS` (env), lalu langkah `/amankan` yang sama (§2).
**Beranda pertama.** Tidak ada "Rp 0". Checklist Novanda 4 langkah: Akun aman, Tambah dompet sehari-hari, Catat satu pengeluaran, Undang Farida. Checklist Farida 3 langkah ("1 dari 3 selesai"): Akun aman, Tambah dompet, Catat satu pengeluaran; langkah pengganti tidak ada. Layar ini adalah utang desain (DBD §9).

## 2. Masuk, lupa kata sandi, akun pertama

```mermaid
flowchart TD
  A["/masuk"] --> B{"Pilihan"}
  B -- "Masuk dengan passkey" --> C["Prompt perangkat"]
  C -- "berhasil" --> Z["Sesi penuh, amr = passkey"]
  C -- "dibatalkan, gagal, atau tidak didukung" --> A1["Pesan jelas + jalur ke kata sandi + TOTP"]
  A1 --> A
  B -- "Email + kata sandi" --> D["Cek kredensial"]
  D -- "salah" --> D1["Pesan seragam: email atau kata sandi salah, hitung percobaan"]
  D1 --> D2{"Lewat batas?"}
  D2 -- "ya" --> D3["Jeda bertahap (makin lama), rate limit per IP dan akun, tanpa kunci permanen"]
  D2 -- "tidak" --> A
  D -- "benar" --> E["Sesi pending_2fa"]
  E --> E1{"Akun sudah punya faktor kuat aktif?"}
  E1 -- "belum" --> E2["Arahkan ke /amankan (lanjutkan mengamankan), lihat Onboarding §1"]
  E1 -- "ya (TOTP)" --> F["Kode TOTP 6 digit"]
  F -- "salah" --> F1["Galat inline, rate limit"]
  F1 --> F
  F -- "benar" --> Z
  F -- "perangkat hilang" --> G["Kode pemulihan, sekali pakai"]
  G -- "valid" --> Z
  G -- "tidak valid" --> F1
  Z --> H["Redirect ke /pribadi/beranda atau tujuan semula"]
  A -- "Lupa kata sandi" --> R["Isi email, respons seragam (terdaftar atau tidak)"]
  R --> R1["Email tautan reset via Resend, berlaku singkat"]
  R1 --> R2["Kata sandi baru: semua sesi dicabut, faktor kuat tetap aktif"]
  R2 --> A
```

**Aturan.** Faktor kuat wajib (§0). Respons login dan reset seragam. Reset kata sandi mencabut semua sesi dan tidak mematikan 2FA. Kode pemulihan yang dipakai hangus. Akun yang hanya punya passkey memakai kode pemulihan bila perangkat hilang. Sesi idle 7 hari, absolut 30 hari.
**Akun pertama.** Novanda mendaftar sekali lewat allowlist env (`AUTH_ALLOWED_EMAILS`): email dalam daftar boleh membuat akun pemilik, lalu `/amankan` dan kode pemulihan seperti §1. Email di luar daftar dan bukan dari undangan ditolak.
**Menu → Pengaturan.** Daftar perangkat dan cabut sesi, audit log yang bisa dibaca pemilik (di prototipe Menu menampilkan "Segera"; layar ini utang desain, DBD §9).
**Keadaan galat auth** (kode salah, rate limit, kode pemulihan, passkey dibatalkan, pesan seragam, jeda bertahap) perlu bingkai desain sebelum M0b; lihat DBD §9.

## 3. Catat (jalur tercepat ≤ 3 ketukan, toast + Urungkan, `clientId` idempoten)

```mermaid
flowchart TD
  A["Layar mana pun: tombol Catat di tab bar (ketukan 1), atau tombol c"] --> B["Sheet terbuka (event catat_dibuka): judul Pengeluaran + ruang, fokus di Nominal"]
  B --> C["Ketik nominal (tombol angka tidak dihitung ketukan)"]
  C --> D["Ketuk chip kategori (ketukan 2). Kategori tidak pernah terpilih otomatis"]
  D --> E{"Nominal > 0 dan kategori dipilih?"}
  E -- "belum" --> E1["Simpan nonaktif, petunjuk: Pilih kategori untuk menyimpan"]
  E1 --> D
  E -- "ya" --> F["Ketuk Simpan (ketukan 3)"]
  F --> G["api.create_entry, clientId sama dengan yang dibuat saat sheet dibuka"]
  G --> H{"Server: clientId sudah ada?"}
  H -- "ya, isi sama" --> I["Kembalikan entri yang ada, bukan entri baru"]
  H -- "ya, isi beda" --> J["Galat DK410, sheet tetap terbuka"]
  H -- "tidak" --> K{"Saldo cukup?"}
  K -- "tidak" --> K1["Peringatan inline (bukan dialog), simpan tetap boleh dengan allow_negative; akun aset tidak boleh negatif"]
  K1 --> L
  K -- "ya" --> L["Entri tersimpan, saldo turunan berubah"]
  I --> M
  L --> M["Sheet tertutup (event catat_disimpan dengan catat_id dan ketukan, tanpa nominal), toast: Tersimpan di Pribadi, nominal, dari dompet + Urungkan"]
  M -- "Urungkan (6 detik)" --> N["Entri void, saldo kembali, toast konfirmasi"]
  M -- "tidak" --> O["Toast hilang, entri tetap"]
  F -- "jaringan putus atau galat" --> P["Sheet tetap terbuka, isian utuh, pesan sebaris, Coba lagi memakai clientId yang sama"]
  P --> F
```

**Keadaan.** `idle`, `terisi`, `menyimpan`, `tersimpan`, `galat`. Sheet menyebut ruang tujuan; dompet terbatas pada ruang itu.
**Pindah ruang di sheet.** "Pindah ke Bersama/Pribadi" mempertahankan nominal, mengganti dompet ke operasional terakhir ruang tujuan, mereset kategori, dan membuat `clientId` baru (niat baru).
**Jenis.** Pengeluaran, Pemasukan, Transfer lewat menu di judul sheet. Transfer antar ruang ada di §4 dan baru aktif M1; di prototipe M0a Catat hanya transfer dalam satu ruang.
**Prototipe.** "Menyimpan…" ditunda ke M1 (store sinkron). Toast menampilkan 6 detik, berhenti saat hover atau fokus.
**Aturan hitung ketukan** (sama dengan PRD §7): yang dihitung adalah aksi pointer dari tombol Catat sampai Simpan, jadi jalur tercepat = Catat, kategori, Simpan = 3 ketukan. Tombol angka dan ketikan nominal tidak dihitung. Pintasan `c` menggantikan ketukan tombol Catat dan tidak dihitung. Jalur lebih panjang (chip "Kategori lain…", ganti dompet, ganti tanggal) tetap sah; jumlah ketukan nyata dikirim pada event `catat_disimpan`.
**Kecepatan.** Target median ≤ 8 detik (selisih `catat_dibuka` ke `catat_disimpan` dengan `catat_id` sama) dan ≥ 70% catatan ≤ 3 ketukan (PRD §7). Tombol "Tidak ada pengeluaran hari ini" ada di Beranda dan mencatat hari itu sebagai tercatat (`api.mark_no_spend_day`).
**Galat yang tampil ke pengguna.** `DK410` (clientId bentrok, sheet tetap terbuka); `before_opening` (tanggal sebelum dompet dibuka: pesan dengan tanggal buka dompet, pemilih tanggal dibatasi); `account_archived` (dompet terarsip: pilih dompet lain); `saldo_negatif` (peringatan inline, lihat atas); `DK409 version_conflict` (hanya pada edit, §8); jaringan putus (sheet tetap terbuka, Coba lagi). Jalur pemulihan selalu mempertahankan isian.

## 4. Transfer antar ruang (kaki bertaut, void keduanya)

```mermaid
flowchart TD
  A["Catat → Transfer, atau dompet Pribadi → dompet Bersama"] --> B["Pilih dompet sumber di ruang A dan dompet tujuan di ruang B, nominal"]
  B --> C{"Pengguna anggota kedua ruang, dompet sesuai ruang, bukan kantor?"}
  C -- "bukan anggota atau ruang tidak ada" --> C1["Ditolak sebagai tidak ditemukan (DK404), tanpa membocorkan keberadaan ruang"]
  C -- "p_space_id tidak cocok dengan ruang akun" --> C2["Ditolak: space_mismatch"]
  C -- "kombinasi tidak diizinkan" --> C3["Ditolak: cross_space_not_allowed atau cross_space_kantor"]
  C -- "ya" --> D["api.create_transfer, satu transaksi DB"]
  D --> E["Kaki keluar di ruang sumber: main = −jumlah, fee = −biaya"]
  D --> F["Kaki masuk di ruang tujuan: counter = +jumlah, tanpa deskripsi"]
  E --> G["Keduanya diikat link_id; trigger pasangan memastikan nominal sama"]
  F --> G
  G --> H["Pribadi: Setor ke Bersama (bukan pengeluaran)"]
  G --> I["Bersama: Setoran dari nama (bukan pemasukan), tanpa nama dompet sumber"]
  H --> J{"Void atau edit?"}
  J -- "oleh pencatat" --> K["Void satu kaki ⇒ kaki bertaut ikut void, atau dipulihkan bersama"]
  J -- "oleh bukan pencatat" --> L["Ditolak"]
```

**Aturan (Spec §9.1).** Dua entri `space_transfer` per transfer, satu per ruang. Σ lines = −fee. Edit dan void hanya oleh pencatat.
**Bersama ke Pribadi (keputusan pemilik).** Diizinkan untuk anggota mana pun (Spec §7a). Keterangan yang diisi pengambil disimpan di sisi Pribadi saja; Bersama hanya menampilkan "Diambil oleh nama", tanpa nama dompet tujuan dan tanpa keterangan. Catatan untuk Bersama hanya lewat `shared_note` yang diisi eksplisit.
**Biaya transfer dari Kas Kantor (keputusan pemilik).** Biaya masuk angka Kantor ("Tidak masuk hitungan pribadi"), bukan pengeluaran pribadi.
**Jalur galat.** `space_mismatch`, `cross_space_not_allowed`, `cross_space_kantor`, saldo kurang (peringatan seperti §3), `clientId` bentrok (DK410), kaki pasangan hilang (`space_transfer_pair_invalid`, ditolak trigger, tidak boleh terjadi lewat fungsi).
**Prototipe M0a.** Seed demo sudah memuat kaki bertaut (`linkId`, arah out/in); void atau pulihkan satu kaki ikut membalik kaki lainnya. Catat belum menawarkan transfer lintas ruang; di M1 menu jenis Transfer menawarkannya (butuh bingkai desain, DBD §9).

## 5. Batalkan, urungkan, dan Sampah (90 hari)

```mermaid
flowchart TD
  A["Detail transaksi: Batalkan transaksi"] --> B["AlertDialog: akibat ditulis (saldo dompet berubah, bisa dipulihkan 90 hari dari Sampah). Fokus awal di Kembali"]
  B -- "Kembali" --> A
  B -- "Batalkan transaksi" --> C["api.void_entry: entri void (voided_at), history append-only bertambah"]
  C --> D["Kembali ke daftar, total harian dihitung ulang, toast: dibatalkan + Urungkan"]
  D -- "Urungkan" --> E["api.restore_entry: voided_at dikosongkan, saldo kembali"]
  D -- "diabaikan" --> F["Masuk Sampah"]
  F --> F1["Layar Sampah (M1): `api.trash_list` menampilkan entri batal 90 hari terakhir"]
  F1 --> G{"Pulihkan dari Sampah dalam 90 hari?"}
  G -- "ya" --> E
  G -- "tidak" --> H["Job purge_voided mingguan hapus permanen"]
  H --> I["Tersisa entry_tombstones: id, ruang, jenis, tanggal; tanpa nominal dan deskripsi"]
  G -- "lewat 90 hari" --> E1["Pulihkan ditolak: restore_window_closed"]
```

**Aturan.** Soft delete; purge setelah 90 hari (keputusan pemilik, Spec §9.1); `entry_history` ikut terhapus bersama entrinya. Untuk `space_transfer`, void dan pulihkan berlaku pada kedua kaki, dan purge menghapus pasangan berdua. Entri yang dirujuk `reimburses_entry_id` dilewati purge. URL transaksi yang sudah dibatalkan menampilkan "Transaksi ini sudah dibatalkan." dengan aksi Pulihkan (bukan 404; bingkai D5 perlu didesain).
**Layar Sampah di M1 (keputusan pemilik).** Dibangun bersama fungsi baca entri void di BSD; tempatnya di navigasi ditetapkan saat desain (utang desain, DBD §9). Teks dialog "dari Sampah" tetap karena layarnya ada.
**Belum selesai di prototipe.** "Ubah" dan "Pindahkan ke ruang lain" di detail masih toast "Segera di M1" (lihat §8).

## 6. Undang Farida (email, token sekali pakai 72 jam, batas 2 user)

```mermaid
flowchart TD
  A["Novanda: /undang atau checklist Undang Farida"] --> B{"Pengguna pemilik?"}
  B -- "bukan" --> B1["Ditolak"]
  B -- "ya" --> C{"Sudah ada 2 user, atau sudah ada undangan terbuka?"}
  C -- "2 user" --> C1["Ditolak oleh batas keras di DB"]
  C -- "undangan terbuka" --> C2["Daftar Undangan tertunda: status, Cabut, Kirim ulang"]
  C -- "tidak" --> D["Isi email pasangan, Kirim undangan (api.create_invitation)"]
  D --> E["Server membuat token acak, simpan hash, terikat email, kedaluwarsa 72 jam; email dikirim via Resend"]
  E --> F["Keadaan Tautan terkirim: Berlaku 72 jam, sekali pakai; status Menunggu"]
  F --> G["Farida membuka email dan tautan"]
  G --> H["Alur Onboarding §1"]
  F --> P["Undangan tertunda"]
  P -- "Cabut (api.revoke_invitation)" --> P1["Token hangus; email salah ketik teratasi"]
  P1 --> D
  P -- "Kirim ulang" --> P2["Cabut yang lama, buat token baru, email baru"]
  P2 --> F
  H --> I{"Akun selesai diamankan sebelum 72 jam?"}
  I -- "ya" --> J["Undangan terpakai, Farida jadi anggota ruang Bersama"]
  I -- "tidak" --> K["Token kedaluwarsa, akun setengah jadi dihapus; Novanda kirim ulang"]
  H -- "Farida menekan Tolak" --> T["Undangan hangus; Novanda melihat status Ditolak, bisa kirim ulang"]
```

**Aturan (Spec §9.2, keputusan pemilik).** Dikirim lewat email, yang sekaligus memverifikasi alamat Farida. Token disimpan sebagai hash, sekali pakai, terikat email. Satu undangan terbuka per rumah tangga; karena itu Novanda perlu layar Undangan tertunda untuk mencabut atau mengirim ulang bila email salah. Audit log mencatat undangan dibuat, dipakai, dicabut, ditolak. Tautan diperlakukan seperti kata sandi.
**Layar pendukung** (utang desain, DBD §9): keadaan Tautan terkirim, daftar Undangan tertunda, halaman galat undangan dengan salinan yang tidak membocorkan alasan.

## 7. Dompet baru, Cocokkan saldo, arsip (M1)

```mermaid
flowchart TD
  A["Dompet → Tambah dompet"] --> B["Isi nama, jenis, saldo hari ini"]
  B --> C["api.create_account: dompet + entri Saldo awal (opening_balance), opened_on = hari ini"]
  C --> D["Detail dompet: saldo turunan dari jurnal"]
  D --> E{"Saldo awal salah dalam 7 hari pertama?"}
  E -- "ya" --> E1["Edit langsung (opening_locked setelah 7 hari)"]
  E -- "tidak" --> F{"Saldo app beda dari saldo nyata?"}
  F -- "ya" --> G["Cocokkan saldo: isi saldo nyata (api.reconcile_balance)"]
  G --> H["Entri adjustment sebesar selisih; pemasukan dan pengeluaran tidak berubah"]
  F -- "tidak" --> I{"Arsipkan dompet?"}
  I -- "saldo 0" --> I1["Dompet diarsipkan (fungsi arsip dompet, BSD)"]
  I -- "saldo bukan 0" --> I2["Ditolak: kosongkan atau pindahkan saldo dulu"]
```

**Aturan.** Dompet hanya bisa diarsipkan bila saldo 0 (keputusan pemilik). Dompet terarsip tidak muncul di pilihan Catat (`account_archived` bila terpaksa). Tanggal Catat tidak boleh sebelum tanggal buka dompet (`before_opening`). Biaya transfer dari dompet Kantor masuk angka Kantor.

## 8. Ubah transaksi, konflik versi, pindah ruang (M1)

```mermaid
flowchart TD
  A["Detail transaksi → Ubah"] --> B["Sheet Ubah dengan nilai sekarang dan version"]
  B --> C["Simpan: api.update_entry dengan version yang dibaca"]
  C --> D{"version masih sama?"}
  D -- "ya" --> E["Tersimpan, history mencatat sebelum/sesudah dan pengubah"]
  D -- "tidak (DK409 version_conflict, mis. dua anggota di Bersama)" --> F["Pesan: transaksi sudah diubah orang lain; tampilkan nilai terbaru, pilih Muat ulang atau Timpa dengan perubahan saya"]
  F --> B
  A --> G["Pindahkan ke ruang lain"]
  G --> H["Fungsi pindah ruang (BSD, belum ditulis): void + buat ulang atomik di ruang tujuan"]
  H --> I["Dompet dan kategori diganti ke milik ruang tujuan; konfirmasi akibat"]
```

**Aturan.** Edit di Bersama oleh bukan pencatat mengikuti hak setara (Spec §7a) kecuali `space_transfer` (hanya pencatat). Transaksi yang sudah dibatalkan tidak bisa diubah (`entry_voided`).

## 9. Talangan dan reimburse (M1)

```mermaid
flowchart TD
  A["Catat pengeluaran: tandai Talangan kantor"] --> B["Entri reimbursable di dompet pribadi; bukan pengeluaran pribadi, kelas x_talangan"]
  B --> C["Dompet menampilkan Menunggu reimburse"]
  C --> D["Uang diganti kantor: catat reimburse (fungsi reimburse di BSD)"]
  D --> E["Entri reimburse merujuk reimburses_entry_id; talangan lunas"]
  E --> F["Entri yang dirujuk tidak ikut purge Sampah"]
```

**Aturan.** Hanya pengeluaran pribadi yang bisa ditalangi (`reimbursable_personal_expense_only`); dompet Kantor hanya di ruang Pribadi (`kantor_personal_only`). Ikon dan alur "Menunggu reimburse" butuh bingkai desain (DBD §9).

## 10. Tagihan rutin dasar (M2)

```mermaid
flowchart TD
  A["Rencana → Tambah tagihan (api.create_bill)"] --> B{"Tanggal mulai di masa lalu?"}
  B -- "ya" --> B1["Bulan sebelumnya dilewati, tidak dihitung lewat; jadwal mulai dari bulan berjalan"]
  B -- "tidak" --> C["Jadwal dibuat"]
  B1 --> C
  C --> D["Tagihan 7 hari ke depan tampil di Beranda"]
  D --> E["Bayar: api.post_bill_occurrence membuat entri dan menandai occurrence"]
  E --> F["Bayar kedua kali ditolak: already_posted"]
```

**Aturan.** Satu kewajiban satu sumber: tagihan atau anggaran wajib, tidak keduanya (`obligation_double`). Tagihan lanjutan (tanggal 31, trip, deteksi langganan) di M5.

## Pertanyaan terbuka

Ditutup keputusan pemilik 2026-10-31: aturan faktor kuat, pendaftaran pemilik pertama dan lupa kata sandi, cara kirim undangan dan email salah, layar Sampah.

1. Transfer lintas ruang di Catat: tampil di M1; belum ada di prototipe M0a.
2. Letak layar Sampah dalam navigasi (ditetapkan saat desain).
3. Pengganti langkah "Undang Farida" di checklist Farida: diputuskan tidak ada (3 langkah), desain perlu dibuat.
4. `api.move_entry_to_space` dan `api.create_reimbursement` masih berupa daftar di BSD (belum ditulis).
