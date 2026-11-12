# TODO

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, `docker_image`, User-Agent).
- SDK `^0.16.0` (latest on npm on 2026-11-11). `gladys_version >=5.3.0`: energy calendars and
  `countries: ["DE"]` (rule of 2026-11-12: a single-country module declares it).
- Source: the official API `api.corrently.io/v2.0/gsi/prediction` (works without token, "fair use";
  answers show a deprecation warning for the access without token, hence the optional token sent as
  `Authorization: Bearer`, which the API accepts). One read per hour at most, attempt time in `/data`
  before the request; failures 1 h, 2 h, 4 h, 6 h; `Retry-After` obeyed up to 24 h.
- `energyprice` is NOT published: on 2026-11-11 it was between -0.02 and -0.03 for every hour in Berlin,
  undocumented as a retail tariff. So no Corrently energy contract template (brief: "to be confirmed as a
  real Corrently tariff" — not confirmed). Only a calendar of levels.
- Calendar key `green-power-index-de`, `thirty_minutes` (the forecast is hourly; Gladys calendars take
  day, 30 or 15 minutes), values `low` / `medium` / `high` at fixed bounds 34 and 67. Never change.
- GSI features: category `unknown` (no core category for an index; no unit allowed). Hours to the best
  hour: `duration` / `integer` / `hours`.
- Device external id `zip:<postcode>`, features `gsi`, `gsi-next`, `gsi-best-24h`, `hours-to-best`.
- No `keywords` in the manifest.
- Status and test-button texts as { en, fr } objects (setConnectionStatus refuses a plain string;
  the SDK fake Gladys does not check it, a test does).

## Later

- Scene trigger "greenest hour starts" and a scene action "greenest window of N hours".
- CO2 fields once Corrently fills them again.
