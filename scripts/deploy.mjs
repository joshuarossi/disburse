import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const convexCli = fileURLToPath(new URL('../node_modules/convex/bin/main.js', import.meta.url));

export function deploymentCommands(env, { dryRun = false, yes = false } = {}) {
  const deploy = ['deploy', '--cmd', 'bun run build:release',
    '--cmd-url-env-var-name', 'VITE_CONVEX_URL', '--typecheck', 'enable'];
  const commands = [deploy];
  if (dryRun) deploy.push('--dry-run');
  if (yes) deploy.push('--yes');
  if (env.CF_PAGES !== '1') return commands;

  const branch = env.CF_PAGES_BRANCH;
  if (!branch?.trim()) throw new Error('Cloudflare must supply CF_PAGES_BRANCH.');
  const key = env.CONVEX_DEPLOY_KEY ?? '';
  if (branch === 'main') {
    if (!/^prod:[a-z0-9-]+\|\S+$/.test(key)) {
      throw new Error('The main Pages build requires a production CONVEX_DEPLOY_KEY.');
    }
    if (!yes) deploy.push('--yes');
    return commands;
  }
  if (!/^preview:[a-z0-9-]+:[a-z0-9-]+\|\S+$/.test(key)) {
    throw new Error('Pages preview builds require a preview CONVEX_DEPLOY_KEY, scoped separately from production.');
  }

  // Convex 1.31.7 does not infer CF_PAGES_BRANCH. Its supported flag is
  // --preview-create; these deployments contain disposable test records.
  deploy.push('--preview-create', branch);
  let url;
  try { url = new URL(env.CF_PAGES_URL); } catch { /* Validate below. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev$/.test(url.hostname)) {
    throw new Error('Cloudflare must supply an HTTPS preview origin in CF_PAGES_URL.');
  }

  // Pages limits branch aliases to 28 characters; DNS's 63-character limit
  // is not the provider's limit. Keep the immutable origin usable as well.
  const alias = branch.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 28).replace(/^-+|-+$/g, '');
  const projectHost = url.hostname.split('.').slice(1).join('.');
  const aliasHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(alias)
    ? `${alias}.${projectHost}` : url.hostname;
  const settings = {
    SIWE_DOMAIN: aliasHost,
    SIWE_ALLOWED_DOMAINS: [...new Set([aliasHost, url.hostname])].join(','),
    PUBLIC_APP_URL: `https://${aliasHost}`,
  };
  // A newly claimed preview must accept sign-in from its actual Pages origins.
  // Do this only after a successful deployment, before Pages publishes dist.
  if (!dryRun) {
    for (const [name, value] of Object.entries(settings)) {
      commands.push(['env', 'set', name, value, '--preview-name', branch]);
    }
  }
  return commands;
}

export function runDeployment(env, options = {}, run = spawnSync) {
  for (const args of deploymentCommands(env, options)) {
    // Branch names are arguments, never interpolated into shell commands.
    const result = run('node', [convexCli, ...args], { env, stdio: 'inherit', shell: false });
    if (result.error) throw new Error('Could not start the Convex deployment command.');
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some(flag => !['--dry-run', '--yes'].includes(flag))) {
      throw new Error('Supported deployment options: --dry-run, --yes.');
    }
    process.exitCode = runDeployment(process.env, {
      dryRun: flags.includes('--dry-run'), yes: flags.includes('--yes'),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
