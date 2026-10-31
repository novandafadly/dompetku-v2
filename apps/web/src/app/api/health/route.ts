/**
 * Liveness untuk healthcheck container dan deployer (`/opt/dompetku/bin/deploy`).
 * Hanya status dan SHA build (BUILD_SHA dari Dockerfile); tanpa rahasia, tanpa cek DB
 * (kesiapan DB menyusul di /api/health/ready saat web memakai Postgres).
 */
export const dynamic = 'force-dynamic';

const SHA = /^[0-9a-f]{7,40}$/;

export function GET(): Response {
  const raw = process.env.BUILD_SHA ?? '';
  return Response.json(
    { status: 'ok', sha: SHA.test(raw) ? raw : 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
