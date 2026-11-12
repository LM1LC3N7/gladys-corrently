// -----------------------------------------------------------------------------
// The real clock, sped up: timers really wait (divided by `speed`), `now` and
// `monotonic` return simulated milliseconds. Same idea as gladys-testkit's
// realClock, kept here so the CI runs without it.
// -----------------------------------------------------------------------------

import { performance } from 'node:perf_hooks';

export function realClock({ start, speed }) {
  const t0 = performance.now();
  const simulated = () => (performance.now() - t0) * speed;
  const live = new Set();
  return {
    now: () => start + simulated(),
    monotonic: () => 1_000 + simulated(),
    timers: {
      setTimeout(fn, ms) {
        const id = setTimeout(
          () => {
            live.delete(id);
            fn();
          },
          Math.max(0, ms) / speed,
        );
        live.add(id);
        return id;
      },
      clearTimeout(id) {
        live.delete(id);
        clearTimeout(id);
      },
    },
    close() {
      for (const id of live) {
        clearTimeout(id);
      }
      live.clear();
    },
  };
}
