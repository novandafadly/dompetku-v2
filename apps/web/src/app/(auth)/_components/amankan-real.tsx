'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CheckIcon } from '@/components/ui/icons/check';
import { DeviceMobileIcon } from '@/components/ui/icons/device-mobile';
import { EnvelopeSimpleIcon } from '@/components/ui/icons/envelope-simple';
import { FingerprintIcon } from '@/components/ui/icons/fingerprint';
import { focusRing } from '@/components/ui/styles';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { PasswordField } from '@/features/auth/password-field';
import {
  finishSecuringAction,
  passkeyRegisterAction,
  passkeyRegisterOptionsAction,
  recoveryCodesAction,
  resendVerificationAction,
  signOutAction,
  totpBeginAction,
  totpConfirmAction,
  type FormState,
  type TotpSetupState,
} from '@/server/auth/actions';
import { CodeField } from './code-field';
import { Notice } from './notice';
import { createCredential } from './passkey';

export type SecuringStep = 'verifikasi-email' | 'faktor' | 'pemulihan';

const IDLE: FormState = { kind: 'idle' };

/** Dua langkah: faktor masuk (passkey atau kode 6 digit), lalu kode pemulihan. */
function Stepper({ current }: { current: 'faktor' | 'pemulihan' }) {
  const steps = [
    { key: 'faktor', label: 'Cara masuk' },
    { key: 'pemulihan', label: 'Kode pemulihan' },
  ] as const;
  const at = current === 'faktor' ? 0 : 1;
  return (
    <ol aria-label={`Langkah ${String(at + 1)} dari 2`} className="grid grid-cols-2 gap-2">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at ? 'step' : undefined}
          className="flex flex-col gap-2"
        >
          <span
            aria-hidden="true"
            className={`h-1 rounded-full ${i <= at ? 'bg-accent' : 'bg-surface-3'}`}
          />
          <span
            className={`flex items-center gap-1 text-label ${
              i === at ? 'font-extrabold text-text' : 'font-medium text-text-muted'
            }`}
          >
            {i < at ? (
              <CheckIcon size={14} weight="bold" className="shrink-0 text-accent-text" />
            ) : null}
            {`${String(i + 1)}. ${s.label}`}
            {i < at ? <span className="sr-only"> (selesai)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SignOut() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="text" size="sm">
        Keluar
      </Button>
    </form>
  );
}

function VerifyEmail({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendVerificationAction, IDLE);
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-accent-tint text-accent-text"
      >
        <EnvelopeSimpleIcon size={26} />
      </span>
      <AuthTitle>Konfirmasi email dulu</AuthTitle>
      <AuthText>
        Kami mengirim tautan konfirmasi ke {email}. Buka tautan itu, lalu muat ulang halaman ini.
      </AuthText>
      {state.kind === 'done' ? <Notice tone="ok">{state.message}</Notice> : null}
      {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
      <form action={action}>
        <Button type="submit" variant="secondary" loading={pending}>
          Kirim ulang tautan
        </Button>
      </form>
      <SignOut />
    </>
  );
}

function TotpSetup({ onBack }: { onBack: () => void }) {
  const [setup, begin, beginPending] = useActionState(totpBeginAction, IDLE as TotpSetupState);
  const [confirm, confirmAction, confirmPending] = useActionState(totpConfirmAction, IDLE);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const secretId = useId();

  if (setup.kind !== 'scan')
    return (
      <>
        <AuthTitle>Pakai aplikasi autentikator</AuthTitle>
        <AuthText>
          Ketik kata sandi sekali lagi untuk menyiapkan kode 6 digit dari aplikasi seperti Google
          Authenticator, Aegis, atau 2FAS.
        </AuthText>
        <form action={begin} noValidate className="flex flex-col gap-4">
          <PasswordField
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={setup.kind === 'error' ? setup.message : undefined}
          />
          <Button type="submit" size="lg" loading={beginPending}>
            Lanjut
          </Button>
        </form>
        <Button variant="text" onClick={onBack}>
          Kembali ke passkey
        </Button>
      </>
    );

  return (
    <>
      <AuthTitle>Pindai kode ini</AuthTitle>
      <AuthText>
        Buka aplikasi autentikator, tambah akun, lalu pindai kode QR. Tidak bisa memindai? Ketik
        kunci di bawahnya.
      </AuthText>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-surface-2 p-4">
        <svg
          role="img"
          aria-label="Kode QR untuk aplikasi autentikator"
          viewBox={`0 0 ${String(setup.qrSize)} ${String(setup.qrSize)}`}
          className="size-48 rounded-md"
          shapeRendering="crispEdges"
        >
          {/* Hitam di atas putih di kedua tema: pemindai QR butuh kontras ini. */}
          <rect width="100%" height="100%" fill="#fff" />
          <path d={setup.qrPath} fill="#000" />
        </svg>
        <p id={secretId} className="text-caption font-semibold text-text-soft">
          Kunci manual
        </p>
        <code
          aria-describedby={secretId}
          className="text-center text-label font-bold tabular-nums break-all text-text"
        >
          {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
        </code>
      </div>
      <form action={confirmAction} noValidate className="flex flex-col gap-4">
        <CodeField value={code} onChange={setCode} invalid={confirm.kind === 'error'} />
        {confirm.kind === 'error' ? <Notice tone="error">{confirm.message}</Notice> : null}
        <Button type="submit" size="lg" disabled={code.length !== 6} loading={confirmPending}>
          Verifikasi
        </Button>
      </form>
    </>
  );
}

const PASSKEY_ERROR = {
  unsupported: 'Perangkat ini belum mendukung passkey. Pakai aplikasi autentikator.',
  cancelled: 'Passkey dibatalkan. Coba lagi, atau pakai aplikasi autentikator.',
  failed: 'Passkey tidak bisa disimpan. Coba lagi, atau pakai aplikasi autentikator.',
  stale:
    'Sesi ini sudah lebih dari 10 menit. Keluar, masuk lagi, lalu tambah passkey; atau pakai aplikasi autentikator.',
} as const;

function Factor({ recovery }: { recovery: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'passkey' | 'totp'>('passkey');
  const [error, setError] = useState<keyof typeof PASSKEY_ERROR | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <Stepper current="faktor" />
      {mode === 'totp' ? (
        <TotpSetup
          onBack={() => {
            setMode('passkey');
          }}
        />
      ) : (
        <>
          <AuthTitle>{recovery ? 'Daftarkan cara masuk baru' : 'Amankan akunmu'}</AuthTitle>
          <AuthText>
            {recovery
              ? 'Kamu masuk dengan kode pemulihan. Daftarkan passkey atau aplikasi autentikator di perangkat ini sebelum membuka data.'
              : 'Masuk berikutnya cukup dengan sidik jari, wajah, atau PIN HP.'}
          </AuthText>
          <Button
            size="lg"
            loading={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const opts = await passkeyRegisterOptionsAction();
                if (opts.kind === 'stale') {
                  setError('stale');
                  return;
                }
                const r = await createCredential(opts.options);
                if ('error' in r) {
                  setError(r.error);
                  return;
                }
                if (await passkeyRegisterAction(r.response)) router.refresh();
                else setError('failed');
              });
            }}
          >
            <FingerprintIcon size={20} weight="bold" />
            Buat passkey
          </Button>
          {error ? <Notice tone="error">{PASSKEY_ERROR[error]}</Notice> : null}
          <Button
            variant="secondary"
            onClick={() => {
              setMode('totp');
            }}
          >
            <DeviceMobileIcon size={20} />
            Pakai aplikasi autentikator
          </Button>
        </>
      )}
      <SignOut />
    </>
  );
}

function RecoveryCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [creating, startCreate] = useTransition();
  const [state, finish, finishing] = useActionState(finishSecuringAction, IDLE);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const checkId = useId();

  return (
    <>
      <Stepper current="pemulihan" />
      <AuthTitle>Simpan kode pemulihan</AuthTitle>
      <AuthText>
        Tiap kode hanya berlaku sekali. Simpan di tempat yang aman, di luar HP ini. Kode ini jalan
        masuk bila passkey dan aplikasi autentikator hilang.
      </AuthText>
      {codes === null ? (
        <Button
          size="lg"
          loading={creating}
          onClick={() => {
            startCreate(async () => {
              setCodes(await recoveryCodesAction());
            });
          }}
        >
          Buat kode pemulihan
        </Button>
      ) : (
        <>
          <ul aria-label="Kode pemulihan" className="grid grid-cols-2 gap-2">
            {codes.map((c) => (
              <li
                key={c}
                className="num rounded-lg border border-hairline bg-surface-2 px-2 py-2.5 text-center text-body font-bold text-text"
              >
                {c}
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(codes.join('\n')).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Tersalin' : 'Salin semua kode'}
          </Button>
          <form action={finish} className="flex flex-col gap-4">
            <label
              htmlFor={checkId}
              className="flex min-h-11 cursor-pointer items-start gap-3 text-body font-medium text-text"
            >
              <input
                id={checkId}
                type="checkbox"
                name="saved"
                value="ya"
                checked={saved}
                onChange={(e) => {
                  setSaved(e.target.checked);
                }}
                className={`mt-0.5 size-5 shrink-0 accent-accent ${focusRing}`}
              />
              Saya sudah menyimpan kode ini di tempat yang aman.
            </label>
            {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
            <Button type="submit" size="lg" disabled={!saved} loading={finishing}>
              Selesai
            </Button>
          </form>
        </>
      )}
    </>
  );
}

export function AmankanReal({
  step,
  email,
  recovery,
}: {
  step: SecuringStep;
  email: string;
  recovery: boolean;
}) {
  if (step === 'verifikasi-email') return <VerifyEmail email={email} />;
  if (step === 'faktor') return <Factor recovery={recovery} />;
  return <RecoveryCodes />;
}
