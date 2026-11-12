// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// v1 has no token: the API works without one at one read per hour (TODO.md).
// -----------------------------------------------------------------------------

// German postcodes: five digits, leading zero kept (01067 Dresden), so the
// form field is a string, never a number.
const ZIP = /^\d{5}$/;

/**
 * `{ zip, error }`: `zip` undefined when missing or invalid; `error` names
 * the problem (never the value).
 */
export function normalizeConfig(raw = {}) {
  const zipText = typeof raw.zip === 'string' || typeof raw.zip === 'number' ? String(raw.zip) : '';
  const zip = zipText.trim();
  const config = { zip: undefined, error: undefined };
  if (!zip) {
    config.error = 'zip_missing';
  } else if (!ZIP.test(zip) || zip === '00000') {
    config.error = 'zip_invalid';
  } else {
    config.zip = zip;
  }
  return config;
}
