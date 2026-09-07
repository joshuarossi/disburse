import { pathToFileURL } from 'node:url';

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

// Never include environment values in diagnostics; hosting logs can be public.
export function releaseConfigurationErrors(env) {
  const errors = [];
  const cloud = httpsOrigin(env.VITE_CONVEX_URL);
  if (!cloud || !/^[a-z0-9-]+\.convex\.cloud$/.test(cloud.hostname) ||
      /^(your-project|example)\./.test(cloud.hostname)) {
    errors.push('VITE_CONVEX_URL must identify the selected Convex cloud deployment.');
  }
  if (!/^[a-f0-9]{32}$/i.test(env.VITE_WALLETCONNECT_PROJECT_ID ?? '')) {
    errors.push('VITE_WALLETCONNECT_PROJECT_ID must be a configured WalletConnect project ID.');
  }
  if (!['true', 'false'].includes(env.VITE_GELATO_RELAY_ENABLED)) {
    errors.push('Set VITE_GELATO_RELAY_ENABLED explicitly to true or false.');
  }
  if (env.VITE_CONVEX_SITE_URL) {
    const site = httpsOrigin(env.VITE_CONVEX_SITE_URL);
    if (!site || site.hostname.endsWith('.convex.cloud')) {
      errors.push('VITE_CONVEX_SITE_URL must be an HTTPS HTTP-action origin.');
    } else if (site.hostname.endsWith('.convex.site') && cloud &&
        site.hostname !== cloud.hostname.replace(/\.convex\.cloud$/, '.convex.site')) {
      errors.push('VITE_CONVEX_SITE_URL and VITE_CONVEX_URL name different deployments.');
    }
  }
  for (const name of Object.keys(env)) {
    if (/^VITE_.*(?:PRIVATE_KEY|SECRET|DEPLOY_KEY|API_KEY|OUTBOX_KEY)$/.test(name) && env[name]) {
      errors.push(`${name} is a service credential name and must not be exposed to the browser.`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = releaseConfigurationErrors(process.env);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('Release browser configuration passed. Provider and backend acceptance remain separate checks.');
  }
}
