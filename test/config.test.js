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

test('the token is optional, trimmed, and refused with control bytes or spaces', () => {
  assert.equal(normalizeConfig({ zip: '10115' }).token, undefined);
  assert.equal(normalizeConfig({ zip: '10115', token: '  abc.DEF-123  ' }).token, 'abc.DEF-123');
  for (const token of ['a\r\nX-Evil: 1', 'a b', 'tab\tx', 'é', 'x'.repeat(513)]) {
    const config = normalizeConfig({ zip: '10115', token });
    assert.equal(config.token, undefined);
    assert.equal(config.zip, '10115', 'the postcode still works');
    assert.equal(config.error, 'token_invalid');
  }
});
