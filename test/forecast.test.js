import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR } from '../src/constants.js';
import { calendarEntries, levelOf, mergeSlots, snapshot } from '../src/forecast.js';

const T0 = Date.parse('2026-11-12T00:00:00Z');
const slotsFrom = (start, values) => values.map((gsi, i) => ({ t: start + i * HOUR, gsi }));

test('levels: fixed bounds 34 and 67', () => {
  assert.equal(levelOf(0), 'low');
  assert.equal(levelOf(33), 'low');
  assert.equal(levelOf(34), 'medium');
  assert.equal(levelOf(66), 'medium');
  assert.equal(levelOf(67), 'high');
  assert.equal(levelOf(100), 'high');
});

test('snapshot: current, next, and the earliest greenest hour of 24', () => {
  const values = Array.from({ length: 30 }, (_, i) => (i === 5 || i === 9 ? 80 : 40 + (i % 3)));
  const snap = snapshot(slotsFrom(T0, values), T0 + 20 * 60_000);
  assert.deepEqual(snap, { current: 40, next: 41, best: 80, hoursToBest: 5 });
});

test('snapshot: the best of 24 h stays unknown when an hour is missing', () => {
  const slots = slotsFrom(T0, Array(30).fill(50)).filter((s) => s.t !== T0 + 7 * HOUR);
  const snap = snapshot(slots, T0);
  assert.equal(snap.current, 50);
  assert.equal(snap.best, undefined);
  assert.equal(snap.hoursToBest, undefined);
  assert.deepEqual(snapshot([], T0), {
    current: undefined,
    next: undefined,
    best: undefined,
    hoursToBest: undefined,
  });
});

test('merge: a read starting at the next hour keeps the current hour', () => {
  const now = T0 + 50 * 60_000;
  const old = slotsFrom(T0 - 2 * HOUR, [10, 20, 30, 40, 50]);
  const fresh = slotsFrom(T0 + HOUR, [60, 70]);
  const merged = mergeSlots(old, fresh, now);
  assert.deepEqual(
    merged.map((s) => s.gsi),
    [10, 20, 30, 60, 70],
  );
  // Past slots beyond 48 h are dropped.
  assert.equal(mergeSlots(slotsFrom(T0 - 60 * HOUR, [1]), fresh, now).length, 2);
});

test('calendar: two aligned half hours per slot, seven days ahead at most', () => {
  const slots = slotsFrom(T0, Array(200).fill(70));
  const entries = calendarEntries(slots, T0);
  assert.equal(entries[0].starts_at, '2026-11-12T00:00:00.000Z');
  assert.equal(entries[1].starts_at, '2026-11-12T00:30:00.000Z');
  assert.equal(entries[0].value, 'high');
  const last = Date.parse(entries.at(-1).starts_at);
  assert.ok(last <= T0 + 7 * 24 * HOUR - HOUR, 'inside the host window');
  for (const e of entries) {
    assert.equal(Date.parse(e.starts_at) % (30 * 60_000), 0);
  }
});

test('calendar: the autumn clock change in Berlin keeps 30-minute slots', () => {
  // 2026-10-25: 03:00 CEST becomes 02:00 CET, 25 local hours.
  const start = Date.parse('2026-10-24T22:00:00Z'); // 00:00 CEST
  const entries = calendarEntries(slotsFrom(start, Array(25).fill(20)), start);
  assert.equal(entries.length, 50);
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  });
  const times = entries.map((e) => local.format(new Date(e.starts_at)));
  assert.equal(times.filter((t) => t === '02:00').length, 2, 'the repeated hour');
  assert.ok(times.every((t) => t.endsWith(':00') || t.endsWith(':30')));
  // Spring: 2026-03-29, 23 local hours.
  const spring = Date.parse('2026-03-28T23:00:00Z');
  const s = calendarEntries(slotsFrom(spring, Array(23).fill(20)), spring);
  assert.ok(!s.map((e) => local.format(new Date(e.starts_at))).includes('02:00'));
});
