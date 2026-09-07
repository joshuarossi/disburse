import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentCommands, runDeployment } from './deploy.mjs';

const preview = {
  CF_PAGES: '1', CF_PAGES_BRANCH: 'codex/v2-release',
  CF_PAGES_URL: 'https://abc123.disburse.pages.dev',
  CONVEX_DEPLOY_KEY: 'preview:example:disburse|test-only',
};

test('long preview branches use the 28-character Pages alias and keep the immutable origin', () => {
  const commands = deploymentCommands({ ...preview, CF_PAGES_BRANCH: 'codex/v2-review-fixes-long-branch-name' });
  assert.deepEqual(commands[1].slice(0, 4), ['env', 'set', 'SIWE_DOMAIN', 'codex-v2-review-fixes-long-b.disburse.pages.dev']);
  assert.ok(commands[2][3].includes('abc123.disburse.pages.dev'));
});

test('Pages supplies the branch explicitly to the pinned Convex CLI', () => {
  const [deploy, ...settings] = deploymentCommands(preview);
  assert.deepEqual(deploy.slice(-2), ['--preview-create', 'codex/v2-release']);
  assert.ok(deploy.includes('VITE_CONVEX_URL'));
  assert.deepEqual(settings, [
    ['env', 'set', 'SIWE_DOMAIN', 'codex-v2-release.disburse.pages.dev', '--preview-name', 'codex/v2-release'],
    ['env', 'set', 'SIWE_ALLOWED_DOMAINS', 'codex-v2-release.disburse.pages.dev,abc123.disburse.pages.dev', '--preview-name', 'codex/v2-release'],
    ['env', 'set', 'PUBLIC_APP_URL', 'https://codex-v2-release.disburse.pages.dev', '--preview-name', 'codex/v2-release'],
  ]);
});

test('preview builds cannot deploy with production, development or unscoped keys', () => {
  for (const key of ['prod:release-check|secret', 'dev:release-check|secret', 'release-check|secret', '']) {
    assert.throws(() => deploymentCommands({ ...preview, CONVEX_DEPLOY_KEY: key }), error => {
      assert.match(error.message, /preview CONVEX_DEPLOY_KEY/);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('main requires a production key and does not modify production backend settings', () => {
  assert.throws(() => deploymentCommands({ ...preview, CF_PAGES_BRANCH: 'main' }), /production CONVEX_DEPLOY_KEY/);
  const commands = deploymentCommands({ ...preview, CF_PAGES_BRANCH: 'main', CONVEX_DEPLOY_KEY: 'prod:release-check|test-only' });
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('--yes'));
  assert.ok(!commands[0].includes('--preview-create'));
});

test('missing branch and invalid preview origins fail before invoking Convex', () => {
  assert.throws(() => deploymentCommands({ ...preview, CF_PAGES_BRANCH: '' }), /CF_PAGES_BRANCH/);
  for (const url of ['', 'https://disburse.pages.dev', 'http://abc.disburse.pages.dev',
    'https://abc.disburse.pages.dev.evil.example', 'https://user:password@abc.disburse.pages.dev',
    'https://abc.disburse.pages.dev/path']) {
    assert.throws(() => deploymentCommands({ ...preview, CF_PAGES_URL: url }), /CF_PAGES_URL/);
  }
});

test('dry runs never write preview backend environment variables', () => {
  const commands = deploymentCommands(preview, { dryRun: true });
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('--dry-run'));
});

test('local deployments preserve interactive Convex target selection', () => {
  const commands = deploymentCommands({});
  assert.equal(commands.length, 1);
  assert.ok(!commands[0].includes('--yes'));
  assert.ok(!commands[0].includes('--preview-create'));
});

test('failed builds and interrupted commands stop before writing backend settings', () => {
  for (const status of [1, 17, null]) {
    let calls = 0;
    assert.equal(runDeployment(preview, {}, () => { calls++; return { status }; }), status ?? 1);
    assert.equal(calls, 1);
  }
});

test('failed sign-in configuration also fails the Pages build', () => {
  let calls = 0;
  assert.equal(runDeployment(preview, {}, () => ({ status: ++calls === 2 ? 1 : 0 })), 1);
  assert.equal(calls, 2);
});

test('branch names are passed without shell interpretation and keys stay in the environment', () => {
  const branch = 'fix/$(touch-danger)';
  const env = { ...preview, CF_PAGES_BRANCH: branch };
  const calls = [];
  assert.equal(runDeployment(env, {}, (...args) => { calls.push(args); return { status: 0 }; }), 0);
  assert.ok(calls[0][1].includes(branch));
  for (const [, args, options] of calls) {
    assert.equal(options.shell, false);
    assert.equal(options.env, env);
    assert.ok(!args.join(' ').includes(env.CONVEX_DEPLOY_KEY));
  }
});
