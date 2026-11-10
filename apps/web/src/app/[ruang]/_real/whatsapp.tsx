import { ErrorState, EmptyState } from '@/components/ui/state';
import { DeviceMobileIcon } from '@/components/ui/icons/device-mobile';
import type { Ruang } from '@/features/ledger/types';
import { WA_TITLE_ID } from '@/features/wa/ids';
import type { WaLinkStatus } from '@/server/wa/link';
import { RetryIsland } from './transaksi-islands';
import { WhatsappBackIsland, WhatsappManagerIsland } from './whatsapp-islands';

/** Lebar isi seperti Kategori: satu kolom, laptop maks 720. */
const WA_WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6';

function WaHeader({ ruang }: { ruang: Ruang }) {
  return (
    <>
      <WhatsappBackIsland ruang={ruang} />
      <h1
        id={WA_TITLE_ID}
        tabIndex={-1}
        className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
      >
        WhatsApp
      </h1>
    </>
  );
}

/**
 * WhatsApp mode nyata (Server Component). Fitur mati = keadaan tenang tanpa tombol Hubungkan;
 * selain itu pulau klien menerima status yang nomornya sudah disamarkan di server.
 */
export function WhatsappReal({ ruang, status }: { ruang: Ruang; status: WaLinkStatus }) {
  return (
    <section className={WA_WIDTH}>
      <WaHeader ruang={ruang} />
      {status.state === 'nobot' ? (
        <EmptyState
          icon={<DeviceMobileIcon size={24} />}
          title="Nomor bot belum diatur."
          description="Hubungi pemilik DompetKu untuk mengisinya, lalu kembali ke sini."
        />
      ) : status.state === 'off' ? (
        <EmptyState
          icon={<DeviceMobileIcon size={24} />}
          title="Catat lewat WhatsApp belum aktif."
          description="Fitur ini belum dinyalakan di server DompetKu. Setelah dinyalakan, nomormu bisa dihubungkan dari sini."
        />
      ) : (
        <WhatsappManagerIsland status={status} />
      )}
    </section>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi. */
export function WhatsappFailed({ ruang }: { ruang: Ruang }) {
  return (
    <section className={WA_WIDTH}>
      <WaHeader ruang={ruang} />
      <ErrorState
        title="Status WhatsApp belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </section>
  );
}
