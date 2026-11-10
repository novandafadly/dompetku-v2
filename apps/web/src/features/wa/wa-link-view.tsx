'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeviceMobileIcon } from '@/components/ui/icons/device-mobile';
import { card, heroCard } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import type { ActionResult, LedgerErrorCode } from '@/features/ledger/types';
import { LINK_CODE_MINUTES, WA_TITLE_ID } from './ids';

/**
 * Hubungkan/putuskan nomor WhatsApp (spec 4.3, 5.6). Pulau klien dimuat malas (tidak ikut JS rute
 * lain). Kode hubung hanya hidup di state komponen ini: tidak disimpan di tempat lain.
 * Aksi diterima lewat props supaya tampilan bisa diuji tanpa server.
 */

export type WaViewStatus =
  | { state: 'unlinked'; botNumber: string | null }
  | { state: 'linked'; masked: string; botNumber: string | null };

export interface WaLinkViewProps {
  status: WaViewStatus;
  createCode: () => Promise<ActionResult<{ code: string; expiresAt: string }>>;
  unlink: () => Promise<ActionResult<void>>;
  /** Muat ulang data server (status terhubung bisa berubah dari WhatsApp). */
  refresh: () => void;
}

const loadDialog = () => import('@/components/ui/confirm-dialog');
const ConfirmDialog = lazy(() => loadDialog().then((m) => ({ default: m.ConfirmDialog })));

const NETWORK = { ok: false, error: { code: 'network' } } as const;

export function createFailedText(code: LedgerErrorCode): string {
  if (code === 'network') return 'Kode belum bisa dibuat. Periksa koneksi lalu coba lagi.';
  return 'Kode belum bisa dibuat. Ada kendala di server.';
}

export function unlinkFailedText(code: LedgerErrorCode): string {
  if (code === 'network') return 'Belum bisa diputuskan. Periksa koneksi lalu coba lagi.';
  return 'Belum bisa diputuskan. Ada kendala di server.';
}

/** `m:ss`, dibulatkan ke atas supaya 0:00 hanya muncul saat kode sudah mati. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${s < 10 ? '0' : ''}${String(s)}`;
}

/** Sisa waktu kode (ms), diperbarui tiap detik; 0 = kedaluwarsa. */
function useRemaining(expiresAt: string | null): [number | null, () => void] {
  const [now, setNow] = useState(() => Date.now());
  const sync = useCallback(() => {
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [expiresAt]);
  if (expiresAt === null) return [null, sync];
  return [Math.max(0, new Date(expiresAt).getTime() - now), sync];
}

interface Issued {
  code: string;
  expiresAt: string;
}

export function WaLinkView({ status, createCode, unlink, refresh }: WaLinkViewProps) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const dialogMounted = useOpenedOnce(confirm);
  const [remaining, syncClock] = useRemaining(issued?.expiresAt ?? null);
  const expired = issued !== null && remaining === 0;
  const masked = status.state === 'linked' ? status.masked : null;
  const linked = masked !== null && !gone;

  // Kembali ke tab ini sesudah mengirim kode dari WhatsApp: ambil status terbaru.
  useEffect(() => {
    if (issued === null || expired) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [issued, expired, refresh]);

  // Status berubah jadi terhubung (kode terpakai): kode tidak perlu ditampilkan lagi.
  const wasLinked = useRef(linked);
  useEffect(() => {
    if (linked && !wasLinked.current) setIssued(null);
    wasLinked.current = linked;
  }, [linked]);

  // Sesudah putus, tombol Putuskan hilang: fokus ke judul begitu dialog lepas.
  useEffect(() => {
    if (!gone) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (document.querySelector('[role="alertdialog"]') === null || tries > 40) {
        document.getElementById(WA_TITLE_ID)?.focus();
        window.clearInterval(timer);
      }
    }, 60);
    return () => {
      window.clearInterval(timer);
    };
  }, [gone]);

  const onCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    let res: ActionResult<Issued>;
    try {
      res = await createCode();
    } catch {
      res = NETWORK;
    }
    setCreating(false);
    if (res.ok) {
      syncClock();
      setIssued(res.value);
    } else setCreateError(createFailedText(res.error.code));
  }, [creating, createCode, syncClock]);

  async function onUnlink() {
    if (unlinking) return;
    setUnlinking(true);
    setUnlinkError(null);
    let res: ActionResult<void>;
    try {
      res = await unlink();
    } catch {
      res = NETWORK;
    }
    setUnlinking(false);
    if (res.ok) {
      setConfirm(false);
      setGone(true);
      setIssued(null);
      toast({ message: 'WhatsApp diputuskan' });
      return;
    }
    setUnlinkError(unlinkFailedText(res.error.code));
  }

  const botTarget = status.botNumber ?? 'nomor bot DompetKu';

  return (
    <div className="flex flex-col gap-3 tablet:gap-4">
      <section aria-labelledby="wa-status" className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-soft"
          >
            <DeviceMobileIcon size={22} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 id="wa-status" className="text-body font-bold text-text">
              {linked ? 'Terhubung' : 'Belum terhubung'}
            </h2>
            {linked ? (
              <p className="text-label font-semibold text-text-soft tabular-nums">{masked}</p>
            ) : null}
          </div>
        </div>
        <p className="text-label font-medium text-text-soft text-pretty">
          {linked
            ? 'Kirim catatan dari nomor ini ke WhatsApp bot, misalnya 25rb makan siang.'
            : 'Hubungkan nomormu untuk mencatat lewat WhatsApp, misalnya 25rb makan siang.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={linked ? 'secondary' : 'primary'}
            aria-disabled={creating || undefined}
            aria-busy={creating || undefined}
            onClick={() => {
              void onCreate();
            }}
          >
            {creating ? 'Membuat kode…' : linked ? 'Ganti nomor' : 'Buat kode hubung'}
          </Button>
          {linked ? (
            <Button
              variant="danger"
              onClick={() => {
                setUnlinkError(null);
                setConfirm(true);
              }}
            >
              Putuskan
            </Button>
          ) : null}
        </div>
        {createError === null ? null : (
          <p role="alert" className="text-label font-semibold text-danger">
            {createError}
          </p>
        )}
      </section>

      {issued === null ? null : (
        <section aria-labelledby="wa-code" className={`flex flex-col gap-3 p-4 ${card}`}>
          <h2 id="wa-code" className="text-body font-bold text-text">
            {expired ? 'Kode kedaluwarsa' : 'Kirim pesan ini dari WhatsApp'}
          </h2>
          {expired ? (
            <p className="text-label font-medium text-text-soft text-pretty">
              Kode berlaku {String(LINK_CODE_MINUTES)} menit. Buat kode baru lalu kirim lagi.
            </p>
          ) : (
            <>
              <CodeBlock code={issued.code} />
              <p className="text-label font-medium text-text-soft text-pretty">
                Kirim ke <span className="font-bold text-text">{botTarget}</span> dari nomor yang
                ingin dihubungkan.
              </p>
              <p role="timer" className="text-label font-semibold text-text-soft tabular-nums">
                Berlaku {formatRemaining(remaining ?? 0)} lagi
              </p>
            </>
          )}
        </section>
      )}

      {dialogMounted ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={confirm}
            onOpenChange={(open) => {
              if (!unlinking) setConfirm(open);
            }}
            icon={<DeviceMobileIcon size={22} />}
            title="Putuskan WhatsApp?"
            description={`Pesan dari ${masked ?? 'nomor ini'} tidak dicatat lagi. Entri yang sudah tercatat tetap ada, dan kamu bisa menghubungkan lagi kapan saja.`}
            confirmLabel="Putuskan"
            cancelLabel="Kembali"
            holdOpen
            busy={unlinking}
            alert={unlinkError ?? undefined}
            onConfirm={() => {
              void onUnlink();
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Pesan lengkap `hubung KODE` dengan tombol salin; kode juga bisa dipilih dan disalin manual. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const message = `hubung ${code}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="rounded-lg bg-surface-2 px-4 py-3 text-title font-extrabold tracking-wider text-text select-all">
        <span className="font-semibold text-text-soft">hubung </span>
        <span data-testid="wa-code">{code}</span>
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void copy();
        }}
      >
        Salin pesan
      </Button>
      <p role="status" className="basis-full text-label font-semibold text-text-soft empty:hidden">
        {copied === 'ok'
          ? 'Tersalin'
          : copied === 'fail'
            ? 'Belum bisa menyalin. Ketik manual.'
            : ''}
      </p>
    </div>
  );
}
