// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The token is never logged, stored in /data or shown back: only its
// presence and a short salted fingerprint (see app.js) leave this module.
// -----------------------------------------------------------------------------

// German postcodes: five digits, leading zero kept (01067 Dresden), so the
// form field is a string, never a number.
const ZIP = /^\d{5}$/;
// Printable ASCII only: no space, no CR/LF or control byte in a header.
const TOKEN = /^[\x21-\x7e]{1,512}$/;

/**
 * `{ zip, token, error }`: `zip` undefined when missing or invalid, `token`
 * undefined when empty; `error` names the field to fix (never its value).
 */
export function normalizeConfig(raw = {}) {
  const zipText = typeof raw.zip === 'string' || typeof raw.zip === 'number' ? String(raw.zip) : '';
  const zip = zipText.trim();
  const tokenText = typeof raw.token === 'string' ? raw.token.trim() : '';
  const config = { zip: undefined, token: undefined, error: undefined };
  if (!zip) {
    config.error = 'zip_missing';
  } else if (!ZIP.test(zip) || zip === '00000') {
    config.error = 'zip_invalid';
  } else {
    config.zip = zip;
  }
  if (tokenText) {
    if (TOKEN.test(tokenText)) {
      config.token = tokenText;
    } else {
      config.error ??= 'token_invalid';
    }
  }
  return config;
}
