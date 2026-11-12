// -----------------------------------------------------------------------------
// One Gladys device per postcode, with its index features. Pure.
// Keys are forever: the device type `zip` and the feature keys are stored in
// the users' dashboards and scenes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'zip';

export const FEATURE = {
  CURRENT: 'gsi',
  NEXT: 'gsi-next',
  BEST: 'gsi-best-24h',
  HOURS_TO_BEST: 'hours-to-best',
};

const INDEX = {
  category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
  type: DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
  min: 0,
  max: 100,
};

const FEATURES = [
  [FEATURE.CURRENT, 'GrünstromIndex', INDEX],
  [FEATURE.NEXT, 'GrünstromIndex next hour', INDEX],
  [FEATURE.BEST, 'GrünstromIndex best of 24 h', INDEX],
  [
    FEATURE.HOURS_TO_BEST,
    'Hours until the greenest hour',
    {
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.HOURS,
      min: 0,
      max: 23,
    },
  ],
];

/** The external ids of a postcode: `{ device, feature(key) }`. */
export function idsOf(gladys, zip) {
  return gladys.externalIds(DEVICE_TYPE, zip);
}

export function buildDevice(gladys, zip) {
  const ids = idsOf(gladys, zip);
  return {
    name: `GrünstromIndex ${zip}`,
    external_id: ids.device,
    params: [{ name: 'ZIP', value: zip }],
    should_poll: false,
    features: FEATURES.map(([key, name, shape]) => ({
      name,
      external_id: ids.feature(key),
      ...shape,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    })),
  };
}

/** The states of a snapshot (forecast.js), unknown values left out. */
export function buildStates(gladys, zip, snap) {
  const ids = idsOf(gladys, zip);
  const values = {
    [FEATURE.CURRENT]: snap.current,
    [FEATURE.NEXT]: snap.next,
    [FEATURE.BEST]: snap.best,
    [FEATURE.HOURS_TO_BEST]: snap.hoursToBest,
  };
  return Object.entries(values)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => ({ device_feature_external_id: ids.feature(key), state: value }));
}
