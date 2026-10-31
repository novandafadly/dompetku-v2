# AFD: diagram alur aplikasi DompetKu v2

Status: draf untuk review tim. Tanggal: 2026-10-31.
Sumber: Spec §5.3, §5.4, §9.1 sampai §9.3; `docs/design/panel-malam/README.md` (layar A1 sampai A4, C1 sampai C5, D1 sampai D4); kode M0a di `apps/web/src/app/` dan `apps/web/src/features/`. Alur auth di M0a adalah tiruan; langkah server dan kode galat di bawah adalah rencana M0b/M1 (rinci di BSD dan TRD).

Rute prototipe: `/masuk`, `/undang`, `/terima-undangan`, `/buat-akun`, `/amankan`, `/[ruang]/{beranda,transaksi,dompet,rencana}` dengan `[ruang]` = `pribadi` atau `bersama`.

## 1. Onboarding Farida (undangan sampai Beranda)

```mermaid
flowchart TD
  A["Tautan undangan dibuka"] --> B{"Token valid, belum dipakai, < 72 jam?"}
  B -- "tidak" --> B1["Halaman galat: undangan tidak berlaku, minta Novanda kirim ulang"]
  B -- "ya" --> C["/terima-undangan: lihat apa yang terlihat dan tidak terlihat"]
  C -- "Tolak" --> C1["Token dicabut, selesai"]
  C -- "Terima undangan" --> D["/buat-akun: email dari token, kata sandi baru"]
  D --> D1{"Kata sandi lolos kebijakan?"}
  D1 -- "tidak" --> D2["Galat inline, fokus ke kolom"]
  D2 --> D
  D1 -- "ya" --> E["Akun dibuat, sesi pending_2fa"]
  E --> F["/amankan langkah 1: buat passkey"]
  F -- "passkey gagal atau tidak didukung" --> G
  F -- "berhasil" --> H
  G["/amankan langkah 2: TOTP, masukkan kode 6 digit"] --> G1{"Kode benar?"}
  G1 -- "tidak" --> G2["Galat inline, boleh coba lagi, rate limit"]
  G2 --> G
  G1 -- "ya" --> H["Langkah 3: tampilkan kode pemulihan sekali"]
  H --> H1{"Pengguna konfirmasi sudah menyimpan?"}
  H1 -- "belum" --> H
  H1 -- "sudah" --> I["Sesi naik penuh, amr tersimpan"]
  I --> J["/pribadi/beranda: checklist Mulai dari sini"]
```

**Keadaan.** `undangan_valid`, `akun_dibuat (pending_2fa)`, `faktor_kuat_aktif`, `pemulihan_dikonfirmasi`, `sesi_penuh`.
**Jalur galat.** Token kedaluwarsa, sudah dipakai, atau salah: respons seragam, tanpa membocorkan alasan rinci. Email di form berasal dari token dan tidak bisa diganti. Sesi `pending_2fa` ditolak oleh `requireUser` untuk semua halaman data. Pengguna ke-3 ditolak oleh batas keras 2 user di DB.
**Catatan.** Prototipe M0a: tiap langkah tiruan, panjang minimal kata sandi 12 (dapat berubah saat kebijakan Better Auth ditetapkan). Novanda sebagai pemilik melewati `/terima-undangan` dan `/buat-akun`; ia mendaftar lewat allowlist `AUTH_ALLOWED_EMAILS` lalu masuk ke `/amankan` (Belum diputuskan: tombol pendaftaran pemilik pertama, ditetapkan di M0b).
**Beranda pertama.** Tidak ada "Rp 0". Checklist: Akun aman, Tambah dompet sehari-hari, Catat satu pengeluaran, Undang Farida (bagi Farida langkah ini tidak ada; Belum diputuskan pengganti langkah ke-4).

## 2. Masuk (passkey atau password+TOTP)

```mermaid
flowchart TD
  A["/masuk"] --> B{"Pilihan"}
  B -- "Masuk dengan passkey" --> C["Prompt perangkat"]
  C -- "berhasil" --> Z["Sesi penuh, amr = passkey"]
  C -- "dibatalkan atau gagal" --> A
  B -- "Email + kata sandi" --> D["Cek kredensial"]
  D -- "salah" --> D1["Pesan seragam: email atau kata sandi salah, hitung percobaan"]
  D1 --> D2{"Lewat batas?"}
  D2 -- "ya" --> D3["Lockout bertahap + rate limit per IP dan akun"]
  D2 -- "tidak" --> A
  D -- "benar" --> E["Sesi pending_2fa"]
  E --> F["Kode TOTP 6 digit"]
  F -- "salah" --> F1["Galat inline, rate limit"]
  F1 --> F
  F -- "benar" --> Z
  F -- "perangkat hilang" --> G["Kode pemulihan, sekali pakai"]
  G -- "valid" --> Z
  G -- "tidak valid" --> F1
  Z --> H["Redirect ke /pribadi/beranda atau tujuan semula"]
```

**Aturan.** Faktor kuat wajib: passkey ATAU password+TOTP (Spec §9.2). Respons login dan reset seragam. Reset password mencabut semua sesi dan tidak mematikan 2FA. Kode pemulihan yang dipakai hangus.
**Belum diputuskan.** Alur "lupa kata sandi" (email reset, penyedia email) dan layar Menu → Pengaturan untuk daftar perangkat dan cabut sesi (di Menu tampil "Segera").

## 3. Catat (≤ 3 ketukan, toast + Urungkan, `clientId` idempoten)

```mermaid
flowchart TD
  A["Layar mana pun: tombol Catat di tab bar, atau tombol c"] --> B["Sheet terbuka: judul Pengeluaran + ruang, fokus di Nominal"]
  B --> C["Ketik nominal (tombol angka tidak dihitung ketukan)"]
  C --> D["Ketuk chip kategori (ketukan 2). Kategori tidak pernah terpilih otomatis"]
  D --> E{"Nominal > 0 dan kategori dipilih?"}
  E -- "belum" --> E1["Simpan nonaktif, petunjuk: Pilih kategori untuk menyimpan"]
  E1 --> D
  E -- "ya" --> F["Ketuk Simpan (ketukan 3)"]
  F --> G["clientId sama dengan yang dibuat saat sheet dibuka"]
  G --> H{"Server: clientId sudah ada?"}
  H -- "ya, isi sama" --> I["Kembalikan entri yang ada, bukan entri baru"]
  H -- "ya, isi beda" --> J["Galat DK410, sheet tetap terbuka"]
  H -- "tidak" --> K{"Saldo cukup?"}
  K -- "tidak" --> K1["Peringatan inline (bukan dialog), simpan tetap boleh dengan allow_negative; akun aset tidak boleh negatif"]
  K1 --> L
  K -- "ya" --> L["Entri tersimpan, saldo turunan berubah"]
  I --> M
  L --> M["Sheet tertutup, toast: Tersimpan di Pribadi, nominal, dari dompet + Urungkan"]
  M -- "Urungkan (6 detik)" --> N["Entri void, saldo kembali, toast konfirmasi"]
  M -- "tidak" --> O["Toast hilang, entri tetap"]
  F -- "jaringan putus atau galat" --> P["Sheet tetap terbuka, isian utuh, pesan sebaris, Coba lagi memakai clientId yang sama"]
  P --> F
```

**Keadaan.** `idle`, `terisi`, `menyimpan`, `tersimpan`, `galat`. Sheet menyebut ruang tujuan; dompet terbatas pada ruang itu.
**Pindah ruang di sheet.** "Pindah ke Bersama/Pribadi" mempertahankan nominal, mengganti dompet ke operasional terakhir ruang tujuan, mereset kategori, dan membuat `clientId` baru (niat baru).
**Jenis.** Pengeluaran, Pemasukan, Transfer lewat menu di judul sheet. Transfer antar ruang ada di §4 dan baru aktif M1; di prototipe M0a Catat hanya transfer dalam satu ruang.
**Prototipe.** "Menyimpan…" ditunda ke M1 (store sinkron). Toast menampilkan 6 detik, berhenti saat hover atau fokus.
**Kecepatan.** Target median ≤ 8 detik dan ≥ 70% catatan ≤ 3 ketukan (lihat PRD §7).

## 4. Transfer antar ruang (kaki bertaut, void keduanya)

```mermaid
flowchart TD
  A["Catat → Transfer, atau dompet Pribadi → dompet Bersama"] --> B["Pilih dompet sumber di ruang A dan dompet tujuan di ruang B, nominal"]
  B --> C{"Pengguna anggota kedua ruang?"}
  C -- "tidak" --> C1["Ditolak: space_mismatch"]
  C -- "ya" --> D["api.create_space_transfer, satu transaksi DB"]
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

**Aturan (Spec §9.1).** Dua entri `space_transfer` per transfer, satu per ruang. Σ lines = −fee. Catatan untuk Bersama hanya lewat `shared_note` yang diisi eksplisit. Edit dan void hanya oleh pencatat. Arah Bersama ke Pribadi diizinkan untuk anggota mana pun (Spec §7a, tercatat "Diambil oleh nama").
**Jalur galat.** `space_mismatch`, saldo kurang (peringatan seperti §3), `clientId` bentrok (DK410), kaki pasangan hilang (ditolak trigger, tidak boleh terjadi lewat fungsi).
**Prototipe M0a.** Seed demo sudah memuat kaki bertaut (`linkId`, arah out/in); void atau pulihkan satu kaki ikut membalik kaki lainnya. Catat belum menawarkan transfer lintas ruang (Belum diputuskan, mungkin diminta pemilik saat penilaian).

## 5. Batalkan dan urungkan (sampah 90 hari)

```mermaid
flowchart TD
  A["Detail transaksi: Batalkan transaksi"] --> B["AlertDialog: akibat ditulis (saldo dompet berubah, bisa dipulihkan 90 hari). Fokus awal di Kembali"]
  B -- "Kembali" --> A
  B -- "Batalkan transaksi" --> C["Entri void (voided_at), history append-only bertambah"]
  C --> D["Kembali ke daftar, total harian dihitung ulang, toast: dibatalkan + Urungkan"]
  D -- "Urungkan" --> E["voided_at dikosongkan, saldo kembali"]
  D -- "diabaikan" --> F["Masuk Sampah"]
  F --> G{"Pulihkan dari Sampah dalam 90 hari?"}
  G -- "ya" --> E
  G -- "tidak" --> H["Job purge_voided mingguan hapus permanen"]
  H --> I["Tersisa entry_tombstones: id, ruang, jenis, tanggal; tanpa nominal dan deskripsi"]
```

**Aturan.** Soft delete; purge setelah 90 hari (keputusan pemilik, Spec §9.1); `entry_history` ikut terhapus bersama entrinya. Untuk `space_transfer`, void dan pulihkan berlaku pada kedua kaki. URL transaksi yang sudah dibatalkan menampilkan "Transaksi ini sudah dibatalkan." (bukan 404).
**Belum diputuskan.** Layar Sampah (belum ada di prototipe; teks akibat menyebut "dari Sampah") dan tempatnya di navigasi. "Ubah" dan "Pindahkan ke ruang lain" di detail masih toast "Segera di M1".

## 6. Undang Farida (token sekali pakai 72 jam, batas 2 user)

```mermaid
flowchart TD
  A["Novanda: /undang atau checklist Undang Farida"] --> B{"Pengguna pemilik?"}
  B -- "bukan" --> B1["Ditolak"]
  B -- "ya" --> C{"Sudah ada 2 user?"}
  C -- "ya" --> C1["Ditolak oleh batas keras di DB"]
  C -- "tidak" --> D["Isi email pasangan, Kirim undangan"]
  D --> E["Server membuat token acak, simpan hash, terikat email, kedaluwarsa 72 jam"]
  E --> F["Tautan tampil: Berlaku 72 jam, sekali pakai"]
  F --> G["Novanda mengirim tautan ke Farida"]
  G --> H["Alur Onboarding §1"]
  H --> I{"Akun selesai diamankan sebelum 72 jam?"}
  I -- "ya" --> J["Token hangus, Farida jadi anggota ruang Bersama"]
  I -- "tidak" --> K["Token kedaluwarsa, Novanda bisa kirim ulang (token lama dicabut)"]
```

**Aturan (Spec §9.2).** Token disimpan sebagai hash, sekali pakai, terikat email. Audit log mencatat undangan dibuat, dipakai, dicabut. Tautan harus diperlakukan seperti kata sandi.
**Belum diputuskan.** Cara pengiriman (Novanda menyalin tautan sendiri atau email lewat penyedia SMTP; penyedia email Belum diputuskan, Spec §8), dan perilaku bila email Farida diketik salah.

## Pertanyaan terbuka

1. Pendaftaran pemilik pertama (bootstrapping akun Novanda) dan layar "lupa kata sandi".
2. Pengganti langkah "Undang Farida" di checklist milik Farida.
3. Layar Sampah dan lokasinya di navigasi.
4. Transfer lintas ruang di Catat: kapan muncul (M1) dan apakah di prototipe M0a ditambah.
5. Cara kirim undangan dan penanganan email salah.
6. Aturan akhir faktor kuat (TOTP wajib di samping passkey atau tidak).
