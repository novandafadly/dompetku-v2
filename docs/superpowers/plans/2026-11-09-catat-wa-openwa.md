# Catat lewat WhatsApp (OpenWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu baris chat WhatsApp ke nomor bot (OpenWA) tercatat langsung ke ledger lewat `createEntry`, dibalas satu baris, dan bisa dibatalkan dengan `batal`.

**Architecture:** Container `openwa` (Baileys) di VM DB memanggil webhook ber-HMAC di web lewat network internal `wa`. Parser murni (`server/wa/parse.ts`) membaca teks; `handleInbound` memetakan nomor ke user lewat fungsi DB sempit, memanggil jalur Catat yang sudah ada, mencatat `app.wa_messages` untuk dedupe/batal, lalu membalas lewat `WaTransport` (adaptor OpenWA; adaptor Cloud API nanti tidak mengubah parser atau ledger).

**Tech Stack:** Next.js route handler, `pg` (`withUser`/`withLedger`), Zod, Vitest (unit + `test:int` melawan Postgres sungguhan), pgTAP, dbmate, Docker Compose, OpenWA (Baileys, SQLite).

**Spec:** `docs/superpowers/specs/2026-11-09-catat-wa-openwa-design.md` (disetujui pemilik 2026-11-09). Baca bersama plan ini.

## Global Constraints

- Branch kerja: `ccr-6fc4b982-0wmz1i` (ditetapkan sesi; menggantikan penamaan `claude/<milestone>-<topik>`). Jangan push ke `main`. PR #27 (draft) berlanjut sebagai PR fitur.
- Commit Conventional Commits berbahasa Indonesia, trailer persis seperti CLAUDE.md (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; instruksi pemilik di CLAUDE.md didahulukan) ditambah `Claude-Session: https://claude.ai/code/session_0198jjiMhR77D5LBUEZPbRuQ`.
- Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, tanpa proses Playwright lain), plus `test:int` dan pgTAP untuk perubahan DB.
- Budget JS 162 kB per rute; Beranda nyata 157,5 kB (headroom 0,3): fitur ini tidak boleh menambah JS ke Beranda atau mode prototipe.
- Semua kueri data lewat `withUser`/`withLedger`; tidak ada jalur tulis DB lain. Fungsi `SECURITY DEFINER`: `set search_path = ''`, `EXECUTE` hanya `dompetku_web`.
- Teks UI dan balasan WA: bahasa Indonesia, tanpa "rumah tangga". Nominal tampil lewat `formatRupiah`.
- Teks mentah pesan dan nominal tidak boleh masuk log atau `wa_messages`.
- Nilai spec yang dipatok: batas nominal WA Rp100.000.000 (env `WA_MAX_AMOUNT`), `batal` berlaku 10 menit, batas laju 30 pesan/menit per nomor (env `WA_RATE_PER_MIN`), kode hubung 6 karakter berlaku 10 menit, keterangan maksimum 200 karakter.
- Logika uang/RLS/DB (Task 2, 4) memakai model terkuat. Rahasia tidak masuk repo; hanya `.env.example`.
- Merge = deploy dan migrasi di produksi: butuh CI hijau di head, review task, dan review keamanan bersih (CLAUDE.md).

## Review Focus

Masukan yang disiratkan spec tapi paling mungkin menggigit pengguna; tiap baris punya tes di task pemiliknya.

1. Pesan sama dikirim ulang oleh webhook sesudah `batal`: tidak membuat entri baru dan balasan tidak berbohong (Task 4).
2. Nominal aneh: `0`, `-5rb`, `1.5.000`, `25rbu`, `1e6`, angka Unicode, `Rp.25.000`, kata `jam 7`/`2 kopi` (dua angka) (Task 1).
3. Pesan non-teks (gambar, stiker, suara), grup, pesan sendiri, status/siaran: diabaikan diam-diam tanpa galat (Task 5).
4. Format nomor pengirim: `+62…`, `62…`, `08…`, akhiran `@c.us`/`@s.whatsapp.net`, dan id `@lid` yang tidak bisa dipetakan ke nomor: dinormalisasi atau dianggap belum terhubung, tidak pernah salah orang (Task 2, 5).
5. OpenWA mati saat membalas, dan dua webhook identik bersamaan: entri tetap tersimpan sekali, webhook tetap 200 (Task 4, 5).

---

### Task 0: Dasar hijau untuk `format:check`

**Files:** Modify (hanya format): `apps/web/src/features/rencana/bill-row-view.tsx`, `apps/web/src/features/transaksi/entry-detail-view.tsx`, `apps/web/src/server/ledger/guarded.test.ts`, `apps/web/tests/e2e-bersama/fixtures.ts`, `apps/web/tests/e2e-ledger/vitals.spec.ts`, `docs/design/s9-bingkai.md`, `packages/db/README.md`

CI `main` merah di `format:check` pada 7 file ini (komentar PR #27); gerbang plan ini butuh hijau.

- [ ] **Step 1:** Jalankan `pnpm exec prettier --write` pada 7 file di atas saja. `git diff --stat` harus hanya menyentuh file itu dan hanya whitespace/format (periksa `git diff -w --stat` kosong atau mendekati kosong).
- [ ] **Step 2:** `pnpm format:check` lulus. Commit terpisah: `chore: format 7 file yang membuat format:check merah di main`.

### Task 1: Parser pesan (murni)

**Files:**
- Create: `apps/web/src/server/wa/parse.ts`
- Test: `apps/web/src/server/wa/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ParseResult =
    | { kind: 'entry'; type: 'income' | 'expense'; amount: number; space: 'personal' | 'shared'; description: string }
    | { kind: 'cancel' }
    | { kind: 'link'; code: string }
    | { kind: 'reject'; reason: 'empty' | 'no_amount' | 'many_amounts' | 'bad_amount' | 'too_large' };
  export function parseMessage(text: string, opts: { maxAmount: number }): ParseResult;
  ```
  Tanpa I/O, tanpa impor `server-only` (agar bisa dipakai tes Vitest biasa).

- [ ] **Step 1: Tulis tes tabel yang gagal** (`it.each`), nilai persis spec 4.1:
  - `'25rb makan siang'` dan `'makan siang 25rb'` → `entry expense 25000 personal 'makan siang'`; `'+5jt gaji'` → `income 5000000`; `'b 80rb belanja'` → `space 'shared' 80000 'belanja'`; `'Rp 25.000 kopi'`, `'25k kopi'`, `'1,5jt servis'` (1500000), `'KOPI 25000'`, `'25rb  makan   siang'` (spasi rapat).
  - `'gaji 5jt'` income (kata penanda dibuang dari keterangan atau dipertahankan, putuskan satu, tes menguncinya); `'terima 200rb'`, `'masuk 200rb'` income.
  - `'batal'` → `cancel`; `'  Batal '` → `cancel`; `'batal 25rb'` bukan cancel (jatuh ke entry).
  - `'hubung AB12CD'` → `link code 'AB12CD'` (kode dinormalisasi huruf besar).
  - Reject: `''`/spasi → `empty`; `'makan siang'` → `no_amount`; `'beli 2 kopi 50rb'`, `'jam 7 kopi 20rb'` → `many_amounts`; `'0 kopi'`, `'-5rb kopi'`, `'1.5.000 x'`, `'25rbu'`, `'1e6 x'`, `'1,25rb x'`, `'Rp.25.000'`-yang-tak-valid → `bad_amount`; `'200jt x'` dengan `maxAmount` 100000000 → `too_large`.
  - Keterangan dipangkas ke 200 karakter; angka Unicode non-ASCII → `bad_amount`.
- [ ] **Step 2:** `pnpm --filter @dompetku/web test -- parse` → FAIL (modul belum ada).
- [ ] **Step 3: Implementasi `parseMessage`.** Normalisasi: NFKC bukan dipakai (angka Unicode ditolak, bukan dikonversi), huruf kecil, spasi rapat. Tokenisasi per spasi; token nominal = regex ketat `^\+?(rp\.?)?\d{1,3}(\.\d{3})*|\d+(,\d+)?(rb|k|jt)?$` (rumusan akhir ditentukan implementer agar semua baris tes lulus). Satu token nominal; lebih → `many_amounts`; token mirip angka yang gagal → `bad_amount`. `rb`/`k` ×1000, `jt` ×1.000.000, hasil harus bilangan bulat positif. Penanda: `+` atau kata `gaji|masuk|terima|pemasukan` → income; `b` sebagai kata pertama atau kata `bersama` → shared; penanda dibuang dari keterangan.
- [ ] **Step 4:** tes lulus. `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(wa): parser pesan Catat WhatsApp`.

### Task 2: Migrasi DB, fungsi, dan pgTAP

**Files:**
- Create: `packages/db/migrations/0123_wa_catat.sql` (header `-- migrate:up`, komentar pola migrasi lain; sertakan `-- migrate:down` bila pola repo memakainya)
- Create: `packages/db/tests/26_wa.sql`
- Modify: `packages/db/roles/00_roles.sql` (matriks hak), `packages/db/tests/00_katalog.sql` dan daftar reserved audit di `private`/`audit.log` (ikuti 0006 dan `04_audit.sql`) bila perlu agar tes katalog lulus

**Interfaces — Produces (kontrak untuk Task 4, 5, 6):**
- Tabel `app.wa_links(user_id uuid primary key, phone_e164 text not null unique, verified_at timestamptz not null)`; `app.wa_link_codes(user_id uuid primary key, code_hash text not null, expires_at timestamptz not null)`; `app.wa_messages(message_id text primary key, user_id uuid not null, entry_id uuid null, status text not null check (status in ('recorded','rejected','cancelled','ignored')), created_at timestamptz not null default now())` — tanpa kolom teks mentah. RLS `own` (`user_id = app.current_user_id()`), tanpa DML langsung untuk `dompetku_web` selain lewat fungsi.
- `api.wa_create_link_code() returns jsonb` → `{code text, expires_at timestamptz}`; user terotentikasi; kode 6 karakter dari alfabet tanpa karakter ambigu; menimpa kode lama; hanya hash disimpan.
- `api.wa_confirm_link(p_code text, p_phone text) returns uuid` (DEFINER, tanpa konteks user) → `user_id` bila kode cocok, belum kedaluwarsa; menyimpan nomor (E.164), menghapus kode, mengganti nomor lama user itu, menulis event audit `wa_linked`; kembalikan `null` tanpa membedakan sebab. Anti tebak-kode ada di web (batas laju `hubung`, Task 4), bukan di DB.
- `api.wa_resolve_sender(p_phone text) returns uuid` (DEFINER) → `user_id` atau `null`.
- `api.wa_unlink() returns void` (user) + event audit `wa_unlinked`.
- `api.wa_default_account(p_space_id uuid) returns uuid` (INVOKER; aturan spec 4.4: dompet aktif yang paling baru dipakai user di ruang itu, selain itu dompet aktif pertama menurut `sort_order, created_at`).
- `api.wa_claim_message(p_message_id text) returns boolean` → true bila baris baru (insert … on conflict do nothing); dipanggil dengan konteks user.
- `api.wa_finish_message(p_message_id text, p_status text, p_entry_id uuid default null) returns void`.
- `api.wa_last_cancellable() returns jsonb` → `{entry_id, version}` untuk pesan `recorded` terakhir user dalam 10 menit (`now()`), entri masih hidup dan `version` tidak berubah sejak dicatat; selain itu `null`.

- [ ] **Step 1: pgTAP gagal dulu** (`26_wa.sql`, tag ID bila perlu di REGISTRY): hubungkan→resolve mengembalikan user yang benar; kode kedaluwarsa, salah, dan dipakai ulang → `null`; nomor tak terhubung → `null` tanpa efek samping; user B tidak bisa membaca/menulis baris user A (RLS); nomor unik (satu nomor tidak bisa untuk dua user); `wa_claim_message` kedua kali dengan id sama → false; `wa_last_cancellable` null setelah 10 menit atau setelah entri diubah/void; `wa_default_account` mengikuti aturan 4.4; `wa_confirm_link`/`wa_resolve_sender` hanya `EXECUTE` untuk `dompetku_web` (cek `has_function_privilege`); event `wa_linked`/`wa_unlinked` ada di daftar reserved dan tes katalog lulus.
- [ ] **Step 2:** jalankan pgTAP lokal (`docs/superpowers/handoff/db-reset-lokal.sh` lalu runner pgTAP seperti job CI `db`; ikuti `packages/db/README.md`) → FAIL.
- [ ] **Step 3:** tulis migrasi 0123 sesuai kontrak di atas. Normalisasi nomor ke E.164 dilakukan web (Task 5); DB hanya memeriksa pola `^\+[1-9][0-9]{7,14}$`.
- [ ] **Step 4:** semua pgTAP lulus (termasuk `00_katalog` dan `04_audit`); `pnpm test:registry` lulus.
- [ ] **Step 5:** Commit `feat(db): migrasi 0123 tautan nomor WhatsApp, dedupe pesan, fungsi api.wa_*`.

### Task 3: Konfigurasi dan transport OpenWA

**Files:**
- Create: `apps/web/src/server/wa/config.ts`, `apps/web/src/server/wa/transport.ts`, `apps/web/src/server/wa/openwa.ts`
- Test: `apps/web/src/server/wa/config.test.ts`, `apps/web/src/server/wa/openwa.test.ts`
- Modify: `apps/web/src/server/env.ts` tidak diubah; tambah contoh variabel di `infra/db-vm/env/web.env.example` dan `.env.example` (nama: `WA_WEBHOOK_SECRET`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION`, `WA_MAX_AMOUNT`, `WA_RATE_PER_MIN`)

**Interfaces — Produces:**
```ts
export interface WaEnv { webhookSecret: string; openwaUrl: string; apiKey: string; session: string; maxAmount: number; ratePerMin: number }
export function readWaEnv(env?: Record<string, string | undefined>): WaEnv | null; // null = fitur mati (semua kosong); sebagian terisi = EnvError
export interface InboundMessage { messageId: string; from: string; chatType: 'private' | 'group' | 'other'; fromMe: boolean; text: string | null }
export interface WaTransport {
  verify(rawBody: string, headers: Headers): boolean;       // HMAC waktu-tetap
  toInbound(rawBody: string): InboundMessage | null;        // null = bukan event pesan masuk
  sendText(toPhoneE164: string, text: string): Promise<void>;
}
export function createOpenWaTransport(env: WaEnv, fetchImpl?: typeof fetch): WaTransport;
```

- [ ] **Step 1:** Baca dokumentasi OpenWA (`https://github.com/rmyndharis/OpenWA` dan Swagger-nya) untuk **nama header tanda tangan HMAC, algoritma, bentuk payload `message.received`, endpoint dan body send-text, dan header API key**. Catat hasilnya sebagai fixture JSON di `apps/web/src/server/wa/__fixtures__/` dan di `docs/ops/runbook-wa.md` (Task 7). Bila host tidak terjangkau dari sesi, minta pemilik membuka `github.com` atau menempelkan halaman API, jangan menebak.
- [ ] **Step 2:** Tes gagal: `readWaEnv` null saat kosong, `EnvError` saat sebagian; `verify` menerima tanda tangan benar dan menolak yang salah/hilang/tidak sama panjang; `toInbound` untuk fixture pesan pribadi, grup, `fromMe`, non-teks, dan event non-pesan; `sendText` memanggil URL+header yang benar dan melempar pada status non-2xx (tanpa membocorkan API key di pesan galat).
- [ ] **Step 3:** Implementasi sesuai antarmuka; perbandingan HMAC dengan `crypto.timingSafeEqual`.
- [ ] **Step 4:** tes lulus; `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(wa): konfigurasi dan transport OpenWA`.

### Task 4: `handleInbound` (orkestrasi, melawan Postgres sungguhan)

**Files:**
- Create: `apps/web/src/server/wa/handle.ts`, `apps/web/src/server/wa/phone.ts`, `apps/web/src/server/wa/ratelimit.ts`, `apps/web/src/server/wa/uuid.ts`
- Test: `apps/web/src/server/wa/__int__/handle.int.test.ts` (pola `server/ledger/__int__`, dijalankan `test:int`), `phone.test.ts`, `ratelimit.test.ts`, `uuid.test.ts`

**Interfaces:**
- Consumes: `parseMessage` (Task 1), `WaTransport`/`InboundMessage`/`WaEnv` (Task 3), fungsi `api.wa_*` (Task 2), `createEntry`/`voidEntry` dan `LedgerCtx` dari `server/ledger/write.ts`, `resolveSpace` dari `server/ledger/space.ts`, `api.suggest_categories` (migrasi 0107; baca tanda tangannya), `withUser`/`withLedger`.
- Produces:
  ```ts
  export function toE164(raw: string): string | null;            // '+62…','62…','08…','…@c.us','…@s.whatsapp.net' → '+62…'; '@lid' atau tak valid → null
  export function uuidV5(namespace: string, name: string): string; // node:crypto, tanpa dependensi baru
  export function createRateLimiter(max: number, windowMs: number, now?: () => number): { allow(key: string): boolean };
  export interface WaDeps { pools: Pools; transport: WaTransport; env: WaEnv; limiter: ReturnType<typeof createRateLimiter>; linkLimiter: ReturnType<typeof createRateLimiter> }
  export async function handleInbound(deps: WaDeps, msg: InboundMessage): Promise<void>; // tidak pernah melempar ke pemanggil; galat sistem → balasan ⚠️ bila bisa, dicatat log tanpa isi pesan
  ```
- `clientId` entri = `uuidV5(<namespace tetap>, msg.messageId)`.

- [ ] **Step 1: Tes int gagal** (Given/When/Then spec bagian 7, tiap satu `it`): nomor terhubung + `25rb makan siang` → satu entri expense 25000 di Pribadi, kategori dari saran atau "Lainnya", balasan memuat `✅` dan `batal`; pesan identik dua kali (berurutan dan `Promise.all`) → tepat satu entri; `batal` dalam 10 menit → entri void, balasan `↩️`; `batal` sesudah 10 menit atau setelah entri diubah → tidak ada perubahan, balasan menunjuk ke app; **webhook ulang untuk pesan yang sudah dibatalkan → tidak ada entri baru dan tidak ada balasan** (Review Focus 1); `b 80rb belanja` → ruang Bersama; nomor tidak terhubung → tidak ada baris ledger dan balasan tautan maksimum sekali per jam; `hubung KODE` valid → terhubung, balasan konfirmasi; `beli 2 kopi 50rb` → tidak ada entri, balasan memuat contoh format; percobaan `hubung` ke-6 dalam satu jam dari nomor sama (atau ke-31 global) → ditolak walau kodenya benar; nominal di atas `maxAmount` → ditolak "gunakan app"; lewat batas laju → tidak diproses, tanpa balasan; `transport.sendText` melempar → entri tetap tersimpan, `handleInbound` tidak melempar (Review Focus 5); log tidak memuat teks pesan (spy pada logger).
- [ ] **Step 2:** tes unit gagal untuk `toE164` (semua format Review Focus 4, termasuk `@lid` → `null`), `uuidV5` (vektor RFC 4122 tetap, deterministik), `createRateLimiter` (batas dan jendela dapat diatur, kunci terpisah, jendela bergeser).
- [ ] **Step 3:** Implementasi. Urutan di `handleInbound`: `toE164` → batas laju per nomor mentah (sebelum `wa_resolve_sender`, supaya nomor asing pun dibatasi) → `wa_resolve_sender` → `parseMessage` → untuk `link`: `linkLimiter` (5 percobaan/jam per nomor dan 30/jam global, kunci `'*'`) lalu `wa_confirm_link` → `wa_claim_message` (bila id sudah ada: berhenti tanpa efek dan tanpa balasan) → `resolveSpace` + `wa_default_account` + saran kategori → `createEntry` → `wa_finish_message` → `sendText`. Kegagalan DB sementara → balasan `⚠️ Gagal menyimpan, coba lagi sebentar lagi` dan pesan boleh dikirim ulang (idempoten).
- [ ] **Step 4:** `pnpm test`, `pnpm test:int`, lint, typecheck lulus.
- [ ] **Step 5:** Commit `feat(wa): handleInbound, normalisasi nomor, dedupe, batas laju`.

### Task 5: Route webhook

**Files:**
- Create: `apps/web/src/app/api/wa/webhook/route.ts`
- Test: `apps/web/src/app/api/wa/webhook/route.test.ts`

**Interfaces:**
- Consumes: `readWaEnv`, `createOpenWaTransport`, `handleInbound`, `createPools` (lihat `server/db.ts`).
- Produces: `export async function POST(req: Request): Promise<Response>`; `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Tes gagal:** fitur mati (`readWaEnv` null) → 404; HMAC salah/hilang → 401 dan `handleInbound` tidak dipanggil; event non-pesan → 200 tanpa efek; grup, `fromMe`, non-teks, status/siaran → 200 tanpa `handleInbound` (Review Focus 3); pesan pribadi sah → `handleInbound` dipanggil sekali dengan `InboundMessage` yang benar dan respons 200 walau `handleInbound` mencatat galat; body > 64 kB → 413.
- [ ] **Step 2:** Implementasi: baca `await req.text()` mentah (HMAC atas body mentah), verifikasi sebelum parse JSON, `Cache-Control: no-store`. Pool dibuat lazy sekali per proses (ikuti pola modul auth).
- [ ] **Step 3:** tes lulus; lint, typecheck. Pastikan `middleware`/CSRF proteksi yang ada tidak memblokir POST ini (periksa `src/middleware.ts` atau `proxy.ts` bila ada, dan `lib/security-headers.ts`); bila ada, kecualikan hanya `/api/wa/webhook` dengan tes.
- [ ] **Step 4:** Commit `feat(wa): route webhook OpenWA dengan HMAC`.

### Task 6: UI "WhatsApp" (hubungkan/putuskan)

**Files:**
- Create: `apps/web/src/app/[ruang]/whatsapp/page.tsx`, `apps/web/src/app/[ruang]/_actions/wa.ts` (server action `createLinkCode`, `unlinkWa`), `apps/web/src/features/wa/wa-link-view.tsx` + tes
- Modify: `apps/web/src/features/shell/menu-sheet.tsx` (item "WhatsApp", hanya mode nyata) dan `hrefs.ts` bila pola rute mewajibkan

**Interfaces:** Consumes `api.wa_create_link_code`, `api.wa_unlink`, tabel `app.wa_links` (baca status). Produces halaman: status terhubung (nomor dimaskir `+62 812••••89`), tombol Hubungkan (menampilkan kode, instruksi "kirim `hubung KODE` ke nomor bot", hitung mundur 10 menit), tombol Putuskan.

- [ ] **Step 1:** Tes komponen gagal (status belum/sudah terhubung, kode tampil, putuskan memanggil action) dan tes action (memanggil `requireDataUser()` dan `withUser`; user lain tidak bisa memutus tautan orang lain).
- [ ] **Step 2:** Implementasi. Aturan M1: page memanggil `requireDataUser()`, semua kueri lewat `withUser`. Mode prototipe/demo tidak memuat modul ini (cek `NEXT_PUBLIC_PROTOTYPE`; tidak ada impor dari bundle prototipe). Nomor bot yang ditampilkan dari env `WA_BOT_NUMBER` (tambahkan di Task 3 contoh env, opsional; tanpanya instruksi tanpa nomor).
- [ ] **Step 3:** Arah visual `DESIGN.md` (Panel Malam), antislop mode DURING, kursi design reviewer, jalankan Delivery Gate antislop sebelum menyerahkan. Tangkap screenshot untuk portofolio bila ada pola e2e screenshot.
- [ ] **Step 4:** `pnpm build` dan baca laporan budget JS: rute baru di bawah 162 kB; Beranda prototipe 161,7 dan nyata 157,5 kB tidak naik. Tes e2e prototipe tetap lulus.
- [ ] **Step 5:** Commit `feat(wa): halaman hubungkan WhatsApp`.

### Task 7: Infra container, runbook, dan deployer

**Files:**
- Modify: `infra/db-vm/compose.yml` (service `openwa`, network `wa` dan `wa_egress`, `web` bergabung ke `wa`), skrip deployer di `infra/db-vm/deploy/` (pola worker: lewati `openwa` bila `env/openwa.env` belum ada), `infra/db-vm/deploy` tes `deploy-test.sh`
- Create: `infra/db-vm/env/openwa.env.example`, `docs/ops/runbook-wa.md`

**Interfaces:** Consumes variabel Task 3. Produces service `openwa` yang bisa dijangkau web di `http://openwa:<port>` (port dari fixture Task 3 Step 1) dan memanggil `http://web:3000/api/wa/webhook`.

- [ ] **Step 1:** Tambah service sesuai spec 5.1: image OpenWA diikat digest `linux/arm64` (cari digest rilis stabil terbaru, catat versi), `ENGINE_TYPE=baileys`, SQLite di volume `openwa_data`, `read_only` + tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` awal 512m, `cpus` 0.5, `pids_limit`, profil `web`. Network `wa` (`internal: true`, subnet dipatok di luar pool Docker, mis. `172.16.26.0/24`, periksa tidak bentrok dengan `172.16.25.0/24` dan `172.24.0.0/16`) hanya `openwa` dan `web`; `wa_egress` hanya `openwa`. Tidak ada port host. Dasbor tidak dipublikasikan.
- [ ] **Step 2:** `docker compose -f infra/db-vm/compose.yml config -q` lulus (profil `web`); perluas `deploy-test.sh` (25 asersi saat ini) untuk: `openwa` dilewati tanpa `openwa.env`, tidak menggagalkan deploy web, dan `openwa` bukan bagian rollback web.
- [ ] **Step 3:** Tulis `docs/ops/runbook-wa.md`: SIM khusus; isi `env/openwa.env` dan tambahan `web.env` langsung di VM (tidak lewat chat); scan QR lewat SSH tunnel sementara ke loopback; daftarkan webhook ke `http://web:3000/api/wa/webhook` dengan rahasia HMAC; tes kirim pesan; sesi putus (scan ulang); putuskan nomor; rollback (hapus `openwa.env`); risiko banned dan nomor khusus; catatan backup volume `openwa_data` (kredensial sesi = kunci akun WA; izin 0600, ikut daftar jaga akses).
- [ ] **Step 4:** Tambahkan image OpenWA ke cakupan `osv-scanner` bila pola `osv-scanner.toml` memungkinkan; catat di `docs/ops/ci-keamanan.md`.
- [ ] **Step 5:** Commit `feat(infra): container openwa, network wa, runbook-wa`.

### Task 8: Dokumen, gerbang penuh, dan review

**Files:** Modify `docs/product/BSD.md` §16 (tambah "Catatan WA": fungsi `api.wa_*`, tabel, event audit), `CLAUDE.md` (status), `packages/db/tests/REGISTRY.md` bila ID baru; Create `docs/superpowers/handoff/wa.md` (serah-terima + langkah pemilik: SIM, `openwa.env`, scan QR, deploy).

- [ ] **Step 1:** Perbarui dokumen di atas; spec bagian 10 diperbarui bila ada keputusan yang berubah saat implementasi.
- [ ] **Step 2:** Gerbang penuh: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, `pnpm test:int`, pgTAP, `pnpm test:registry`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`. Semua hijau; catat angka tes baru di handoff.
- [ ] **Step 3:** Review akhir seluruh branch (task + keamanan: HMAC, pemetaan nomor, RLS fungsi DEFINER, log, batas laju, jaringan container). Perbaiki temuan sampai bersih.
- [ ] **Step 4:** Push, pastikan CI hijau di head PR #27, perbarui deskripsi PR (bukan lagi hanya dokumen). **Jangan merge**: merge = deploy + migrasi produksi; tunggu keputusan pemilik dan langkah pemilik di handoff.
- [ ] **Step 5:** Commit `docs(wa): BSD §16, status, handoff`.

---

## Self-review (dijalankan)

- **Cakupan spec:** 4.1 → Task 1; 4.2 → Task 4; 4.3 → Task 2, 4, 6; 4.4 → Task 2 (`wa_default_account`); 5.1 → Task 7; 5.2 → Task 4, 5; 5.3 → Task 2, 4; 5.4 → Task 3; 5.5 → Task 2; 5.6 → Task 6; bagian 6 keamanan → Task 2, 4, 5, 7, 8; P1 (kemarin, saldo, dompet bawaan, pemantauan sesi) sengaja di luar plan. Event audit reserved → Task 2.
- **Konsistensi tipe:** `InboundMessage`, `WaTransport`, `WaEnv`, `ParseResult`, nama fungsi `api.wa_*` identik di semua task.
- **Risiko yang diakui plan:** bentuk webhook/HMAC OpenWA belum diverifikasi (Task 3 Step 1 wajib dulu); tanda tangan `api.suggest_categories` dan aturan middleware/CSRF dibaca implementer; `uuidV5` dibuat sendiri agar tanpa dependensi baru.
