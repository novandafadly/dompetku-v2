'use client';

import { useId, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { CheckIcon } from '@/components/ui/icons/check';
import { FingerprintIcon } from '@/components/ui/icons/fingerprint';
import { focusRing } from '@/components/ui/styles';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { useDemo } from '@/features/shell/demo-provider';

type Step = 'passkey' | 'totp' | 'pemulihan';

const STEPS: { key: Step; label: string }[] = [
  { key: 'passkey', label: 'Passkey' },
  { key: 'totp', label: 'Kode' },
  { key: 'pemulihan', label: 'Pemulihan' },
];

// Kode contoh tetap untuk prototipe; bukan rahasia.
const RECOVERY_CODES = [
  '4k7m-x2qd',
  'h9wt-3bnr',
  'p6vc-8ayf',
  'd2ze-m5ls',
  'q8jg-7tue',
  'n3xa-c4ko',
];

/** Stepper 3 bagian: bilah 4 px; selesai = ✓, sekarang = tebal, belum = redup. */
function Stepper({ current }: { current: Step }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <ol
      aria-label={`Langkah ${String(at + 1)} dari ${String(STEPS.length)}`}
      className="grid grid-cols-3 gap-2"
    >
      {STEPS.map((s, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={s.key} aria-current={now ? 'step' : undefined} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className={`h-1 rounded-full ${i <= at ? 'bg-accent' : 'bg-surface-3'}`}
            />
            <span
              className={`flex items-center gap-1 text-label ${
                now ? 'font-extrabold text-text' : 'font-medium text-text-muted'
              }`}
            >
              {done ? (
                <CheckIcon size={14} weight="bold" className="shrink-0 text-accent-text" />
              ) : null}
              {`${String(i + 1)}. ${s.label}`}
              {done ? <span className="sr-only"> (selesai)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Enam kotak 56 px di atas satu input nyata (tempel, isi otomatis OTP, dan pembaca layar tetap jalan). */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Kode 6 angka
      </label>
      <div className="relative">
        <div aria-hidden="true" className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, i) => {
            const active = focused && (i === value.length || (value.length === 6 && i === 5));
            return (
              <span
                key={i}
                className={`num flex h-14 items-center justify-center rounded-lg bg-bg text-headline font-extrabold text-text ${
                  active ? 'border-2 border-focus' : 'border border-border'
                }`}
              >
                {value[i] ?? ''}
              </span>
            );
          })}
        </div>
        <input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value.replace(/\D/g, '').slice(0, 6));
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent outline-none"
        />
      </div>
    </div>
  );
}

export default function AmankanPage() {
  const { href, authHref } = useDemo();
  const [step, setStep] = useState<Step>('passkey');
  const [code, setCode] = useState('');

  if (step === 'pemulihan') {
    return (
      <>
        <Stepper current="pemulihan" />
        <AuthTitle>Simpan kode pemulihan</AuthTitle>
        <AuthText>
          Tiap kode hanya berlaku sekali. Simpan di tempat yang aman, di luar HP ini. Kode ini
          satu-satunya jalan masuk bila passkey dan aplikasi autentikator hilang.
        </AuthText>
        <ul aria-label="Kode pemulihan" className="grid grid-cols-2 gap-2">
          {RECOVERY_CODES.map((c) => (
            <li
              key={c}
              className="num rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-body font-bold text-text"
            >
              {c}
            </li>
          ))}
        </ul>
        <LinkButton href={href('pribadi', 'beranda')}>Ke Beranda</LinkButton>
      </>
    );
  }

  if (step === 'totp') {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setStep('passkey');
          }}
          className={`-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-body font-bold text-accent-text hover-pointer:underline ${focusRing}`}
        >
          <CaretLeftIcon size={16} weight="bold" />
          Kembali
        </button>
        <Stepper current="totp" />
        <AuthTitle>Masukkan kode 6 digit</AuthTitle>
        <AuthText>Buka aplikasi autentikator, lalu ketik kode untuk DompetKu.</AuthText>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{6}$/.test(code)) return;
            setStep('pemulihan');
          }}
        >
          <CodeBoxes value={code} onChange={setCode} />
          <Button type="submit" disabled={code.length !== 6}>
            Verifikasi
          </Button>
        </form>
        <AuthText>Setelah ini kamu akan mendapat kode pemulihan untuk disimpan.</AuthText>
      </>
    );
  }

  return (
    <>
      <BackLink href={authHref('masuk')}>Kembali</BackLink>
      <Stepper current="passkey" />
      <AuthTitle>Amankan akunmu</AuthTitle>
      <AuthText>Masuk berikutnya cukup dengan sidik jari atau PIN HP.</AuthText>
      <Button
        size="lg"
        onClick={() => {
          setStep('totp');
        }}
      >
        <FingerprintIcon size={20} weight="bold" />
        Buat passkey
      </Button>
    </>
  );
}
