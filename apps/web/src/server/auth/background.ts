/**
 * Jalankan tanpa ditunggu (email, notifikasi): respons tidak menunggu penyedia luar, sehingga
 * waktunya tidak membedakan akun yang ada dan yang tidak. Galat ditulis ke log tanpa isi email.
 */
export function background(task: Promise<unknown>): void {
  task.catch((e: unknown) => {
    console.error('[auth] tugas latar gagal:', e instanceof Error ? e.message : String(e));
  });
}
