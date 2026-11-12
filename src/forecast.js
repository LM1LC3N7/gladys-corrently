// -----------------------------------------------------------------------------
// What the sensors and the calendar show of a forecast at an instant. Pure.
// -----------------------------------------------------------------------------

import { CALENDAR_AHEAD, HOUR, KEEP_PAST, LEVELS } from './constants.js';

const hourStart = (t) => Math.floor(t / HOUR) * HOUR;

/** The level of an index (the calendar values). */
export function levelOf(gsi) {
  let level = LEVELS[0][0];
  for (const [name, from] of LEVELS) {
    if (gsi >= from) {
      level = name;
    }
  }
  return level;
}

/**
 * Merge a new read into the cache: the new slots replace the old ones, the
 * past slots the new read no longer carries are kept (KEEP_PAST at most),
 * the future ones it dropped are forgotten.
 */
export function mergeSlots(old, fresh, now) {
  const from = hourStart(now) - KEEP_PAST;
  const first = fresh.length > 0 ? fresh[0].t : Infinity;
  const kept = old.filter((s) => s.t >= from && s.t < first && s.t < hourStart(now) + HOUR);
  return [...kept, ...fresh.filter((s) => s.t >= from)].sort((a, b) => a.t - b.t);
}

/**
 * The values at `now`: `current` and `next` index (undefined when unknown),
 * and over the 24 hours starting with the current one, the greenest index
 * and the hours until it (earliest on a tie). Those two need all 24 hours
 * known, otherwise they stay unknown.
 */
export function snapshot(slots, now) {
  const start = hourStart(now);
  const byStart = new Map(slots.map((s) => [s.t, s.gsi]));
  const current = byStart.get(start);
  const next = byStart.get(start + HOUR);
  let best;
  let hoursToBest;
  let complete = true;
  for (let i = 0; i < 24; i += 1) {
    const gsi = byStart.get(start + i * HOUR);
    if (gsi === undefined) {
      complete = false;
      break;
    }
    if (best === undefined || gsi > best) {
      best = gsi;
      hoursToBest = i;
    }
  }
  if (!complete) {
    best = undefined;
    hoursToBest = undefined;
  }
  return { current, next, best, hoursToBest };
}

/**
 * The calendar entries of the slots: two half hours per hour, from the
 * slots' start up to CALENDAR_AHEAD after `now` (the host refuses beyond
 * seven days).
 */
export function calendarEntries(slots, now) {
  const limit = now + CALENDAR_AHEAD - HOUR;
  const entries = [];
  for (const { t, gsi } of slots) {
    if (t + HOUR / 2 > limit) {
      break;
    }
    const value = levelOf(gsi);
    entries.push({ starts_at: new Date(t).toISOString(), value });
    entries.push({ starts_at: new Date(t + HOUR / 2).toISOString(), value });
  }
  return entries;
}
