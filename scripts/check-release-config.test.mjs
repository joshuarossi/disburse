import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseConfigurationErrors } from './check-release-config.mjs';

const configured = {
  VITE_CONVEX_URL: 'https://release-check.convex.cloud',
  VITE_WALLETCONNECT_PROJECT_ID: '0123456789abcdef0123456789abcdef',
  VITE_GELATO_RELAY_ENABLED: 'false',
};

test('accepts an explicit native-fee build and matching HTTP-action deployment', () => {
  assert.deepEqual(releaseConfigurationErrors({
    ...configured, VITE_CONVEX_SITE_URL: 'https://release-check.convex.site',
  }), []);
});

test('rejects missing configuration and an implicit relay default', () => {
  assert.equal(releaseConfigurationErrors({}).length, 3);
});

test('rejects development origins, URL credentials and example deployments', () => {
  for (const url of ['http://localhost:3210', 'https://example.convex.cloud',
    'https://user:password@release-check.convex.cloud', 'https://release-check.convex.cloud/path']) {
    assert.ok(releaseConfigurationErrors({ ...configured, VITE_CONVEX_URL: url }).length);
  }
});

test('rejects a stale HTTP-action URL after the deployment changes', () => {
  assert.ok(releaseConfigurationErrors({
    ...configured, VITE_CONVEX_SITE_URL: 'https://old-deployment.convex.site',
  }).some(error => error.includes('different deployments')));
});

test('rejects a function API URL used as the HTTP-action URL', () => {
  assert.ok(releaseConfigurationErrors({
    ...configured, VITE_CONVEX_SITE_URL: configured.VITE_CONVEX_URL,
  }).some(error => error.includes('HTTP-action')));
});

test('rejects browser-exposed service secrets without logging their values', () => {
  const secret = 'private-test-value';
  const errors = releaseConfigurationErrors({ ...configured, VITE_GELATO_API_KEY: secret });
  assert.equal(errors.length, 1);
  assert.ok(!errors.join().includes(secret));
});
