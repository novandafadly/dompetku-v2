'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { LinkButton } from '@/features/auth/link-button';
import { useDemo } from '@/features/shell/demo-provider';

type Step = 'passkey' | 'totp' | 'pemulihan';

// Kode contoh tetap untuk prototipe; bukan rahasia.
const RECOVERY_CODES = [
  '4k7m-x2qd',
  'h9wt-3bnr',
  'p6vc-8ayf',
  'd2ze-m5ls',
  'q8jg-7tue',
  'n3xa-c4ko',
];

export default function AmankanPage() {
  const { href } = useDemo();
  const [step, setStep] = useState<Step>('passkey');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();

  if (step === 'pemulihan') {
    return (
      <>
        <h1 className="text-xl font-semibold text-text">Simpan kode pemulihan</h1>
        <p className="text-base text-text-muted">
          Tiap kode hanya berlaku sekali. Simpan di tempat yang aman, di luar HP ini. Kode ini
          satu-satunya jalan masuk bila passkey dan aplikasi autentikator hilang.
        </p>
        <ul aria-label="Kode pemulihan" className="grid grid-cols-2 gap-2">
          {RECOVERY_CODES.map((c) => (
            <li key={c} className="num rounded-field bg-surface px-3 py-2 text-base text-text">
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
        <p className="text-sm text-text-muted">Langkah 2 dari 2 · Kode cadangan (TOTP)</p>
        <h1 className="text-xl font-semibold text-text">Amankan akunmu</h1>
        <p className="text-base text-text-muted">
          Tambahkan DompetKu ke aplikasi autentikator, lalu masukkan kode 6 angka yang tampil di
          sana.
        </p>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{6}$/.test(code)) {
              setError('Masukkan 6 angka.');
              return;
            }
            setError(undefined);
            setStep('pemulihan');
          }}
        >
          <TextField
            label="Kode 6 angka"
            value={code}
            onChange={(v) => {
              setCode(v.replace(/\D/g, ''));
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={error}
          />
          <Button type="submit">Simpan dan lanjut</Button>
        </form>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-text-muted">Langkah 1 dari 2 · Passkey</p>
      <h1 className="text-xl font-semibold text-text">Amankan akunmu</h1>
      <p className="text-base text-text-muted">
        Masuk berikutnya cukup dengan sidik jari atau PIN HP.
      </p>
      <Button
        onClick={() => {
          setStep('totp');
        }}
      >
        Buat passkey
      </Button>
    </>
  );
}
