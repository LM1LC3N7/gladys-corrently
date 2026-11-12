// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET with a timeout, an
// identifiable User-Agent and a bounded body. The tests replace `fetch` with
// `setFetch()`.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  constructor(status, { retryAfter, date } = {}) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.date = date;
  }
}

export class BodyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BodyError';
  }
}

/** Read a body, aborting as soon as it exceeds `limit` bytes. */
async function readBounded(response, limit, controller) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    controller.abort();
    throw new BodyError('answer too large');
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      controller.abort();
      await reader.cancel().catch(() => {});
      throw new BodyError('answer too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET a JSON document. Throws HttpError on a non-2xx status (with
 * the `Retry-After` and `Date` headers), BodyError on an oversized or
 * unreadable body; a timeout or a network failure rejects as is.
 */
export async function getJson(url, { timeout = HTTP_TIMEOUT, limit = MAX_BODY_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(1, timeout));
  try {
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) {
      controller.abort();
      throw new HttpError(response.status, {
        retryAfter: response.headers.get('retry-after') ?? undefined,
        date: response.headers.get('date') ?? undefined,
      });
    }
    const text = await readBounded(response, limit, controller);
    try {
      return { body: JSON.parse(text), date: response.headers.get('date') ?? undefined };
    } catch {
      throw new BodyError('answer is not JSON');
    }
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof HttpError) && !(err instanceof BodyError)) {
      throw new Error('no answer in time', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
