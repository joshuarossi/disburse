/** Isolated built-app wallet. Keys remain in the host process; every signature and
 * transaction requires a scenario-specific authorization callback. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { hexToString } from 'viem';

export async function openQaWallet({ browser, account, chain, orgId, theme, baseURL, signTypedData, signRawMessage, sendTransaction, onSession }) {
  const context = await browser.newContext({ viewport: { width: theme === 'dark' ? 430 : 1440, height: 1080 } });
  let connected = false;
    await context.exposeFunction('qaWalletRequest', async (request) => {
      try {
        const { method, params = [] } = request;
        if (['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(method)) console.log(`QA wallet: ${method}`);
        if (method === 'eth_requestAccounts') { connected = true; return { value: [account.address] }; }
        if (method === 'eth_accounts') return { value: connected ? [account.address] : [] };
        if (method === 'eth_chainId') return { value: '0xaa36a7' };
        if (method === 'net_version') return { value: '11155111' };
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return { value: [{ parentCapability: 'eth_accounts' }] };
        if (method === 'wallet_getCapabilities') return { value: {} };
        if (method === 'wallet_switchEthereumChain') { assert.equal(Number(params[0].chainId), 11155111); return { value: null }; }
        if (method === 'personal_sign') {
          assert.equal(params[1].toLowerCase(), account.address.toLowerCase());
          if (/^0x[0-9a-f]{64}$/i.test(params[0]) && signRawMessage) return await signRawMessage(params[0]);
          const message = hexToString(params[0]);
          assert.ok(message.toLowerCase().includes(account.address.toLowerCase()) && message.includes('Nonce:') && message.includes('URI:'));
          return { value: await account.signMessage({ message }) };
        }
        if (method === 'eth_signTypedData_v4') {
          assert.equal(params[0].toLowerCase(), account.address.toLowerCase());
          return await signTypedData(JSON.parse(params[1]));
        }
        if (method === 'eth_sendTransaction') return await sendTransaction(params[0]);
        if (['eth_getBalance', 'eth_getCode', 'eth_call', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getTransactionCount'].includes(method)) return { value: await chain.request({ method, params }) };
        return { error: { code: 4200, message: `QA wallet does not support ${method}` } };
      } catch (error) { console.log(`QA wallet ${request.method} failed: ${error instanceof Error ? error.message.slice(0, 250) : 'Unknown error'}`); return { error: { code: -32603, message: error instanceof Error ? error.message : 'QA request failed' } }; }
    });
    await context.addInitScript(({ orgId, theme, account }) => {
      sessionStorage.setItem(`disburse:activity:${orgId}`, 'test'); localStorage.setItem('theme', theme);
      const events = new Map();
      const provider = {
        isConnected: () => true,
        selectedAddress: account,
        chainId: '0xaa36a7',
        request: async args => { const response = await window.qaWalletRequest(args); if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code }); return response.value; },
        on: (event, listener) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(listener); },
        removeListener: (event, listener) => events.get(event)?.delete(listener),
      };
      window.ethereum = provider;
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: '97673b55-d1da-4b47-9afb-f35c519ba251', name: 'Disburse QA Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="royalblue"/></svg>', rdns: 'qa.disburse.wallet' }, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce); announce();
    }, { orgId: orgId, theme, account: account.address });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(`${baseURL}/login`);
    await page.getByRole('button', { name: /^Connect wallet$/i }).click();
    await page.getByRole('button', { name: /Disburse QA Wallet/ }).click();
    await expect(page).toHaveURL(/select-org/, { timeout: 60000 });
  const token = await page.evaluate(() => localStorage.getItem('disburse.sessionToken'));
  if (token) onSession(token);
  return page;
}
