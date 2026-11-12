// -----------------------------------------------------------------------------
// The GrünstromIndex answer, checked field by field. Pure.
//
// What is used: `timeStamp` (start of the hour, ms) and `gsi` (0-100) of each
// slot. Not used: `energyprice` (a signed value of a few cents that is not a
// documented retail tariff: never published as a price), the CO2 fields
// (often null) and the signatures.
// -----------------------------------------------------------------------------

import { API_URL, HOUR, MAX_SLOTS } from './constants.js';
import { getJson } from './http.js';

export class AnswerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnswerError';
  }
}

/** The URL of a postcode. */
export function predictionUrl(zip) {
  const url = new URL(API_URL);
  url.searchParams.set('zip', zip);
  return url.toString();
}

/** A strict number: a JSON number, finite. '' or null is unknown, never 0. */
const strictNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The slots of an answer: `[{ t, gsi }]` sorted by start, one per hour.
 * A slot with a missing, out-of-range or non-numeric index is left out (an
 * unknown hour stays unknown). Throws AnswerError when the envelope is not a
 * GrünstromIndex forecast or belongs to another postcode.
 */
export function parsePrediction(body, zip) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AnswerError('not a GrünstromIndex answer');
  }
  if (!Array.isArray(body.forecast)) {
    throw new AnswerError('no forecast in the answer');
  }
  const location = body.location?.zip;
  if (location !== undefined && String(location) !== zip) {
    throw new AnswerError('the answer is for another postcode');
  }
  const slots = new Map();
  for (const entry of body.forecast.slice(0, MAX_SLOTS)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (entry.zip !== undefined && String(entry.zip) !== zip) {
      continue;
    }
    const t = strictNumber(entry.timeStamp);
    const gsi = strictNumber(entry.gsi);
    if (t === undefined || t % HOUR !== 0 || gsi === undefined || gsi < 0 || gsi > 100) {
      continue;
    }
    const frame = entry.timeframe;
    if (frame && (frame.start !== t || frame.end !== t + HOUR)) {
      continue;
    }
    slots.set(t, { t, gsi: Math.round(gsi) });
  }
  return [...slots.values()].sort((a, b) => a.t - b.t);
}

/** When Corrently computed the forecast: the oldest `iat` (ms), or undefined. */
export function computedAt(body) {
  let oldest;
  for (const entry of Array.isArray(body?.forecast) ? body.forecast.slice(0, MAX_SLOTS) : []) {
    const iat = strictNumber(entry?.iat);
    if (iat !== undefined && iat > 0 && (oldest === undefined || iat < oldest)) {
      oldest = iat;
    }
  }
  return oldest;
}

/** Read the forecast of a postcode: `{ slots, date, computedAt }`. */
export async function fetchPrediction({ zip }) {
  const { body, date } = await getJson(predictionUrl(zip));
  return { slots: parsePrediction(body, zip), date, computedAt: computedAt(body) };
}

/**
 * The wait asked by a `Retry-After` header, in ms, or undefined. A date is
 * compared to the answer's own `Date` header (never to our clock); without a
 * readable `Date`, a date is ignored.
 */
export function retryAfterMs(retryAfter, date) {
  if (retryAfter === undefined || retryAfter === null) {
    return undefined;
  }
  const text = String(retryAfter).trim();
  if (/^\d{1,9}$/.test(text)) {
    return Number(text) * 1000;
  }
  const until = Date.parse(text);
  const at = date ? Date.parse(date) : NaN;
  if (Number.isNaN(until) || Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, until - at);
}
