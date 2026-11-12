# gladys-corrently

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the **Corrently
GrünstromIndex**: how green the power is around a German postcode, now, next hour and the greenest
hour of the next 24 hours, plus the Gladys energy calendar `green-power-index-de`.

- One read per hour at most (Corrently fair use), kept across restarts.
- Optional free token (sent as a Bearer header, never logged nor stored in `/data`).
- Never tested with a real Gladys installation yet.

Documentation: [English](docs/en.md) · [Français](docs/fr.md).

Data © Corrently / STROMDAO GmbH, CC BY-NC-SA 4.0. Not affiliated with Corrently or STROMDAO.

## Development

```sh
npm install
npm test          # node --test, no network
npm run lint && npm run format:check
node scripts/cover.mjs cover.png
```

Licence: Apache-2.0 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`).
