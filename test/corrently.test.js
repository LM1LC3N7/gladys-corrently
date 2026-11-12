import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SLOTS, USER_AGENT } from '../src/constants.js';
import {
  AnswerError,
  computedAt,
  fetchPrediction,
  parsePrediction,
  retryAfterMs,
} from '../src/corrently.js';
import { getJson } from '../src/http.js';
import { FIXTURE_START, fixture, installFetch, json } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const HOUR = 3600_000;
const entry = (i, extra = {}) => ({
  timeStamp: FIXTURE_START + i * HOUR,
  gsi: 50,
  zip: '10115',
  timeframe: { start: FIXTURE_START + i * HOUR, end: FIXTURE_START + (i + 1) * HOUR },
  ...extra,
});

test('the recorded answer gives 30 hourly slots', () => {
  const slots = parsePrediction(fixture('prediction-10115.json'), '10115');
  assert.equal(slots.length, 30);
  assert.equal(slots[0].t, FIXTURE_START);
  assert.ok(slots.every((s) => Number.isInteger(s.gsi) && s.gsi >= 0 && s.gsi <= 100));
});

test('an unknown index is left out, never 0', () => {
  const body = {
    forecast: [
      entry(0, { gsi: '' }),
      entry(1, { gsi: null }),
      entry(2, { gsi: '42' }),
      entry(3, { gsi: -1 }),
      entry(4, { gsi: 101 }),
      entry(5, { gsi: NaN }),
      entry(6, { timeStamp: FIXTURE_START + 6 * HOUR + 1 }),
      entry(7, { zip: '20095' }),
      entry(8, { timeframe: { start: 0, end: 1 } }),
      entry(9, { gsi: 0 }),
      null,
      'x',
    ],
  };
  assert.deepEqual(parsePrediction(body, '10115'), [{ t: FIXTURE_START + 9 * HOUR, gsi: 0 }]);
});

test('an envelope that is not a forecast, or for another postcode, is refused', () => {
  for (const body of [null, [], 'x', {}, { forecast: {} }]) {
    assert.throws(() => parsePrediction(body, '10115'), AnswerError);
  }
  assert.throws(
    () => parsePrediction({ forecast: [], location: { zip: '20095' } }, '10115'),
    /another postcode/,
  );
  assert.deepEqual(parsePrediction({ forecast: [] }, '10115'), []);
});

test('slots are bounded', () => {
  const body = { forecast: Array.from({ length: MAX_SLOTS + 50 }, (_, i) => entry(i)) };
  assert.equal(parsePrediction(body, '10115').length, MAX_SLOTS);
});

test('Retry-After: seconds, or a date against the answer Date header', () => {
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(
    retryAfterMs('Wed, 11 Nov 2026 23:00:00 GMT', 'Wed, 11 Nov 2026 22:00:00 GMT'),
    3600_000,
  );
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 23:00:00 GMT'), undefined, 'no Date: ignored');
  assert.equal(retryAfterMs('soon'), undefined);
  assert.equal(retryAfterMs(undefined), undefined);
});

test('no token, no Authorization header; own User-Agent', async () => {
  fake = installFetch([[/gsi\/prediction/, () => json(fixture('prediction-10115.json'))]]);
  const { slots, computedAt: at } = await fetchPrediction({ zip: '10115' });
  assert.equal(slots.length, 30);
  assert.ok(at > 0);
  const [call] = fake.calls;
  assert.deepEqual(Object.keys(call.params), ['zip']);
  assert.equal(call.init.headers.Authorization, undefined);
  assert.equal(call.init.headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^gladys-corrently\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\//);
});

test('computedAt: the oldest numeric iat, nothing else', () => {
  assert.equal(computedAt({ forecast: [{ iat: 5 }, { iat: 3 }, { iat: '1' }, { iat: -1 }] }), 3);
  assert.equal(computedAt({ forecast: [{ iat: null }] }), undefined);
  assert.equal(computedAt({}), undefined);
});

test('an oversized answer is cut before it is read whole', async () => {
  let pulled = 0;
  fake = installFetch([
    [
      /big/,
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulled += 1;
              if (pulled > 1000) {
                controller.close();
                return;
              }
              controller.enqueue(new Uint8Array(64 * 1024));
            },
          }),
          { status: 200 },
        ),
    ],
    [
      /declared/,
      () => new Response('{}', { status: 200, headers: { 'content-length': '99999999' } }),
    ],
  ]);
  await assert.rejects(getJson('https://x.test/big', { limit: 256 * 1024 }), /too large/);
  assert.ok(pulled < 10, `read ${pulled} chunks`);
  await assert.rejects(getJson('https://x.test/declared'), /too large/);
});

test('HTTP errors carry the status and the pause headers', async () => {
  fake = installFetch([
    [
      /x/,
      () =>
        new Response('', {
          status: 429,
          headers: { 'retry-after': '600', date: 'Wed, 11 Nov 2026 22:00:00 GMT' },
        }),
    ],
  ]);
  await assert.rejects(getJson('https://x.test/'), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.retryAfter, '600');
    return true;
  });
});

test('a hanging answer times out', async () => {
  fake = installFetch([
    [
      /x/,
      (call) =>
        new Promise((_, reject) =>
          call.init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    ],
  ]);
  await assert.rejects(getJson('https://x.test/', { timeout: 50 }), /no answer in time/);
});
