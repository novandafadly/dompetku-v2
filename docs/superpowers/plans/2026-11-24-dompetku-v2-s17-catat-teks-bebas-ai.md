# Rencana S17 — Catat teks bebas (`LlmProvider` Claude & Gemini), kuota harian DB, dan Eval Set (M6)

**Tanggal:** 2026-11-24  
**Arahan pemilik (2026-11-24):** mendukung **Claude (Anthropic)** dan **Gemini (Google)** di balik `LlmProvider`, sisanya mengikuti rekomendasi terbaik (default agen dapat diubah tanpa migrasi destruktif).

## Cakupan (`IPD.md` §6 S17, `PRD.md` M6, `qa.md` M6)

1. **Kuota harian AI di DB (`0150_ai_kuota.sql`):** tabel `app.ai_usage` (RLS ENABLE+FORCE), fungsi `api.ai_quota` (INVOKER STABLE) dan `api.consume_ai_quota` (DEFINER atomik per user per hari WIB: `parse` 15/hari, `analysis` 5/hari -> total 20/hari sesuai `IPD.md` S18 & `qa.md` M6).
2. **`LlmProvider` multi-penyedia (Claude & Gemini) tanpa dependensi SDK berat (`apps/web/src/server/ai/`):**
   - `provider.ts`: antarmuka `LlmProvider`, skema Zod ketat keluaran LLM, pembuat prompt hemat & bebas bocor (`buildParsePrompt`, **B13**: hanya satu teks pengguna + daftar nama dompet & kategori aktif ruang aktif — tanpa saldo, tanpa riwayat, tanpa kontak, tanpa ruang pasangan).
   - `gemini.ts`: adapter **Google Gemini** (`gemini-2.5-flash` bawaan, `GEMINI_MODEL`, `GEMINI_API_KEY` lewat header `x-goog-api-key`, `responseMimeType: application/json`, timeout 8 dtk).
   - `claude.ts`: adapter **Anthropic Claude** (`claude-haiku-4-5-20251001` bawaan, `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY` lewat header `x-api-key`, timeout 8 dtk).
   - `config.ts`: membaca `LLM_PROVIDER` (`auto|gemini|anthropic|none`) dan `LLM_FALLBACK_PROVIDER` (`auto|gemini|anthropic|none`) sehingga bisa memakai **Gemini saja**, **Claude saja**, atau **keduanya dengan failover otomatis** (primer → cadangan).
3. **Parser hibrida (aturan + LLM) & Eval Set >= 90%:**
   - `rules.ts`: parser aturan murni (dibangun di atas `wa/parse.ts` + `wa/date.ts` + `wa/wallet.ts`, ditambah dukungan kalimat web alami tanpa `@` seperti `"makan siang 35rb bca"`, `"kopi 25k pakai gopay"`, `"2 hari lalu"`, serta pencocokan kategori aktif berdasar kata kunci).
   - `parse-entry.ts`: jalankan aturan dulu (0 kuota, < 1 ms). Hanya panggil LLM bila aturan gagal/keyakinan rendah dan penyedia aktif tersedia. Bila kuota habis (15/15) atau LLM galat/timeout, parser aturan tetap bekerja (tidak pernah gagal total atau auto-simpan).
   - `eval.test.ts` + `eval-cases.ts`: **60 kasus nyata Bahasa Indonesia** (nominal, jenis, dompet, kategori, tanggal, kasus tolak/injeksi) dengan target akurasi **>= 90%**.
4. **UI Catat Teks Bebas (pratinjau wajib konfirmasi, tidak pernah auto-simpan):**
   - Server Action `parseFreeTextAction` di `apps/web/src/app/[ruang]/_actions/catat-ai.ts` (`actionContext(ruang)` baris pertama, terdaftar di `actions.test.ts`).
   - Bilah **"Ketik cepat"** di dalam `CatatSheet` mode nyata saja (`source.parseFreeText`, tidak ada di prototipe → 0 byte & 0 perubahan di prototipe).
   - Hasil pratinjau mengisi kolom `CatatSheet` dan menampilkan banner `Periksa sebelum simpan` + sumber (`Terbaca otomatis` / `Terbaca dengan Gemini` / `Terbaca dengan Claude`); penyimpanan tetap lewat tombol `Simpan` biasa.

## Keputusan desain S17 (rekomendasi terbaik; dapat diubah tanpa migrasi destruktif)

| ID | Topik | Pilihan (default) | Alternatif |
| --- | --- | --- | --- |
| **K1** | Penyedia & model LLM bawaan | `LlmProvider` mendukung **Gemini** (`gemini-2.5-flash`) dan **Claude** (`claude-haiku-4-5-20251001`) via REST `fetch` tanpa SDK; `LLM_PROVIDER=auto` + `LLM_FALLBACK_PROVIDER=auto` memakai keduanya (failover otomatis bila kedua kunci diisi). | Pilih satu penyedia tetap |
| **K2** | Aturan dulu vs LLM dulu | **Aturan dulu** (`rules.ts`): kalimat standar (`makan siang 35rb bca`) langsung terbaca tanpa memotong kuota AI; LLM hanya dipanggil saat kalimat tak terurai/kompleks atau pengguna meminta bantuan AI. Kuota habis → parser aturan tetap jalan. | Selalu panggil LLM |
| **K3** | Kuota harian | `parse = 15/hari/user`, `analysis = 5/hari/user` (reset 00:00 WIB lewat `app.today()`), dicatat atomik di `app.ai_usage`. | Kuota di memori proses |
| **K4** | Target Eval Set M6 | **>= 90%** kecocokan penuh pada 60 kasus uji Bahasa Indonesia (`eval-cases.ts`). `[konfirmasi pemilik]` | Target >= 85% atau >= 95% |
| **K5** | Batas privasi prompt (B13) | Prompt parsing hanya membawa: tanggal hari ini WIB, daftar nama dompet aktif ruang ini, daftar nama kategori aktif ruang ini, dan satu teks input pengguna (maks 300 huruf). Tanpa saldo, tanpa riwayat, tanpa kontak, tanpa ruang pasangan. | Sertakan riwayat transaksi terakhir |
| **K6** | Pratinjau wajib konfirmasi | `parseFreeTextAction` 100% **baca-saja** pada tabel `entries`; hasil hanya mengisi draf `CatatSheet` disertai banner `Periksa sebelum simpan` sampai pengguna menekan `Simpan`. | Sheet pratinjau terpisah |

## Fokus Review

1. **Privasi & B13:** prompt builder tidak pernah memuat kanari ruang lain, saldo, kontak, atau riwayat; diuji di unit & integrasi (`s17.int.test.ts`) + e2e Bersama (`@B13`).
2. **Anti auto-simpan:** `parseFreeTextAction` tidak pernah memanggil `createEntry`; tombol `Isi otomatis` hanya mengisi draf form dan menampilkan banner konfirmasi.
3. **Kuota & keamanan DB:** `app.ai_usage` RLS ENABLE+FORCE, `api.consume_ai_quota` DEFINER atomik (anti balapan paralel), reset 00:00 WIB, `migrate:down` ditolak di `prod`.
4. **Keamanan kunci & log:** API key Gemini/Claude dikirim lewat header (bukan URL), tidak pernah dicetak di log, respons LLM divalidasi Zod ketat, nominal/deskripsi tidak dicatat di log.
5. **Budget JS & prototipe:** mode prototipe tidak berubah, cold-load JS <= 162 kB per rute.
