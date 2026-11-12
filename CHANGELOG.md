# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- Corrently GrünstromIndex of a German postcode: index now, next hour, best of
  the next 24 hours and the hours until it.
- The Gladys energy calendar `green-power-index-de` (low, medium, high per half
  hour).
- `countries: ["DE"]` in the manifest (German postcodes only), Gladys 5.3.0 or
  later.
- One read per hour at most (Corrently fair use), kept across restarts; optional
  token.
