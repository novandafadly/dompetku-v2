export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Satu nilai query string (nilai ganda = yang pertama). */
export async function param(searchParams: SearchParams, name: string): Promise<string> {
  const v = (await searchParams)[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}
