/**
 * Email transaksional lewat Resend (keputusan pemilik #5). Teks polos saja: tanpa HTML, tanpa
 * pelacak. Kunci API dari env (RESEND_API_KEY), tidak pernah di repo.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Isi respons tidak dicatat: bisa memuat alamat penerima.
    if (!res.ok) throw new Error(`Resend menolak email (HTTP ${String(res.status)})`);
  }
}

/** Pengganti di dev/tes: email tidak dikirim; tautan ditulis ke log server lokal. */
export class LogMailer implements Mailer {
  readonly sent: Mail[] = [];
  constructor(private readonly log = false) {}

  send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    if (this.log) console.info(`[email tidak dikirim] ${mail.subject}\n${mail.text}`);
    return Promise.resolve();
  }
}

/** Hanya tes e2e auth (AUTH_EMAIL_FILE): satu JSON per baris, dibaca Playwright. */
export class FileMailer implements Mailer {
  constructor(private readonly path: string) {}

  async send(mail: Mail): Promise<void> {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(this.path, `${JSON.stringify(mail)}\n`, { mode: 0o600 });
  }
}

const FOOTER = '\n\nDompetKu, aplikasi keuangan Novanda dan Farida.';

export const mails = {
  invitation(to: string, inviter: string, url: string): Mail {
    return {
      to,
      subject: `${inviter} mengundangmu ke DompetKu`,
      text:
        `${inviter} mengundangmu ke ruang Bersama di DompetKu.\n\n` +
        `Buka tautan ini dalam 72 jam:\n${url}\n\n` +
        'Tautan hanya bisa dipakai sekali. Jangan teruskan email ini ke orang lain. ' +
        `Kalau kamu tidak mengenal ${inviter}, abaikan email ini.` +
        FOOTER,
    };
  },
  resetPassword(to: string, url: string): Mail {
    return {
      to,
      subject: 'Atur ulang kata sandi DompetKu',
      text:
        'Ada permintaan atur ulang kata sandi untuk akun DompetKu dengan email ini.\n\n' +
        `Tautan berlaku 30 menit:\n${url}\n\n` +
        'Setelah kata sandi diganti, semua perangkat dikeluarkan. Passkey dan aplikasi ' +
        'autentikator tetap aktif.\n\n' +
        'Bukan kamu yang meminta? Abaikan email ini; kata sandimu tidak berubah.' +
        FOOTER,
    };
  },
  verifyEmail(to: string, url: string): Mail {
    return {
      to,
      subject: 'Konfirmasi email DompetKu',
      text:
        'Konfirmasi email ini untuk akun DompetKu-mu.\n\n' +
        `Tautan berlaku 24 jam:\n${url}\n\n` +
        'Bukan kamu yang mendaftar? Abaikan email ini.' +
        FOOTER,
    };
  },
  recoveryCodeUsed(to: string): Mail {
    return {
      to,
      subject: 'Kode pemulihan DompetKu baru saja dipakai',
      text:
        'Seseorang baru saja masuk ke akun DompetKu-mu dengan kode pemulihan. ' +
        'Semua perangkat lain sudah dikeluarkan.\n\n' +
        'Kalau itu kamu, lanjutkan mendaftarkan passkey atau aplikasi autentikator baru.\n\n' +
        'Kalau bukan kamu, atur ulang kata sandi sekarang dari halaman Masuk dan beri tahu ' +
        'pasanganmu.' +
        FOOTER,
    };
  },
  passwordPaused(to: string): Mail {
    return {
      to,
      subject: 'Masuk dengan kata sandi dijeda 1 jam',
      text:
        'Ada 20 percobaan kata sandi yang salah untuk akun DompetKu-mu. Masuk dengan kata ' +
        'sandi dijeda 1 jam.\n\n' +
        'Passkey dan kode pemulihan tetap bisa dipakai. Kalau bukan kamu yang mencoba, ' +
        'ganti kata sandi setelah masuk.' +
        FOOTER,
    };
  },
};
