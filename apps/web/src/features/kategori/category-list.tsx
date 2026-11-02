'use client';

import { CategoryGlyph } from '@/components/ui/category-icon';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { PlusIcon } from '@/components/ui/icons/plus';
import { TagIcon } from '@/components/ui/icons/tag';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { card, focusRing, rowDivider, tile } from '@/components/ui/styles';
import type { CategoryVM, Ruang } from '@/features/ledger/types';
import { CATEGORY_ROW_ATTR } from './ids';

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };
const TYPE_NAME = { expense: 'pengeluaran', income: 'pemasukan' } as const;

function Row({
  category,
  onOpen,
  onPreload,
}: {
  category: CategoryVM;
  onOpen: (c: CategoryVM) => void;
  onPreload?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      {...{ [CATEGORY_ROW_ATTR]: category.id }}
      onClick={() => {
        onOpen(category);
      }}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      className={`-mx-4 flex min-h-13 items-center gap-3 px-4 text-left hover-pointer:bg-hover active:bg-hover ${focusRing}`}
    >
      <span aria-hidden="true" className={`size-9 ${tile}`}>
        <CategoryGlyph icon={category.icon} name={category.name} size={18} />
      </span>
      <span className="min-w-0 flex-1 text-body font-semibold break-words text-text">
        {category.name}
      </span>
      <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
    </button>
  );
}

/**
 * Daftar kategori satu jenis (S6-K1): akar, anak menjorok 24 di bawah induknya dengan garis kiri
 * `hairline`. Baris = tombol yang membuka sheet ubah (tanpa aksi hover). Kategori terarsip tidak
 * ada di `categories`. Kosong: keadaan kosong dengan `Tambah kategori`.
 */
export function CategoryList({
  ruang,
  type,
  categories,
  onOpen,
  onAdd,
  onPreload,
}: {
  ruang: Ruang;
  type: 'expense' | 'income';
  /** Kategori aktif ruang ini (semua jenis); yang tidak sejenis disaring di sini. */
  categories: CategoryVM[];
  onOpen: (c: CategoryVM) => void;
  onAdd: () => void;
  /** Pointer/fokus di baris atau tombol: muat lebih awal kode sheet yang dimuat malas. */
  onPreload?: (() => void) | undefined;
}) {
  const roots = categories.filter((c) => c.type === type && c.parentId === null);
  if (roots.length === 0) {
    return (
      <EmptyState
        icon={<TagIcon size={26} />}
        title={`Belum ada kategori ${TYPE_NAME[type]} di ${RUANG_NAME[ruang]}.`}
        action={<AddCategoryButton onAdd={onAdd} onPreload={onPreload} />}
      />
    );
  }
  return (
    <ul aria-label={`Kategori ${TYPE_NAME[type]}`} className={`px-4 ${card}`}>
      {roots.map((root) => {
        const children = categories.filter((c) => c.parentId === root.id);
        return (
          <li key={root.id} className={`grid ${rowDivider}`}>
            <Row category={root} onOpen={onOpen} onPreload={onPreload} />
            {children.length === 0 ? null : (
              <ul
                aria-label={`Subkategori ${root.name}`}
                className="mb-2 ml-6 border-l border-hairline pl-3"
              >
                {children.map((child) => (
                  <li key={child.id} className={`grid ${rowDivider}`}>
                    <Row category={child} onOpen={onOpen} onPreload={onPreload} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AddCategoryButton({
  onAdd,
  onPreload,
  className = '',
}: {
  onAdd: () => void;
  onPreload?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onAdd}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      className={className}
    >
      <PlusIcon size={18} weight="bold" />
      Tambah kategori
    </Button>
  );
}
