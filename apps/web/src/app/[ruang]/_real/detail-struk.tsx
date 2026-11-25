'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InfoIcon } from '@/components/ui/icons/info';
import { PlusIcon } from '@/components/ui/icons/plus';
import { ReceiptIcon } from '@/components/ui/icons/receipt';
import { TrashIcon } from '@/components/ui/icons/trash';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_ENTRY,
  type AttachmentVM,
  type ReceiptMime,
} from '@/features/transaksi/struk-types';

export interface DetailStrukProps {
  ruang: Ruang;
  entryId: string;
  initialAttachments: AttachmentVM[];
  uploadEnabled: boolean;
  readOnly: boolean;
}

const MIME_LABEL: Record<ReceiptMime, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

const ERROR_COPY: Record<string, string> = {
  file_too_large: 'Ukuran foto terlalu besar. Batas maksimal 2 MB per foto.',
  invalid_image: 'Format berkas tidak didukung. Pakai foto JPG, PNG, atau WebP.',
  attachment_limit: 'Batas maksimal 3 foto struk untuk transaksi ini sudah tercapai.',
  entry_voided: 'Transaksi yang dibatalkan tidak bisa ditambah foto struk.',
  rate_limited: 'Terlalu banyak unggahan dalam satu jam. Coba lagi sebentar lagi.',
  not_configured: 'Simpan foto struk belum aktif di server ini.',
  not_found: 'Foto struk tidak ditemukan.',
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${String(kb)} KB`;
}

function strukUrl(ruang: Ruang, entryId: string, attachmentId?: string): string {
  const base = `/${ruang}/transaksi/${encodeURIComponent(entryId)}/struk`;
  return attachmentId === undefined ? base : `${base}/${encodeURIComponent(attachmentId)}`;
}

/**
 * Seksi Foto struk pada Detail transaksi mode nyata (S18-ST1).
 * Dimuat malas lewat `DetailStrukIsland` agar 0 byte di mode prototipe.
 * Foto disimpan terenkripsi AES-256-GCM di server dan tidak pernah di-cache offline.
 */
export function DetailStruk({
  ruang,
  entryId,
  initialAttachments,
  uploadEnabled,
  readOnly,
}: DetailStrukProps) {
  const router = useRouter();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AttachmentVM[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (readOnly && items.length === 0) return null;

  const canUpload = !readOnly && uploadEnabled && items.length < MAX_RECEIPTS_PER_ENTRY;

  async function handleFileChange(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStatus(null);
    if (file.size < 1 || file.size > MAX_RECEIPT_BYTES) {
      setError(ERROR_COPY.file_too_large ?? 'Ukuran foto terlalu besar.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(strukUrl(ruang, entryId), {
        method: 'POST',
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        attachment?: AttachmentVM;
        error?: string;
      };
      if (!res.ok || body.attachment === undefined) {
        const code = body.error ?? '';
        setError(ERROR_COPY[code] ?? 'Foto struk belum bisa diunggah. Coba lagi.');
        return;
      }
      const added = body.attachment;
      setItems((prev) => [...prev, added]);
      setStatus('Foto struk tersimpan terenkripsi.');
      router.refresh();
    } catch {
      setError('Koneksi terputus. Foto struk belum terkirim.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete(attachmentId: string) {
    setError(null);
    setStatus(null);
    setDeletingId(attachmentId);
    try {
      const res = await fetch(strukUrl(ruang, entryId, attachmentId), {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_COPY[body.error ?? ''] ?? 'Foto struk belum bisa dihapus. Coba lagi.');
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== attachmentId));
      setConfirmId(null);
      setStatus('Foto struk dihapus permanen.');
      router.refresh();
    } catch {
      setError('Koneksi terputus. Coba hapus lagi saat online.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section aria-label="Foto struk" className="flex flex-col gap-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-meta font-semibold text-text-soft">
          <ReceiptIcon size={15} className="shrink-0" />
          Foto struk
        </h2>
        <span className="text-caption font-medium text-text-muted tabular-nums">
          {`${String(items.length)} dari ${String(MAX_RECEIPTS_PER_ENTRY)}`}
        </span>
      </div>

      <div className={`flex flex-col gap-3 p-4 ${card}`}>
        {items.length > 0 ? (
          <ul aria-label="Daftar foto struk" className="flex flex-col">
            {items.map((item, idx) => {
              const url = strukUrl(ruang, entryId, item.id);
              const confirming = confirmId === item.id;
              const deleting = deletingId === item.id;
              return (
                <li
                  key={item.id}
                  className={`flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 ${rowDivider}`}
                >
                  <div className="flex items-center gap-3">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`group relative flex size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2 ${focusRing}`}
                      aria-label={`Buka foto struk ${String(idx + 1)} di tab baru`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob dekripsi dinamis no-store per request */}
                      <img
                        src={url}
                        alt={`Foto struk ${String(idx + 1)}`}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </a>
                    <div className="min-w-0 flex-1">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex min-h-11 items-center rounded-md text-body font-semibold text-text hover-pointer:text-accent-text hover-pointer:underline ${focusRing}`}
                      >
                        {`Struk ${String(idx + 1)}`}
                      </a>
                      <p className="text-caption font-medium text-text-muted">
                        {`${MIME_LABEL[item.mimeType]} · ${formatFileSize(item.byteSize)} · Terenkripsi`}
                      </p>
                    </div>
                    {!readOnly && !confirming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmId(item.id);
                          setError(null);
                          setStatus(null);
                        }}
                        aria-label={`Hapus foto struk ${String(idx + 1)}`}
                        className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover-pointer:bg-hover hover-pointer:text-danger ${focusRing}`}
                      >
                        <TrashIcon size={18} />
                      </button>
                    ) : null}
                  </div>
                  {confirming ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <p className="text-meta font-medium text-text-soft">
                        Hapus permanen foto ini?
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={deleting}
                          onClick={() => {
                            setConfirmId(null);
                          }}
                        >
                          Batal
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deleting}
                          onClick={() => {
                            void handleDelete(item.id);
                          }}
                        >
                          Hapus
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-meta font-medium text-text-muted">
            Belum ada foto struk. Simpan foto agar bukti transaksi tetap rapi dan terenkripsi.
          </p>
        )}

        {!readOnly ? (
          uploadEnabled ? (
            items.length < MAX_RECEIPTS_PER_ENTRY ? (
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileRef}
                  id={inputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Pilih foto struk"
                  className="sr-only"
                  disabled={!canUpload || uploading}
                  onChange={(e) => {
                    void handleFileChange(e.target.files?.[0]);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  loading={uploading}
                  className="self-start"
                  onClick={() => {
                    fileRef.current?.click();
                  }}
                >
                  <PlusIcon size={16} weight="bold" />
                  Tambah foto struk
                </Button>
                <p className="text-caption font-medium text-text-muted">
                  JPG, PNG, atau WebP · maks 2 MB · dienkripsi di server
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-caption font-medium text-text-muted">
                <InfoIcon size={14} className="shrink-0" />
                Maksimal 3 foto per transaksi sudah terpasang.
              </p>
            )
          ) : (
            <p className="flex items-center gap-1.5 text-meta font-medium text-text-muted">
              <InfoIcon size={14} className="shrink-0" />
              Simpan foto struk belum aktif di server ini.
            </p>
          )
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-meta font-semibold text-danger">
            {error}
          </p>
        ) : null}
        {status !== null ? (
          <p role="status" className="text-meta font-medium text-accent-text">
            {status}
          </p>
        ) : null}
      </div>
    </section>
  );
}
