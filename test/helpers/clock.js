// -----------------------------------------------------------------------------
// A test clock that moves on its own: every read of `now()` or `monotonic()`
// advances 1 µs (a decision reading the clock twice sees it move), and
// `advance(ms)` fires the due timers in order, awaiting each one.
// -----------------------------------------------------------------------------

export function createClock(start) {
  let wall = start;
  let mono = 1_000;
  const timers = new Map();
  let next = 1;
  const tick = () => {
    wall += 0.001;
    mono += 0.001;
  };
  const clock = {
    now() {
      tick();
      return wall;
    },
    monotonic() {
      tick();
      return mono;
    },
    /** Move the wall clock only (a clock change): monotonic time stays. */
    jumpWall(ms) {
      wall += ms;
    },
    timers: {
      setTimeout(fn, ms) {
        const id = next++;
        timers.set(id, { fn, due: mono + Math.max(0, ms) });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    pending() {
      return [...timers.values()].map((t) => t.due - mono);
    },
    /** Run every pending timer now, before its time (a timer firing early). */
    async fireEarly() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        await timer.fn();
      }
      await clock.settle();
      await clock.waitFor?.();
    },
    async settle() {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    async advance(ms) {
      const end = mono + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) {
          break;
        }
        const [id, timer] = due;
        timers.delete(id);
        const step = Math.max(0, timer.due - mono);
        wall += step;
        mono += step;
        await timer.fn();
        await clock.settle();
        // The work a timer started (a read) ends before time moves on.
        await clock.waitFor?.();
        await clock.settle();
      }
      const rest = Math.max(0, end - mono);
      wall += rest;
      mono += rest;
      await clock.settle();
    },
  };
  return clock;
}
