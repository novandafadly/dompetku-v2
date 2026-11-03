import type { Rupiah } from '@dompetku/domain';
import { MoneyText } from './money-text';
import { rowDivider } from './styles';

// Satu berkas per jenis baris: rute hanya memuat baris yang dipakainya (ADR 0002).

/** Aktivitas Bersama: avatar inisial 36 (N netral, F violet), kalimat, waktu, nominal. */
export function ActivityRow({
  initial,
  name,
  text,
  time,
  amount,
}: {
  initial: string;
  name: string;
  text: string;
  time: string;
  amount?: Rupiah | undefined;
}) {
  return (
    <li className={`flex min-h-15.5 items-center gap-3 py-2 ${rowDivider}`}>
      <span
        data-initial=""
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-label font-extrabold ${
          initial === 'F' ? 'bg-bersama-tint text-bersama' : 'bg-surface-3 text-text'
        }`}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label font-medium break-words text-text">
          <span className="font-bold">{name}</span> · {text}
        </span>
        <span className="text-caption font-medium text-text-muted">{time}</span>
      </span>
      {amount !== undefined ? <MoneyText value={amount} /> : null}
    </li>
  );
}
