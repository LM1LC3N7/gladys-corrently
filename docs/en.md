# Corrently GrünstromIndex

Unofficial connector, not affiliated with Corrently or STROMDAO. **Never tested with a real Gladys
installation yet**: it was tested against the live Corrently API and a simulated Gladys.

The GrünstromIndex (green power index) tells, from 0 to 100, how much of the power around a German
postcode comes from renewables, hour by hour, about three days ahead. Use it to run the washing
machine, the heat pump or the car charge in the greenest hours.

## Setup

1. Enter your **German postcode** (five digits, leading zero included, e.g. `01067`).
2. Optional: a free **token** from [console.corrently.io](https://console.corrently.io/). Corrently
   announces the end of the access without token; with one, the module goes on working. The token is
   kept by Gladys in its database, never shown again, and only sent to Corrently (in an
   `Authorization` header, not in the address).
3. Save, then open the device `GrünstromIndex <postcode>` in the integration's devices page.

## What you get

| Feature                       | Meaning                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| GrünstromIndex                | The index of the current hour (0-100)                                |
| GrünstromIndex next hour      | The index of the next hour                                           |
| GrünstromIndex best of 24 h   | The highest index of the 24 hours starting with the current one      |
| Hours until the greenest hour | Hours from now to that greenest hour (0: now; the earliest on a tie) |

An hour the forecast does not cover stays unknown (no value is published); the best of 24 h stays
unknown unless all 24 hours are known. A forecast older than 72 hours is not used.

**Energy calendar** `green-power-index-de`: every half hour gets a level, `low` (index 0-33),
`medium` (34-66) or `high` (67-100), up to seven days ahead. A tariff template of the Gladys energy
contracts (community catalogue or another integration) can read it. These bounds never change.

## Reads and fair use

- One read per hour at most, as the Corrently fair-use policy asks. The time of each attempt is saved
  in `/data` before the request, so a restart or a configuration save does not read sooner. Changing
  the postcode allows a read two minutes after the previous one.
- The **Read the forecast** button reads only when the last read is an hour old; otherwise it shows the
  forecast in memory and the time of the next read.
- After a failure, the wait doubles: 1 h, 2 h, 4 h, then 6 h. A `429` answer with a longer
  `Retry-After` is obeyed (24 h at most).
- If Corrently answers `401`/`403` while a token is sent, the token is considered refused: only an
  8-bit salted fingerprint is kept in `/data`, it is not sent again, and the reads go on without it until
  you enter another token. (After a restart only the fingerprint is known: a new token with the same
  fingerprint, 1 chance in 256, waits until you change it again.)
- If `/data` cannot be read or written, the module does not read Corrently (it could not keep the hourly
  spacing) and retries `/data` every 10 seconds.

## Not included

- **Corrently tariff.** The answer has an `energyprice` field, but it is a signed value of a few cents
  (often negative) that is not documented as a retail tariff: it is never published as a price, and the
  module offers no energy contract template.
- The CO2 fields of the answer (often empty) and the solar forecast.

## Data and licence

Data: Corrently / STROMDAO GmbH, licence **CC BY-NC-SA 4.0** (non-commercial use, attribution).
Documentation: [corrently.io/books/grunstromindex](https://corrently.io/books/grunstromindex). The
module itself is Apache-2.0.
