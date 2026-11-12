// -----------------------------------------------------------------------------
// The integration: reads the GrünstromIndex forecast of one postcode at most
// once an hour (Corrently fair use), keeps the sensors and the energy
// calendar fed. index.js only wires the SDK handlers to it.
//
// Clocks: `now` (wall) dates the forecast slots and what goes to /data;
// `monotonic` decides when the next read may leave inside the process. After
// a restart the wait is rebuilt from the attempt time saved in /data, which
// is written BEFORE every request.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  CALENDAR_KEY,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  DATA_RETRY,
  HOUR,
  MAX_BACKOFF,
  MAX_DATA_AGE,
  MAX_PAUSE,
  READ_INTERVAL,
  ZIP_CHANGE_SPACING,
} from './constants.js';
import { fetchPrediction, retryAfterMs } from './corrently.js';
import { buildDevice, buildStates, idsOf } from './devices.js';
import { calendarEntries, mergeSlots, snapshot } from './forecast.js';
import { HttpError } from './http.js';
import { T } from './i18n.js';
import { Store } from './store.js';

export const ACTION_TEST = 'test_connection';

const defaultTimers = { setTimeout, clearTimeout };
const SKEW = 60_000;

const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 8 bits of a salted hash: enough to tell "the same token", useless to guess one. */
export function tokenFingerprint(salt, token) {
  return createHash('sha256').update(`${salt}:${token}`).digest()[0];
}

/** The wait after `failures` failures in a row: 1 h, 2 h, 4 h, then 6 h. */
export function backoff(failures) {
  return Math.min(MAX_BACKOFF, READ_INTERVAL * 2 ** Math.max(0, failures - 1));
}

export class CorrentlyApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'corrently' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    dataDir = '/data',
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = new Store({ dataDir, timers });
    this.config = normalizeConfig();
    this.state = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
    this.reading = undefined;
    this.readTimer = undefined;
    this.tickTimer = undefined;
    this.dataTimer = undefined;
    this.configTimer = undefined;
    this.configDelay = CONFIG_RETRY_MIN;
    this.readDueMono = undefined;
    this.lastStatus = undefined;
    this.lastError = undefined;
    this.refusedToken = undefined;
    this.calendarWarned = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** The `connected` event: read the config, retried without end if it fails. */
  async connected() {
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    let raw;
    try {
      raw = await this.gladys.getConfig();
    } catch (err) {
      this.logger.warn(`Reading the configuration failed: ${err.message}`);
      await this.setStatus(false, T.configUnreadable);
      const delay = this.configDelay;
      this.configDelay = Math.min(CONFIG_RETRY_MAX, this.configDelay * 2);
      this.configTimer = this.timers.setTimeout(() => this.connected(), delay);
      return;
    }
    this.configDelay = CONFIG_RETRY_MIN;
    await this.start(raw);
  }

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    return this.serialize(() => this.doStop());
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.lastError = undefined;
    this.calendarWarned = false;
    if (!this.config.zip) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    await this.publishDevices();
    if (generation !== this.generation) {
      return;
    }
    await this.loadData(generation);
  }

  async doStop() {
    this.generation += 1;
    for (const key of ['readTimer', 'tickTimer', 'dataTimer']) {
      this.timers.clearTimeout(this[key]);
      this[key] = undefined;
    }
    this.readDueMono = undefined;
    await this.reading?.catch(() => {});
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- /data -------------------------------------------------------------------

  /** Load /data; unreadable: retried every DATA_RETRY, and nothing is read meanwhile. */
  async loadData(generation) {
    this.timers.clearTimeout(this.dataTimer);
    this.dataTimer = undefined;
    const result = await this.store.load();
    if (generation !== this.generation) {
      return;
    }
    if (!result.ok) {
      this.logger.warn(`/data unreadable: ${result.error.message}`);
      await this.setStatus(false, T.dataUnreadable);
      if (generation === this.generation) {
        this.dataTimer = this.timers.setTimeout(() => this.loadData(generation), DATA_RETRY);
      }
      return;
    }
    this.state = this.sanitize(result.state, result.corrupt);
    await this.publishNow(generation);
    if (generation !== this.generation) {
      return;
    }
    this.scheduleTick();
    this.scheduleRead();
    await this.updateStatus();
  }

  /** The state of /data, every field checked; a future date is invalid. */
  sanitize(raw, corrupt) {
    const wall = this.now();
    const state = { attempt_at: undefined, attempt_zip: undefined, failures: 0, pause_until: 0 };
    if (corrupt) {
      // Unknown last attempt: as if it were now (never a read too early).
      state.attempt_at = wall;
      state.attempt_zip = this.config.zip;
    }
    if (isTime(raw.attempt_at)) {
      state.attempt_at = raw.attempt_at > wall + SKEW ? wall : raw.attempt_at;
      state.attempt_zip = typeof raw.attempt_zip === 'string' ? raw.attempt_zip : undefined;
    }
    if (Number.isInteger(raw.failures) && raw.failures > 0) {
      state.failures = Math.min(raw.failures, 16);
    }
    if (isTime(raw.pause_until)) {
      // Never longer than the longest pause this module sets: beyond, invalid.
      state.pause_until = raw.pause_until > wall + MAX_PAUSE + SKEW ? 0 : raw.pause_until;
    }
    if (
      raw.refused &&
      typeof raw.refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(raw.refused.salt) &&
      Number.isInteger(raw.refused.fp) &&
      raw.refused.fp >= 0 &&
      raw.refused.fp <= 255
    ) {
      state.refused = { salt: raw.refused.salt, fp: raw.refused.fp };
    }
    state.slots = [];
    if (
      raw.zip === this.config.zip &&
      isTime(raw.fetched_at) &&
      raw.fetched_at <= wall + SKEW &&
      Array.isArray(raw.slots)
    ) {
      state.zip = raw.zip;
      state.fetched_at = raw.fetched_at;
      state.slots = raw.slots
        .filter(
          (s) =>
            s &&
            Number.isInteger(s.t) &&
            s.t % HOUR === 0 &&
            Number.isInteger(s.gsi) &&
            s.gsi >= 0 &&
            s.gsi <= 100,
        )
        .map((s) => ({ t: s.t, gsi: s.gsi }));
    }
    return state;
  }

  // --- Devices and states ------------------------------------------------------

  async publishDevices() {
    if (!this.config.zip) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([buildDevice(this.gladys, this.config.zip)])
      .catch((err) => this.logger.warn(`Publishing the device failed: ${err.message}`));
  }

  /** The slots still usable: from a read of this postcode, less than MAX_DATA_AGE old. */
  usableSlots(wall = this.now()) {
    const state = this.state;
    if (!state || state.zip !== this.config.zip || !isTime(state.fetched_at)) {
      return [];
    }
    if (wall - state.fetched_at > MAX_DATA_AGE) {
      return [];
    }
    return state.slots;
  }

  async publishNow(generation) {
    const wall = this.now();
    const states = buildStates(
      this.gladys,
      this.config.zip,
      snapshot(this.usableSlots(wall), wall),
    );
    if (states.length === 0 || generation !== this.generation) {
      return;
    }
    await this.gladys
      .publishChangedStates(states, { heartbeat: 50 * 60_000 })
      .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
  }

  /** Every hour, one second after the hour: the sensors follow the slots. */
  scheduleTick() {
    this.timers.clearTimeout(this.tickTimer);
    const wall = this.now();
    const next = Math.floor(wall / HOUR) * HOUR + HOUR + 1_000;
    const generation = this.generation;
    this.tickTimer = this.timers.setTimeout(async () => {
      if (generation !== this.generation) {
        return;
      }
      await this.publishNow(generation);
      if (generation !== this.generation) {
        return;
      }
      await this.updateStatus();
      this.scheduleTick();
    }, next - wall);
  }

  // --- Reading Corrently -------------------------------------------------------

  /** Milliseconds before the next read may leave (0: now). */
  readDelay() {
    const state = this.state;
    if (!state) {
      return Infinity;
    }
    const wall = this.now();
    let due = 0;
    if (isTime(state.attempt_at)) {
      const spacing =
        state.attempt_zip === this.config.zip || state.failures > 0
          ? READ_INTERVAL
          : ZIP_CHANGE_SPACING;
      due = state.attempt_at + spacing;
    }
    if (isTime(state.pause_until)) {
      due = Math.max(due, state.pause_until);
    }
    return Math.min(MAX_PAUSE, Math.max(0, due - wall));
  }

  scheduleRead() {
    this.timers.clearTimeout(this.readTimer);
    this.readTimer = undefined;
    const delay = this.readDelay();
    if (!Number.isFinite(delay)) {
      return;
    }
    const mono = this.monotonic();
    this.readDueMono = mono + delay;
    const generation = this.generation;
    const fire = () => {
      if (generation !== this.generation) {
        return;
      }
      const left = this.readDueMono - this.monotonic();
      if (left > 0) {
        this.readTimer = this.timers.setTimeout(fire, left);
        return;
      }
      this.read(generation);
    };
    if (delay <= 0) {
      fire();
      return;
    }
    this.readTimer = this.timers.setTimeout(fire, delay);
  }

  /** One read; single-flight. Resolves when done (never rejects). */
  read(generation = this.generation) {
    if (!this.reading) {
      this.reading = this.doRead(generation)
        .catch((err) => this.logger.error(`Read failed: ${err.message}`))
        .finally(() => {
          this.reading = undefined;
        });
    }
    return this.reading;
  }

  /**
   * The token to send, or undefined. A refused token is never sent again on
   * its own. In this process the refused token itself is known, so any other
   * token is tried; after a restart only its 8-bit fingerprint is, and a token
   * with the same fingerprint (1 in 256) waits until it is changed again.
   */
  tokenToSend() {
    const { token } = this.config;
    if (!token) {
      return undefined;
    }
    if (this.refusedToken !== undefined) {
      return token === this.refusedToken ? undefined : token;
    }
    const refused = this.state?.refused;
    if (refused && tokenFingerprint(refused.salt, token) === refused.fp) {
      return undefined;
    }
    return token;
  }

  async doRead(generation) {
    const { zip } = this.config;
    const state = this.state;
    this.timers.clearTimeout(this.readTimer);
    this.readTimer = undefined;
    // Fair use across restarts: the attempt is on disk before the request.
    const attemptAt = this.now();
    const saved = await this.store.save({
      ...this.persisted(),
      attempt_at: attemptAt,
      attempt_zip: zip,
    });
    if (generation !== this.generation) {
      return;
    }
    if (!saved) {
      this.logger.warn('/data not writable: the read waits');
      await this.setStatus(false, T.dataUnwritable);
      this.readTimer = this.timers.setTimeout(() => this.read(generation), DATA_RETRY);
      return;
    }
    state.attempt_at = attemptAt;
    state.attempt_zip = zip;
    const token = this.tokenToSend();
    // The spacing counts from the request itself (the save above took time).
    state.attempt_at = Math.max(attemptAt, this.now());
    let result;
    let error;
    try {
      result = await fetchPrediction({ zip, token });
    } catch (err) {
      error = err;
    }
    if (generation !== this.generation) {
      return;
    }
    const wall = this.now();
    if (result) {
      const old = state.zip === zip ? state.slots : [];
      state.slots = mergeSlots(old, result.slots, wall);
      state.zip = zip;
      state.fetched_at = wall;
      state.failures = 0;
      state.pause_until = 0;
      this.lastError = undefined;
      if (token) {
        // Answered with a token: no refusal to remember any more.
        state.refused = undefined;
        this.refusedToken = undefined;
      }
    } else if (
      error instanceof HttpError &&
      (error.status === 401 || error.status === 403) &&
      token
    ) {
      // The token, not the service: remembered (fingerprint only), never sent
      // again on its own; the next read goes without it.
      const salt = randomBytes(16).toString('hex');
      state.refused = { salt, fp: tokenFingerprint(salt, token) };
      this.refusedToken = token;
      this.lastError = { message: T.tokenRefused };
      this.logger.warn('Corrently refused the token: reading without it from now on');
    } else {
      state.failures += 1;
      let wait = backoff(state.failures);
      if (error instanceof HttpError && error.status === 429) {
        wait = Math.max(wait, retryAfterMs(error.retryAfter, error.date) ?? 0);
      }
      state.pause_until = wall + Math.min(MAX_PAUSE, wait);
      this.lastError = { message: describe(error) };
      this.logger.warn(`Reading the GrünstromIndex failed: ${describe(error)}`);
    }
    if (!(await this.store.save(this.persisted()))) {
      this.logger.warn('/data not writable: the forecast is kept in memory only');
    }
    if (generation !== this.generation) {
      return;
    }
    if (result) {
      await this.publishNow(generation);
      await this.publishCalendar(result.slots, wall, generation);
    }
    if (generation !== this.generation) {
      return;
    }
    this.scheduleRead();
    await this.updateStatus();
  }

  persisted() {
    const s = this.state;
    return {
      v: 1,
      attempt_at: s.attempt_at,
      attempt_zip: s.attempt_zip,
      failures: s.failures,
      pause_until: s.pause_until,
      refused: s.refused,
      zip: s.zip,
      fetched_at: s.fetched_at,
      slots: s.slots,
    };
  }

  async publishCalendar(slots, wall, generation) {
    const entries = calendarEntries(slots, wall);
    if (entries.length === 0 || generation !== this.generation) {
      return;
    }
    try {
      await this.gladys.publishEnergyCalendar(CALENDAR_KEY, entries);
    } catch (err) {
      if (!this.calendarWarned) {
        this.calendarWarned = true;
        this.logger.warn(
          err.status === 403
            ? `Calendar ${CALENDAR_KEY} belongs to another integration: not fed`
            : `Calendar ${CALENDAR_KEY}: ${err.message}`,
        );
      }
    }
  }

  // --- Status and action -------------------------------------------------------

  async updateStatus() {
    const wall = this.now();
    const snap = snapshot(this.usableSlots(wall), wall);
    const nextRead = this.state ? wall + this.readDelay() : undefined;
    if (snap.current === undefined) {
      if (this.lastError) {
        await this.setStatus(false, T.failed(this.lastError.message, nextRead));
      } else if (this.state?.fetched_at && this.state.zip === this.config.zip) {
        await this.setStatus(false, T.noForecast(this.config.zip, nextRead));
      } else {
        await this.setStatus(false, T.waiting(nextRead));
      }
      return;
    }
    const tokenNote = this.config.error === 'token_invalid' ? T.tokenInvalid : undefined;
    await this.setStatus(
      true,
      T.ok({
        zip: this.config.zip,
        current: snap.current,
        fetchedAt: this.state.fetched_at,
        error: this.lastError?.message ?? tokenNote,
      }),
    );
  }

  /**
   * The configuration button: reads now if the fair-use spacing allows it,
   * otherwise reports the cached forecast and the time of the next read.
   */
  async testConnection() {
    if (!this.config.zip) {
      return T.configError(this.config.error);
    }
    if (!this.state) {
      return T.dataUnreadable;
    }
    if (this.reading) {
      await this.reading;
    } else if (this.readDueMono !== undefined && this.monotonic() >= this.readDueMono) {
      await this.read();
    }
    const wall = this.now();
    const snap = snapshot(this.usableSlots(wall), wall);
    return T.report({
      zip: this.config.zip,
      snap,
      fetchedAt: this.usableSlots(wall).length > 0 ? this.state.fetched_at : undefined,
      error: this.lastError?.message,
      nextRead: wall + this.readDelay(),
    });
  }

  /** The device of the current postcode (tests, scenes). */
  deviceExternalId() {
    return this.config.zip ? idsOf(this.gladys, this.config.zip).device : undefined;
  }
}

function describe(error) {
  if (error instanceof HttpError) {
    return error.status === 429 ? 'too many requests (HTTP 429)' : `HTTP ${error.status}`;
  }
  return error?.message ?? 'unknown error';
}
