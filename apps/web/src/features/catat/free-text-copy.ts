import type { FreeTextErrorCode, FreeTextSourceKind } from './source';

/**
 * Salinan final S17 — Catat teks bebas (`docs/design/s17-bingkai.md`).
 * Bahasa Indonesia, tanpa `!`, tanpa `Rp 0`, tanpa emoji, tanpa istilah Inggris terlarang.
 */

export const FREE_TEXT_COPY = {
  label: 'Ketik cepat',
  placeholder: 'Misal: makan 35rb bca',
  action: 'Isi',
  loading: 'Membaca…',
  previewBanner(source: FreeTextSourceKind): string {
    if (source === 'gemini') {
      return 'Terbaca dengan Gemini. Periksa isian di bawah sebelum simpan.';
    }
    if (source === 'anthropic') {
      return 'Terbaca dengan Claude. Periksa isian di bawah sebelum simpan.';
    }
    return 'Terbaca otomatis. Periksa isian di bawah sebelum simpan.';
  },
  quotaRemaining(remaining: number, limit: number): string {
    return `Sisa bantuan AI hari ini: ${String(remaining)} dari ${String(limit)}.`;
  },
  quotaExhaustedNote:
    'Kuota AI hari ini habis. Format langsung seperti "makan siang 35rb bca" tetap bisa dipakai.',
  errorMessage(code: FreeTextErrorCode): string {
    switch (code) {
      case 'empty':
      case 'no_amount':
        return 'Nominal belum terbaca. Coba tulis misalnya "makan siang 35rb bca".';
      case 'too_large':
        return 'Nominal terlalu besar. Periksa lagi angka yang ditulis.';
      case 'future_date':
        return 'Tanggal di masa depan belum didukung. Pakai tanggal hari ini atau sebelumnya.';
      case 'too_old_date':
        return 'Tanggal terlalu jauh ke belakang. Pilih tanggal langsung di kolom Tanggal.';
      case 'bad_date':
        return 'Format tanggal belum dikenali. Coba tulis "kemarin" atau "tgl 5 nov".';
      case 'quota_exceeded':
        return 'Kuota AI hari ini habis. Format langsung seperti "makan siang 35rb bca" tetap bisa dipakai.';
      case 'network':
        return 'Belum bisa membaca kalimat. Isi manual atau coba lagi.';
    }
  },
} as const;
