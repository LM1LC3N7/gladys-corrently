// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake Corrently and a test
// clock that moves on its own.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTION_TEST, CorrentlyApp, backoff } from '../src/app.js';
import { CALENDAR_KEY, HOUR } from '../src/constants.js';
import { FIXTURE_START, fixture, installFetch, json } from './helpers/fakeFetch.js';
import { createClock } from './helpers/clock.js';

const DEVICE = 'ext:corrently:zip:10115';
const F = (key) => `${DEVICE}:${key}`;

let fake;
afterEach(() => fake?.restore());

// Per test: every app is stopped BEFORE any data folder is removed (a save in
// flight would create the folder again).
const cleanups = new WeakMap();
function track(t, { app, dir }) {
  let entry = cleanups.get(t);
  if (!entry) {
    entry = { apps: [], dirs: [] };
    cleanups.set(t, entry);
    t.after(async () => {
      for (const a of entry.apps) {
        await a.stop();
      }
      for (const d of entry.dirs) {
        rmSync(d, { recursive: true, force: true });
      }
    });
  }
  if (app) entry.apps.push(app);
  if (dir) entry.dirs.push(dir);
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'corrently-'));
  track(t, { dir });
  return dir;
}

function memoryLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(`${level} ${args.map(String).join(' ')}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/** The recorded answer, its slots moved to start at `start`. */
function answerAt(start, { zip = '10115', count = 30 } = {}) {
  const body = fixture('prediction-10115.json');
  const shift = start - FIXTURE_START;
  body.forecast = body.forecast.slice(0, count).map((e) => ({
    ...e,
    zip,
    timeStamp: e.timeStamp + shift,
    iat: e.iat + shift,
    epochtime: e.epochtime + shift / 1000,
    timeframe: { start: e.timeframe.start + shift, end: e.timeframe.end + shift },
  }));
  body.location.zip = zip;
  return body;
}

const START = FIXTURE_START + 10 * 60_000; // 21:10 UTC

function setup(t, { config = { zip: '10115' }, now = START, dataDir, routes, clock } = {}) {
  clock ??= createClock(now);
  const calls = [];
  fake = installFetch(
    routes ?? [
      [
        /gsi\/prediction/,
        (call) => {
          calls.push(call);
          const zip = call.params.zip;
          return json(answerAt(Math.floor(clock.now() / HOUR) * HOUR, { zip }));
        },
      ],
    ],
  );
  const gladys = createFakeGladys({
    selector: 'corrently',
    config,
    energyCalendars: { [CALENDAR_KEY]: [] },
  });
  dataDir ??= tempDir(t);
  const logger = memoryLogger();
  const app = new CorrentlyApp({
    gladys,
    logger,
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    dataDir,
  });
  gladys.onAction(ACTION_TEST, () => app.testConnection());
  clock.waitFor = () => app.reading;
  track(t, { app });
  return { app, gladys, clock, dataDir, logger, calls: () => fake.calls };
}

const readData = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));

test('start: one device, the index states, the calendar and the status', async (t) => {
  const { app, gladys, dataDir, calls } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'GrünstromIndex 10115');
  const body = answerAt(FIXTURE_START);
  assert.equal(gladys.fake.lastState(F('gsi')), body.forecast[0].gsi);
  assert.equal(gladys.fake.lastState(F('gsi-next')), body.forecast[1].gsi);
  const best = Math.max(...body.forecast.slice(0, 24).map((e) => e.gsi));
  assert.equal(gladys.fake.lastState(F('gsi-best-24h')), best);
  assert.ok(Number.isInteger(gladys.fake.lastState(F('hours-to-best'))));
  const entries = gladys.fake.energyCalendars[CALENDAR_KEY];
  assert.equal(entries.length, 60);
  assert.ok(entries.every((e) => ['low', 'medium', 'high'].includes(e.value)));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(calls().length, 1);
  const data = readData(dataDir);
  assert.equal(data.zip, '10115');
  assert.equal(data.slots.length, 30);
  assert.ok(data.attempt_at > 0);
});

test('fair use: one read per hour, the button included', async (t) => {
  const { app, gladys, clock, calls } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(calls().length, 1);
  for (let i = 0; i < 3; i += 1) {
    const ack = await gladys.fake.action(ACTION_TEST, {});
    assert.equal(ack.success, true);
    assert.match(ack.data.message.en, /Next read/);
  }
  await clock.advance(HOUR - 5_000);
  assert.equal(calls().length, 1, 'not before the hour');
  await clock.advance(10_000);
  assert.equal(calls().length, 2);
  await clock.advance(5 * HOUR);
  assert.equal(calls().length, 7);
});

test('a restart inside the hour reads nothing, publishes the cache, then reads on time', async (t) => {
  const first = setup(t);
  await first.app.start({ zip: '10115' });
  await first.app.reading;
  await first.app.stop();
  const clock = createClock(START + 20 * 60_000);
  const second = setup(t, { dataDir: first.dataDir, clock });
  await second.app.start({ zip: '10115' });
  assert.equal(second.calls().length, 0, 'no read at the restart');
  assert.ok(Number.isFinite(second.gladys.fake.lastState(F('gsi'))), 'the cache is published');
  await clock.advance(HOUR - 20 * 60_000 - 5_000);
  assert.equal(second.calls().length, 0);
  await clock.advance(10_000);
  assert.equal(second.calls().length, 1);
});

test('the attempt is on disk before the request leaves', async (t) => {
  let seen;
  const ctx = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        () => {
          seen = readData(ctx.dataDir);
          return json(answerAt(FIXTURE_START));
        },
      ],
    ],
  });
  await ctx.app.start({ zip: '10115' });
  await ctx.app.reading;
  assert.ok(seen.attempt_at >= START);
});

test('a future attempt date in /data is invalid: the full hour is waited', async (t) => {
  const dataDir = tempDir(t);
  writeFileSync(
    join(dataDir, 'state.json'),
    JSON.stringify({ attempt_at: START + 48 * HOUR, attempt_zip: '10115', pause_until: 1e15 }),
  );
  const { app, clock, calls } = setup(t, { dataDir });
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(calls().length, 0);
  await clock.advance(HOUR - 1_000);
  assert.equal(calls().length, 0);
  await clock.advance(2_000);
  assert.equal(calls().length, 1, 'read after one hour, not 48 h nor 1e15');
});

test('a corrupt /data waits the hour; it is not an empty one', async (t) => {
  const dataDir = tempDir(t);
  writeFileSync(join(dataDir, 'state.json'), '{not json');
  const { app, clock, calls } = setup(t, { dataDir });
  await app.start({ zip: '10115' });
  await app.reading;
  await clock.settle();
  assert.equal(calls().length, 0);
  await clock.advance(HOUR + 1_000);
  assert.equal(calls().length, 1);
});

test('an unreadable /data: no read, status, retried every 10 s', async (t) => {
  const dataDir = tempDir(t);
  mkdirSync(join(dataDir, 'state.json')); // EISDIR on read
  const { app, gladys, clock, calls } = setup(t, { dataDir });
  await app.start({ zip: '10115' });
  assert.equal(calls().length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be read/);
  const ack = await gladys.fake.action(ACTION_TEST, {});
  assert.match(ack.data.message.en, /cannot be read/);
  assert.deepEqual(clock.pending().filter((ms) => ms > 0 && ms <= 10_000).length, 1);
  rmSync(join(dataDir, 'state.json'), { recursive: true });
  await clock.advance(10_500);
  await app.reading;
  assert.equal(calls().length, 1, 'read once /data answers');
});

test('a /data that cannot be written blocks the read', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root writes anywhere');
    return;
  }
  const dataDir = tempDir(t);
  chmodSync(dataDir, 0o500);
  const { app, gladys, clock, calls } = setup(t, { dataDir });
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(calls().length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be written/);
  chmodSync(dataDir, 0o700);
  await clock.advance(10_500);
  await app.reading;
  assert.equal(calls().length, 1);
});

test('the wall clock jumping forward never brings a read forward', async (t) => {
  const { app, gladys, clock, calls } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  await clock.fireEarly();
  assert.equal(calls().length, 1, 'a timer firing early reads nothing');
  clock.jumpWall(5 * HOUR);
  await gladys.fake.action(ACTION_TEST, {});
  await clock.advance(30 * 60_000);
  assert.equal(calls().length, 1);
  await clock.advance(31 * 60_000);
  assert.equal(calls().length, 2);
});

test('5xx: the wait doubles, 1 h to 6 h, persisted', async (t) => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map(backoff),
    [1, 2, 4, 6, 6, 6].map((h) => h * HOUR),
  );
  const { app, gladys, clock, calls, dataDir } = setup(t, {
    routes: [[/gsi\/prediction/, () => new Response('', { status: 503 })]],
  });
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(calls().length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 503/);
  assert.equal(readData(dataDir).failures, 1);
  await clock.advance(HOUR + 1_000);
  assert.equal(calls().length, 2);
  await clock.advance(2 * HOUR - 10_000);
  assert.equal(calls().length, 2, 'second wait: two hours');
  await clock.advance(20_000);
  assert.equal(calls().length, 3);
  assert.equal(readData(dataDir).failures, 3);
});

test('429 Retry-After longer than the backoff is obeyed', async (t) => {
  const { app, clock, calls } = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        () => new Response('', { status: 429, headers: { 'retry-after': String(3 * 3600) } }),
      ],
    ],
  });
  await app.start({ zip: '10115' });
  await app.reading;
  await clock.advance(3 * HOUR - 10_000);
  assert.equal(calls().length, 1);
  await clock.advance(20_000);
  assert.equal(calls().length, 2);
});

test('an empty forecast publishes nothing and says so', async (t) => {
  const { app, gladys } = setup(t, {
    routes: [[/gsi\/prediction/, () => json({ forecast: [], location: {} })]],
  });
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(gladys.fake.states.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /no forecast for 10115/);
});

test('a forecast older than 72 h is not published', async (t) => {
  const dataDir = tempDir(t);
  const hour = Math.floor(START / HOUR) * HOUR;
  const slots = Array.from({ length: 10 }, (_, i) => ({ t: hour + (i - 2) * HOUR, gsi: 55 }));
  const write = (age) =>
    writeFileSync(
      join(dataDir, 'state.json'),
      JSON.stringify({
        attempt_at: START - 60_000,
        attempt_zip: '10115',
        zip: '10115',
        fetched_at: START - age,
        slots,
      }),
    );
  write(73 * HOUR);
  const old = setup(t, { dataDir });
  await old.app.start({ zip: '10115' });
  assert.equal(old.gladys.fake.states.length, 0);
  await old.app.stop();
  write(71 * HOUR);
  const recent = setup(t, { dataDir });
  await recent.app.start({ zip: '10115' });
  assert.equal(recent.gladys.fake.lastState(F('gsi')), 55);
});

test('the hourly tick follows the slots without reading', async (t) => {
  const { app, gladys, clock, calls } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  const body = answerAt(FIXTURE_START);
  await clock.advance(50 * 60_000 + 2_000); // 22:00:02
  assert.equal(gladys.fake.lastState(F('gsi')), body.forecast[1].gsi);
  assert.equal(calls().length, 1);
});

test('changing the postcode: new device, still one read per hour', async (t) => {
  const { app, gladys, clock, calls } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  await app.start({ zip: '01067' });
  await app.reading;
  await clock.settle();
  assert.equal(gladys.fake.discoveredDevices[0].external_id, 'ext:corrently:zip:01067');
  assert.equal(calls().length, 1);
  await app.start({ zip: '10115' });
  await app.start({ zip: '01067' });
  await clock.advance(HOUR - 5_000);
  assert.equal(calls().length, 1, 'not before the hour, whatever the postcodes');
  await clock.advance(10_000);
  assert.equal(calls().length, 2);
  assert.equal(calls()[1].params.zip, '01067');
});

test('getConfig failing in connected: retried with a status until it works', async (t) => {
  const { app, gladys, clock, calls } = setup(t);
  const real = gladys.getConfig.bind(gladys);
  let fails = 1;
  gladys.getConfig = async () => {
    if (fails-- > 0) {
      throw new Error('boom');
    }
    return real();
  };
  await app.connected();
  assert.match(gladys.fake.connectionStatus.message.en, /Cannot read the configuration/);
  assert.equal(calls().length, 0);
  await clock.advance(10_500);
  await app.reading;
  assert.equal(calls().length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a missing postcode: clear status, no read', async (t) => {
  const { app, gladys, calls } = setup(t, { config: {} });
  await app.start({});
  assert.equal(calls().length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the German postcode/);
  assert.match(
    (await gladys.fake.action(ACTION_TEST, {})).data.message.en,
    /Enter the German postcode/,
  );
});

test('the calendar refused (another owner) does not stop the sensors', async (t) => {
  const { app, gladys, logger } = setup(t);
  gladys.publishEnergyCalendar = async () => {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  };
  await app.start({ zip: '10115' });
  await app.reading;
  assert.ok(Number.isFinite(gladys.fake.lastState(F('gsi'))));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(logger.lines.some((l) => l.includes('another integration')));
});

test('the device features follow the core rules', async (t) => {
  const { app, gladys } = setup(t);
  await app.start({ zip: '10115' });
  for (const feature of gladys.fake.discoveredDevices[0].features) {
    assert.equal(feature.read_only, true);
    assert.equal(feature.supported_options, undefined, 'no select, no option to check');
    assert.notEqual(feature.category, 'switch');
  }
});

test('every status and button text is an { en, fr } object (Gladys refuses a string)', async (t) => {
  const { app, gladys, clock } = setup(t, {
    routes: [[/gsi\/prediction/, () => new Response('', { status: 503 })]],
  });
  await app.start({});
  await app.start({ zip: '10115' });
  await app.reading;
  await clock.advance(HOUR + 1_000);
  const texts = [
    ...gladys.fake.connectionStatuses.map((s) => s.message).filter(Boolean),
    (await gladys.fake.action(ACTION_TEST, {})).data.message,
  ];
  assert.ok(texts.length >= 3);
  for (const text of texts) {
    assert.equal(typeof text, 'object', JSON.stringify(text));
    assert.ok(text.en?.trim() && text.fr?.trim(), JSON.stringify(text));
    assert.deepEqual(Object.keys(text).sort(), ['en', 'fr']);
  }
});

test('a pause after a 429 holds across a restart', async (t) => {
  const first = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        () => new Response('', { status: 429, headers: { 'retry-after': String(6 * 3600) } }),
      ],
    ],
  });
  await first.app.start({ zip: '10115' });
  await first.app.reading;
  await first.app.stop();
  const clock = createClock(START + 2 * HOUR);
  const second = setup(t, { dataDir: first.dataDir, clock });
  await second.app.start({ zip: '10115' });
  await second.app.reading;
  await clock.advance(4 * HOUR - 10_000);
  assert.equal(second.calls().length, 0, 'the 6 h pause is still running');
  await clock.advance(20_000);
  assert.equal(second.calls().length, 1);
});

test('the backoff after 5xx failures holds across a restart', async (t) => {
  const first = setup(t, {
    routes: [[/gsi\/prediction/, () => new Response('', { status: 502 })]],
  });
  await first.app.start({ zip: '10115' });
  await first.app.reading;
  await first.clock.advance(HOUR + 1_000);
  assert.equal(first.calls().length, 2);
  assert.equal(readData(first.dataDir).failures, 2);
  await first.app.stop();
  // Second failure at about 1 h: the next read is due 2 h later, at about 3 h.
  const clock = createClock(START + 2 * HOUR);
  const second = setup(t, { dataDir: first.dataDir, clock });
  await second.app.start({ zip: '10115' });
  await second.app.reading;
  await clock.advance(HOUR - 10_000);
  assert.equal(second.calls().length, 0, 'still in the 2 h backoff');
  await clock.advance(20_000);
  assert.equal(second.calls().length, 1);
});

test('a configuration saved during a read keeps its answer', async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        async () => {
          await gate;
          return json(answerAt(Math.floor(START / HOUR) * HOUR));
        },
      ],
    ],
  });
  const { app, gladys, calls, dataDir } = ctx;
  await app.start({ zip: '10115' });
  for (let i = 0; i < 500 && calls().length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(calls().length, 1);
  const restart = app.start({ zip: '10115' });
  release();
  await restart;
  assert.equal(calls().length, 1, 'no second read');
  assert.equal(readData(dataDir).slots.length, 30, 'the answer is saved');
  assert.ok(Number.isFinite(gladys.fake.lastState(F('gsi'))), 'and published by the new start');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the calendar, end to end: every slot of the answer, two half hours, its level', async (t) => {
  const { app, gladys, clock } = setup(t);
  await app.start({ zip: '10115' });
  await app.reading;
  const body = answerAt(FIXTURE_START);
  const level = (gsi) => (gsi >= 67 ? 'high' : gsi >= 34 ? 'medium' : 'low');
  const expected = body.forecast.flatMap((e) => [
    { starts_at: new Date(e.timeStamp).toISOString(), value: level(e.gsi) },
    { starts_at: new Date(e.timeStamp + HOUR / 2).toISOString(), value: level(e.gsi) },
  ]);
  const stored = gladys.fake.energyCalendars[CALENDAR_KEY].map((e) => ({
    starts_at: new Date(e.starts_at).toISOString(),
    value: e.value,
  }));
  assert.deepEqual(stored, expected);
  // The next read upserts: no duplicate, the new hours added.
  await clock.advance(HOUR + 1_000);
  const after = gladys.fake.energyCalendars[CALENDAR_KEY];
  assert.equal(new Set(after.map((e) => e.starts_at)).size, after.length);
  assert.equal(after.length, 62);
});

test('the data date is when Corrently computed it, never later than the read', async (t) => {
  const computed = START - 3 * HOUR;
  const { app, dataDir } = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        () => {
          const body = answerAt(FIXTURE_START);
          body.forecast = body.forecast.map((e) => ({ ...e, iat: computed }));
          body.forecast[3].iat = START + 10 * HOUR; // a future one is ignored as oldest
          return json(body);
        },
      ],
    ],
  });
  await app.start({ zip: '10115' });
  await app.reading;
  assert.equal(readData(dataDir).fetched_at, computed);
});

test('an iat in the future is not the data date: the read time is', async (t) => {
  const { app, dataDir } = setup(t, {
    routes: [
      [
        /gsi\/prediction/,
        () => {
          const body = answerAt(FIXTURE_START);
          body.forecast = body.forecast.map((e) => ({ ...e, iat: START + 10 * HOUR }));
          return json(body);
        },
      ],
    ],
  });
  await app.start({ zip: '10115' });
  await app.reading;
  const { fetched_at: date } = readData(dataDir);
  assert.ok(date >= START && date < START + 60_000, String(date - START));
});
