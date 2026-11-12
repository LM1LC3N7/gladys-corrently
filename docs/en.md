# Corrently GrünstromIndex

Unofficial connector, not affiliated with Corrently or STROMDAO. **Never tested with a real Gladys
installation yet**: it was tested against the live Corrently API and a simulated Gladys.

The GrünstromIndex (green power index) tells, from 0 to 100, how much of the power around a German
postcode comes from renewables, hour by hour, about five days ahead. Use it to run the washing
machine, the heat pump or the car charge in the greenest hours.

## Setup

1. Enter your **German postcode** (five digits, leading zero included, e.g. `01067`).
2. Save, then open the device `GrünstromIndex <postcode>` in the integration's devices page.

## What you get

| Feature                       | Meaning                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| GrünstromIndex                | The index of the current hour (0-100)                                |
| GrünstromIndex next hour      | The index of the next hour                                           |
| GrünstromIndex best of 24 h   | The highest index of the 24 hours starting with the current one      |
| Hours until the greenest hour | Hours from now to that greenest hour (0: now; the earliest on a tie) |

An hour the forecast does not cover stays unknown (no value is published); the best of 24 h stays
unknown unless all 24 hours are known. A forecast computed more than 72 hours ago is not used (its
date is the time Corrently computed it, which a cached copy can put a few hours back).

**Energy calendar** `green-power-index-de`: every half hour gets a level, `low` (index 0-33),
`medium` (34-66) or `high` (67-100), up to seven days ahead. A tariff template of the Gladys energy
contracts (community catalogue or another integration) can read it. These bounds never change.

## Reads and fair use

- One read per hour at most, as the Corrently fair-use policy asks. The time of each attempt is saved
  in `/data` before the request, so a restart, a configuration save or a new postcode does not read
  sooner. A configuration saved during a read keeps its answer.
- The **Read the forecast** button reads only when the last read is an hour old; otherwise it shows the
  forecast in memory and the time of the next read.
- After a failure, the wait doubles: 1 h, 2 h, 4 h, then 6 h. A `429` answer with a longer
  `Retry-After` is obeyed (24 h at most).
- If `/data` cannot be read or written, the module does not read Corrently (it could not keep the hourly
  spacing) and retries `/data` every 10 seconds.

## Not included

- **Corrently tariff.** The answer has an `energyprice` field, but it is a signed value of a few cents
  (often negative) that is not documented as a retail tariff: it is never published as a price, and the
  module offers no energy contract template.
- A Corrently token. The module reads without one, as Corrently allows at one read per hour. Corrently
  announces the end of the access without token; the token will come back once Corrently documents how
  to send it outside the address.
- The CO2 fields of the answer (often empty) and the solar forecast.

## Data and licence

Data: Corrently / STROMDAO GmbH, licence
[**CC BY-NC-SA 4.0**](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en). The data is
**adapted** by this module (index rounded to an integer, levels `low` / `medium` / `high` computed from
it); the levels of the calendar are shared under the same licence. Non-commercial use only: a
commercial use needs a licence from Corrently
([corrently.energy](https://corrently.energy/products/corrently-apis-rate-limit-erhohung)).
Documentation: [corrently.io/books/grunstromindex](https://corrently.io/books/grunstromindex). The
module itself is Apache-2.0.
