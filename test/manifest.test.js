// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTION_TEST } from '../src/app.js';
import { CALENDAR_KEY, CALENDAR_TIMEZONE, LEVELS, USER_AGENT, VERSION } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('one version everywhere, a real semver, never a moving tag', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(VERSION, manifest.version, 'the User-Agent version');
  assert.ok(USER_AGENT.includes(`/${manifest.version} `));
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-corrently:${manifest.version}`);
  assert.doesNotMatch(manifest.docker_image, /:latest$/);
});

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.3.0', '`countries` needs Gladys 5.3');
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(manifest.keywords, undefined);
  assert.deepEqual(manifest.countries, ['DE'], 'German postcodes only');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
});

test('every text is in English and French; no secret wording that lies', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
  ]) {
    assert.doesNotMatch(read(file), /chiffré|encrypt|hachage|verschlüssel/i, file);
  }
});

test('the configuration: postcode as text, optional secret token without default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const key of Object.keys(fields)) {
    assert.doesNotMatch(key, /^gladys_/);
  }
  assert.equal(fields.zip.type, 'string', 'a number would drop the leading zero');
  assert.equal(fields.zip.required, true);
  assert.equal(fields.token.type, 'secret');
  assert.equal(fields.token.required, false);
  assert.equal(fields.token.default, undefined);
  assert.equal(fields.token.placeholder, undefined);
  for (const field of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(field.default, undefined);
    assert.equal(field.required, undefined);
  }
});

test('the action and the calendar are wired', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    [ACTION_TEST],
  );
  assert.ok(index.includes('onAction(ACTION_TEST'));
  const { calendars, templates } = manifest.energy_contracts;
  assert.equal(templates, undefined, 'no tariff template: the index is not a price');
  assert.deepEqual(calendars, [
    {
      key: CALENDAR_KEY,
      granularity: 'thirty_minutes',
      timezone: CALENDAR_TIMEZONE,
      values: LEVELS.map(([name]) => name),
    },
  ]);
  assert.doesNotMatch(CALENDAR_KEY, /corrently/, 'calendar keys carry no provider name');
});

test('the docs exist in both languages, long enough for the store', () => {
  for (const lang of ['en', 'fr']) {
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md`);
  }
});
