// -----------------------------------------------------------------------------
// Real time, sped up 36,000 times (one hour = 100 ms): the reads leave one
// hour apart, never sooner, failed or not. Large margins: late under load is
// fine, early never. The gaps are measured on the attempt time the module
// decides on (one real millisecond is 36 simulated seconds: the latency
// between that decision and the fake request would blur the period).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CorrentlyApp } from '../src/app.js';
import { CALENDAR_KEY, HOUR } from '../src/constants.js';
import { FIXTURE_START, fixture, installFetch, json } from './helpers/fakeFetch.js';
import { realClock } from './helpers/realClock.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function measure(t, answer) {
  const clock = realClock({ start: FIXTURE_START + 60_000, speed: 36_000 });
  const times = [];
  let app;
  const fake = installFetch([
    [
      /gsi\/prediction/,
      () => {
        times.push(app.state.attempt_at);
        assert.ok(clock.now() >= app.state.attempt_at, 'the request leaves after its attempt');
        return answer();
      },
    ],
  ]);
  const dataDir = mkdtempSync(join(tmpdir(), 'corrently-rc-'));
  const gladys = createFakeGladys({
    selector: 'corrently',
    energyCalendars: { [CALENDAR_KEY]: [] },
  });
  app = new CorrentlyApp({
    gladys,
    logger: quiet,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    dataDir,
  });
  t.after(async () => {
    await app.stop();
    clock.close();
    fake.restore();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await app.start({ zip: '10115' });
  const deadline = Date.now() + 20_000;
  while (times.length < 4 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await app.stop();
  assert.ok(times.length >= 4, `only ${times.length} reads in 20 s`);
  return times.slice(1).map((m, i) => m - times[i]);
}

test('real clock: a successful read every hour, never sooner', async (t) => {
  const body = fixture('prediction-10115.json');
  const gaps = await measure(t, () => json(body));
  for (const gap of gaps) {
    assert.ok(gap >= HOUR, `gap ${gap / 60_000} min`);
    assert.ok(gap <= 3 * HOUR, `gap ${gap / 60_000} min`);
  }
});

test('real clock: failures wait 1 h, then 2 h, then 4 h', async (t) => {
  const gaps = await measure(t, () => new Response('', { status: 503 }));
  [1, 2, 4].forEach((hours, i) => {
    assert.ok(gaps[i] >= hours * HOUR, `gap ${i}: ${gaps[i] / 60_000} min`);
    assert.ok(gaps[i] <= hours * HOUR * 2 + HOUR, `gap ${i}: ${gaps[i] / 60_000} min`);
  });
});
