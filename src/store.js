// -----------------------------------------------------------------------------
// /data/state.json: the forecast cache, the time of the last read attempt
// and the pause after failures.
//
// One operation at a time; each one bounded in time. An unreadable /data is
// not an empty one: `load()` says so and the caller retries on its own timer.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_TIMEOUT } from './constants.js';

const FILE = 'state.json';

function bounded(promise, ms, timers) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = timers.setTimeout(() => reject(new Error('/data too slow')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => timers.clearTimeout(timer));
}

export class Store {
  constructor({ dataDir, timers, timeout = DATA_TIMEOUT }) {
    this.dataDir = dataDir;
    this.timers = timers;
    this.timeout = timeout;
    this.queue = Promise.resolve();
  }

  run(job) {
    const result = this.queue.then(job, job);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * `{ ok: true, state }` (an empty object when there is no file yet, and
   * `corrupt: true` when the file is not JSON), or `{ ok: false, error }`
   * when /data cannot be read.
   */
  load() {
    return this.run(async () => {
      let text;
      try {
        text = await bounded(readFile(join(this.dataDir, FILE), 'utf8'), this.timeout, this.timers);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { ok: true, state: {} };
        }
        return { ok: false, error: err };
      }
      try {
        const state = JSON.parse(text);
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          return { ok: true, state };
        }
      } catch {
        // fall through
      }
      return { ok: true, state: {}, corrupt: true };
    });
  }

  /** Write the state (temporary file then rename). Resolves true on success. */
  save(state) {
    const text = JSON.stringify(state);
    return this.run(async () => {
      // A write that outlived its bound is still running: never start another
      // one that it could overwrite afterwards.
      if (this.slowWrite) {
        return false;
      }
      const path = join(this.dataDir, FILE);
      const work = (async () => {
        await mkdir(this.dataDir, { recursive: true });
        await writeFile(`${path}.tmp`, text);
        await rename(`${path}.tmp`, path);
      })();
      try {
        await bounded(work, this.timeout, this.timers);
        return true;
      } catch {
        this.slowWrite = work
          .catch(() => {})
          .finally(() => {
            this.slowWrite = undefined;
          });
        return false;
      }
    });
  }
}
