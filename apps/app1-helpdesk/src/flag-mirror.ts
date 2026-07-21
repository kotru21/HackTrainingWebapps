import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@hacktraining/shared';
import type { AppConfig } from './config';
import { query } from './db';

/**
 * Keep FLAG_FILE_PATH in sync with the `rce_flag` row in the stand DB.
 *
 * The flag-planter (platform namespace) rotates flags each tick by writing them into
 * the stand's own database — it has no filesystem access to this pod. This loop is the
 * delivery channel for the file-based CFG-RCE flag: it reads the current `rce_flag`
 * value and mirrors it to the file the ejs-RCE payload reads. Best-effort and quiet on
 * failure so it never destabilises the stand (e.g. read-only root, DB briefly down).
 *
 * The flag value itself is never logged (see .cursor/rules/00-project.mdc).
 */
export function startFlagMirror(config: AppConfig, logger: Logger): NodeJS.Timeout {
  let last = '';
  const intervalMs = Number(process.env.FLAG_MIRROR_INTERVAL_MS ?? '5000');

  const sync = async (): Promise<void> => {
    try {
      const res = await query<{ value: string }>(
        `SELECT value FROM admin_secrets WHERE name = 'rce_flag'`,
      );
      const value = res.rows[0]?.value;
      if (!value || value === last) return;
      fs.mkdirSync(path.dirname(config.flagFilePath), { recursive: true });
      fs.writeFileSync(config.flagFilePath, `${value}\n`, 'utf8');
      last = value;
      logger.info({ event: 'flag.mirror' }, 'rce flag mirrored to file');
    } catch {
      // ignore — transient DB/FS errors must not crash the stand
    }
  };

  void sync();
  const timer = setInterval(() => void sync(), intervalMs);
  timer.unref();
  return timer;
}
