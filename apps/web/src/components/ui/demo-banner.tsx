/** Penanda prototipe di setiap halaman: garis tipis di atas, tidak bersaing dengan isi. */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="border-b border-hairline bg-bg px-4 py-1.5 text-center text-sm font-semibold text-text-muted"
    >
      Data demo
    </div>
  );
}
