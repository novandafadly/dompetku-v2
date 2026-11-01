import type { Route } from 'next';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { heroCard } from '@/components/ui/styles';
import { LinkButton } from '@/features/auth/link-button';

/**
 * Tautan undangan/reset yang tidak berlaku. Satu salinan untuk semua sebab (dipakai, ditolak,
 * dicabut, kedaluwarsa, salah) agar alasan tidak bocor (AFD §1).
 */
export function InvalidLink({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: { href: Route; label: string };
}) {
  return (
    <section role="alert" className={`flex flex-col items-start gap-3 p-5 ${heroCard}`}>
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-danger-tint text-danger"
      >
        <WarningCircleIcon size={26} />
      </span>
      <h1 className="text-headline font-extrabold text-text">{title}</h1>
      <p className="text-label font-medium text-pretty text-text-soft">{description}</p>
      <LinkButton href={action.href} variant="secondary">
        {action.label}
      </LinkButton>
    </section>
  );
}

export const INVALID_INVITE = {
  title: 'Undangan ini tidak berlaku',
  description:
    'Tautan sudah dipakai, ditolak, dicabut, atau lewat 72 jam. Minta pengundang mengirim undangan baru.',
  action: { href: '/masuk' as Route, label: 'Ke halaman Masuk' },
};
