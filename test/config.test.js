import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('a German postcode keeps its leading zero', () => {
  assert.equal(normalizeConfig({ zip: '01067' }).zip, '01067');
  assert.equal(normalizeConfig({ zip: ' 69256 ' }).zip, '69256');
  assert.equal(normalizeConfig({ zip: 69256 }).zip, '69256');
});

test('a missing or invalid postcode is an error, never echoed', () => {
  assert.equal(normalizeConfig({}).error, 'zip_missing');
  assert.equal(normalizeConfig({ zip: '' }).error, 'zip_missing');
  for (const zip of ['1234', '123456', '12a45', '00000', '101 15', '10115&x=1', 1067]) {
    const config = normalizeConfig({ zip });
    assert.equal(config.zip, undefined, String(zip));
    assert.equal(config.error, 'zip_invalid', String(zip));
  }
});

test('a token field left over from an older version is ignored', () => {
  assert.deepEqual(normalizeConfig({ zip: '10115', token: 'x' }), {
    zip: '10115',
    error: undefined,
  });
});
