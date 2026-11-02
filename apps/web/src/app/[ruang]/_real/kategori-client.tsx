'use client';

import { useRouter } from 'next/navigation';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { Tabs } from '@/components/ui/segmented-control';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { archivedToast } from '@/features/kategori/archive-dialog';
import type {
  CategoryFormMode,
  CategorySubmit,
  CategorySubmitResult,
} from '@/features/kategori/category-form';
import { AddCategoryButton, CategoryList } from '@/features/kategori/category-list';
import { CATEGORY_ROW_ATTR, KATEGORI_TITLE_ID } from '@/features/kategori/ids';
import type { CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { RUANG_LABEL, buildHref } from '@/features/shell/hrefs';
import { useNav } from '@/features/shell/nav-provider';
import {
  archiveCategoryAction,
  createCategoryAction,
  updateCategoryAction,
} from '../_actions/kategori';

/**
 * Layar Kategori nyata (pulau klien, dimuat malas lewat `kategori-islands`): tab jenis, daftar,
 * sheet tambah/ubah, dan dialog arsip. Sheet dan dialog dimuat saat pertama dipakai (pointer/fokus
 * di baris atau tombol = muat lebih awal). Setiap tulis = Server Action (`refresh()` memuat ulang
 * daftar); fokus kembali ke baris yang diubah atau baru, dan ke judul halaman sesudah arsip.
 */

const loadForm = () => import('@/features/kategori/category-form');
const CategoryForm = lazy(() => loadForm().then((m) => ({ default: m.CategoryForm })));
const loadArchive = () => import('@/features/kategori/archive-dialog');
const ArchiveDialog = lazy(() => loadArchive().then((m) => ({ default: m.ArchiveDialog })));
const preload = () => {
  void loadForm();
  void loadArchive();
};

type Type = 'expense' | 'income';
const TABS = [
  { value: 'expense', label: 'Pengeluaran' },
  { value: 'income', label: 'Pemasukan' },
];

const NETWORK = { ok: false, error: { code: 'network' } } as const;

/** Tujuan fokus sesudah tulis: baris kategori (id) atau judul halaman. */
type FocusTarget = { row: string } | 'title';

function archiveFailedText(code: LedgerErrorCode): string {
  if (code === 'network') return 'Belum bisa diarsipkan. Periksa koneksi lalu coba lagi.';
  if (code === 'not_found') return 'Kategori ini sudah tidak ada.';
  return 'Belum bisa diarsipkan. Ada kendala di server.';
}

/** Fokus ke tujuan begitu dialog/sheet sudah lepas (fokus-kembali Radix terjadi saat itu). */
function useFocusAfterClose(target: FocusTarget | null, done: () => void) {
  useEffect(() => {
    if (target === null) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') === null) {
        const el =
          target === 'title'
            ? document.getElementById(KATEGORI_TITLE_ID)
            : document.querySelector<HTMLElement>(
                `[${CATEGORY_ROW_ATTR}="${CSS.escape(target.row)}"]`,
              );
        if (el) {
          el.focus();
          window.clearInterval(timer);
          done();
          return;
        }
      }
      // Baris yang tidak pernah muncul (daftar belum tiba / sudah hilang): berhenti, jangan menggantung.
      if (tries > 40) {
        window.clearInterval(timer);
        done();
      }
    }, 60);
    return () => {
      window.clearInterval(timer);
    };
  }, [target, done]);
}

export interface KategoriManagerProps {
  ruang: Ruang;
  /** Kategori aktif ruang ini (kedua jenis). */
  categories: CategoryVM[];
}

export function KategoriManager({ ruang, categories }: KategoriManagerProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Type>('expense');
  const [form, setForm] = useState<{ open: boolean; mode: CategoryFormMode } | null>(null);
  const [archive, setArchive] = useState<{ open: boolean; category: CategoryVM } | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const formMounted = useOpenedOnce(form?.open === true);
  const archiveMounted = useOpenedOnce(archive?.open === true);
  const clearFocus = useCallback(() => {
    setFocus(null);
  }, []);
  useFocusAfterClose(focus, clearFocus);
  const label = RUANG_LABEL[ruang];

  const openAdd = () => {
    setForm({ open: true, mode: { kind: 'add', type: tab } });
  };

  async function submit(mode: CategoryFormMode, v: CategorySubmit): Promise<CategorySubmitResult> {
    try {
      if (mode.kind === 'add') {
        const res = await createCategoryAction(ruang, {
          clientId: v.clientId,
          type: mode.type,
          name: v.name,
          icon: v.icon,
          ...(v.parentId === null ? {} : { parentId: v.parentId }),
        });
        if (!res.ok) return { ok: false, code: res.error.code };
        setFocus({ row: res.value.categoryId });
      } else {
        const res = await updateCategoryAction(ruang, {
          categoryId: mode.category.id,
          name: v.name,
          icon: v.icon,
          parentId: v.parentId,
        });
        if (!res.ok) return { ok: false, code: res.error.code };
        setFocus({ row: mode.category.id });
      }
    } catch {
      return { ok: false, code: NETWORK.error.code };
    }
    toast({ message: `Kategori ${v.name} disimpan di ${label}` });
    return { ok: true };
  }

  async function confirmArchive(category: CategoryVM) {
    let res: Awaited<ReturnType<typeof archiveCategoryAction>> | typeof NETWORK;
    try {
      res = await archiveCategoryAction(ruang, { categoryId: category.id });
    } catch {
      res = NETWORK;
    }
    if (!res.ok) {
      if (res.error.code === 'not_found') router.refresh();
      toast({ message: archiveFailedText(res.error.code), tone: 'info' });
      return;
    }
    toast({ message: archivedToast(category.name, ruang) });
    setFocus('title');
  }

  const hasRoots = categories.some((c) => c.type === tab && c.parentId === null);
  return (
    <div className="flex flex-col gap-3 tablet:gap-4">
      <Tabs
        items={TABS}
        value={tab}
        onChange={(v) => {
          if (v === 'expense' || v === 'income') setTab(v);
        }}
        label="Jenis kategori"
        idBase="kategori"
      />
      <div
        role="tabpanel"
        id="kategori-panel"
        aria-labelledby={`kategori-tab-${tab}`}
        className="flex flex-col gap-3 tablet:gap-4"
      >
        {hasRoots ? (
          <AddCategoryButton
            onAdd={openAdd}
            onPreload={preload}
            className="w-full laptop:w-auto laptop:self-start"
          />
        ) : null}
        <CategoryList
          ruang={ruang}
          type={tab}
          categories={categories}
          onOpen={(category) => {
            setForm({ open: true, mode: { kind: 'edit', category } });
          }}
          onAdd={openAdd}
          onPreload={preload}
        />
      </div>
      {formMounted && form !== null ? (
        <Suspense fallback={null}>
          <CategoryForm
            open={form.open}
            onOpenChange={(open) => {
              setForm((f) => (f === null ? f : { ...f, open }));
            }}
            ruang={ruang}
            mode={form.mode}
            categories={categories}
            onSubmit={(v) => submit(form.mode, v)}
            onArchive={() => {
              if (form.mode.kind !== 'edit') return;
              const category = form.mode.category;
              // Sheet menutup lebih dulu; dialog arsip menggantikannya (satu lapisan modal sekali).
              setForm({ ...form, open: false });
              setArchive({ open: true, category });
            }}
          />
        </Suspense>
      ) : null}
      {archiveMounted && archive !== null ? (
        <Suspense fallback={null}>
          <ArchiveDialog
            open={archive.open}
            onOpenChange={(open) => {
              setArchive((a) => (a === null ? a : { ...a, open }));
            }}
            name={archive.category.name}
            ruang={ruang}
            childCount={categories.filter((c) => c.parentId === archive.category.id).length}
            onConfirm={() => {
              void confirmArchive(archive.category);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** `‹ Menu`: kembali ke halaman sebelumnya (Menu menutup); tanpa riwayat, ke Beranda ruang ini. */
export function KategoriBack({ ruang }: { ruang: Ruang }) {
  const router = useRouter();
  const nav = useNav();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(buildHref(ruang, 'beranda', nav.query));
      }}
      className={`-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-body font-bold text-accent-text hover-pointer:underline ${focusRing}`}
    >
      <CaretLeftIcon size={16} weight="bold" />
      Menu
    </button>
  );
}
