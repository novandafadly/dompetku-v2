import { checkConfig, loadConfig } from './config';
import { log } from './log';
import { errorCode } from './run-job';
import { startWorker } from './worker';

/**
 * Entri worker (`node worker/worker.mjs`). `--check-config`: validasi env lalu keluar 0/1 tanpa
 * menyentuh DB (dipakai runbook/deployer sebelum memasang worker).
 */
async function main(argv: readonly string[]): Promise<number> {
  const check = checkConfig(process.env);
  if (!check.ok) {
    log('config_invalid', { fields: check.fields });
    return 1;
  }
  if (argv.includes('--check-config')) {
    log('config_ok');
    return 0;
  }

  const worker = await startWorker(loadConfig(process.env));
  log('worker_started');

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('worker_stopping');
    worker.stop().then(
      () => {
        log('worker_stopped');
        process.exit(0);
      },
      (err: unknown) => {
        log('worker_stop_failed', { code: errorCode(err) });
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return -1;
}

process.on('unhandledRejection', (err) => {
  log('unhandled_rejection', { code: errorCode(err) });
});

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    log('worker_start_failed', { code: errorCode(err) });
    process.exitCode = 1;
  },
);
