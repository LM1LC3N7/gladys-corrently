// -----------------------------------------------------------------------------
// Constants: endpoint, limits and schedule. The schedule follows the Corrently
// fair-use policy: one read per hour at most.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const USER_AGENT = `gladys-corrently/${VERSION} (+https://github.com/LM1LC3N7/gladys-corrently)`;

// The official GrünstromIndex forecast: hourly slots for about five days,
// per German postcode, read without a token ("fair use").
export const API_URL = 'https://api.corrently.io/v2.0/gsi/prediction';

// Answers: about 61 KB for 120 slots. Anything beyond is cut before it is read
// whole, and a read never lasts more than the timeout.
export const MAX_BODY_BYTES = 1024 * 1024;
export const HTTP_TIMEOUT = 15_000;
export const MAX_SLOTS = 500;

// Schedule. Every read (failed or not) is at least READ_INTERVAL after the
// previous one, restarts and postcode changes included (the attempt time is
// in /data first).
export const HOUR = 60 * 60_000;
export const READ_INTERVAL = HOUR;
// Failures double the wait, from one hour to six; a 429 Retry-After longer
// than that is still obeyed, up to MAX_PAUSE.
export const MAX_BACKOFF = 6 * HOUR;
export const MAX_PAUSE = 24 * HOUR;
// A forecast slot is used for at most this long after the read that gave it.
export const MAX_DATA_AGE = 72 * HOUR;
// Past slots kept in the cache (the current hour stays known after a read).
export const KEEP_PAST = 48 * HOUR;
// /data: one read at a time, bounded; retried on its own timer when it fails.
export const DATA_TIMEOUT = 5_000;
export const DATA_RETRY = 10_000;
// getConfig() failing in `connected`: retried with this spacing (doubling).
export const CONFIG_RETRY_MIN = 10_000;
export const CONFIG_RETRY_MAX = 5 * 60_000;

// The Gladys energy calendar fed with the index level of every half hour.
// Key without the provider name (calendar keys are shared); its granularity
// never changes once published.
export const CALENDAR_KEY = 'green-power-index-de';
export const CALENDAR_TIMEZONE = 'Europe/Berlin';
export const CALENDAR_AHEAD = 7 * 24 * HOUR;
// Fixed levels, part of the calendar contract: never change them.
export const LEVELS = [
  ['low', 0],
  ['medium', 34],
  ['high', 67],
];
