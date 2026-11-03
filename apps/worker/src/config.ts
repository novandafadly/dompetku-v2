import { z } from 'zod';

/**
 * Env worker (`/opt/dompetku/env/worker.env`, diisi pemilik). URL Healthchecks opsional:
 * kosong = ping dilewati dengan log `alert_skipped`.
 */
export interface Config {
  databaseUrl: string;
  hc: { dq?: string; jobs?: string };
}

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const httpUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .refine((s) => URL.canParse(s) && /^https?:$/.test(new URL(s).protocol))
    .optional(),
);

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((s) => URL.canParse(s) && /^postgres(ql)?:$/.test(new URL(s).protocol)),
  HC_DQ_URL: httpUrl,
  HC_JOBS_URL: httpUrl,
});

type Env = Readonly<Record<string, string | undefined>>;

function parse(env: Env) {
  return EnvSchema.safeParse({
    DATABASE_URL: env.DATABASE_URL,
    HC_DQ_URL: env.HC_DQ_URL,
    HC_JOBS_URL: env.HC_JOBS_URL,
  });
}

/** Nama variabel yang tidak valid, urut, tanpa nilai (nilai bisa memuat password). */
function badFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0])))].sort();
}

export function checkConfig(env: Env): { ok: boolean; fields: string[] } {
  const r = parse(env);
  return r.success ? { ok: true, fields: [] } : { ok: false, fields: badFields(r.error) };
}

export function loadConfig(env: Env): Config {
  const r = parse(env);
  if (!r.success) throw new Error(`config_invalid: ${badFields(r.error).join(', ')}`);
  const hc: Config['hc'] = {};
  if (r.data.HC_DQ_URL) hc.dq = r.data.HC_DQ_URL;
  if (r.data.HC_JOBS_URL) hc.jobs = r.data.HC_JOBS_URL;
  return { databaseUrl: r.data.DATABASE_URL, hc };
}
