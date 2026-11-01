/** Sisa jeda untuk pesan galat: "1 menit", "15 menit", "1 jam" (dibulatkan ke atas). */
export function waitText(seconds: number): string {
  if (seconds >= 3600) return `${String(Math.ceil(seconds / 3600))} jam`;
  return `${String(Math.max(1, Math.ceil(seconds / 60)))} menit`;
}
