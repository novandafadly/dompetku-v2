/**
 * Liveness untuk healthcheck container dan deployer (`/opt/dompetku/bin/deploy`).
 * Hanya status dan SHA build (BUILD_SHA dari Dockerfile); tanpa rahasia, tanpa cek DB
 * (kesiapan DB menyusul di /api/health/ready saat web memakai Postgres).
 */
export const dynamic = 'force-dynamic';

const SHA = /^[0-9a-f]{7,40}$/;

export function GET(): Response {
  const raw = process.env.BUILD_SHA ?? '';
  // UJI ROLLBACK S3 (sengaja rusak, revert setelah uji): build rilis (BUILD_SHA asli) menjawab 500;
  // build lokal/e2e (BUILD_SHA kosong) tetap 200 agar CI hijau.
  if (SHA.test(raw)) {
    return Response.json(
      { status: 'broken', sha: raw },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return Response.json(
    { status: 'ok', sha: SHA.test(raw) ? raw : 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
