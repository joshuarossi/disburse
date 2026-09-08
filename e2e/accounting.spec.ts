import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function openAccounting(page: Page, scenario = 'accounting') {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.addInitScript(value => sessionStorage.setItem('qa:scenario', value), scenario);
  await page.goto('/org/demo/reports');
  await page.getByRole('button', { name: 'Reconciliation', exact: true }).click();
}

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) test(`${theme}: reconcile net company transfer and retained delivery fee through clearing`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(value => localStorage.setItem('theme', value), theme);
  await openAccounting(page, 'accounting-treasury');
  await page.getByRole('button', { name: 'Review with books', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('100.05 USDC');
  await expect(dialog).toContainText('same transfer clearing account');
  const treatment = dialog.getByLabel('How is this recorded in your books?');
  await expect(treatment.locator('option')).toHaveCount(3);
  await treatment.selectOption('internal_transfer');
  await dialog.getByLabel('Offset account in your books').selectOption('clearing');
  await dialog.getByLabel('Book / obligation reference').fill('CCTP-TRANSFER-1');
  await dialog.getByLabel('Asset book value · USD', { exact: true }).fill('100.05');
  await expect(dialog.getByRole('button', { name: 'Prepare journal' })).toBeDisabled();
  await dialog.getByLabel('Delivery fee book value · USD', { exact: true }).fill('0.20');
  await dialog.getByLabel('Delivery fee expense account').selectOption('delivery');
  await dialog.getByLabel('Book value evidence').fill('Reviewed USDC carrying value and Circle delivery receipt');
  const journal = width < 640 ? dialog.getByRole('list', { name: 'Journal preview in USD' }) : dialog.getByRole('table', { name: 'Journal preview in USD' });
  await expect(journal).toContainText('100.25');
  await expect(journal).toContainText('Transfer delivery fees');
  await expect(journal).toContainText('0.20');
  await dialog.getByRole('checkbox', { name: 'I reviewed the book values' }).check();
  await dialog.getByRole('button', { name: 'Prepare journal', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!).args)).toMatchObject({ treatment: 'internal_transfer', assetBookValue: '100.05', deliveryFeeBookValue: '0.20', deliveryFeeAccountId: 'delivery', counterAccountId: 'clearing' });
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await journal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`treasury-journal-${theme}.png`) });
});

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`an accountant settles an existing bill without recording a second expense in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await openAccounting(page);
    await page.getByRole('button', { name: 'Review with books', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('100.000001 USDC');
    await expect(dialog).toContainText('Operations · Base');
    await dialog.getByLabel('How is this recorded in your books?').selectOption('existing_payable');
    await expect(dialog.getByLabel('Holding account in your books')).toHaveValue('holding');
    await dialog.getByLabel('Offset account in your books').selectOption('payable');
    await dialog.getByLabel('Book / obligation reference').fill('QBO-BILL-1042');
    await dialog.getByLabel('Asset book value · USD', { exact: true }).fill('99.80');
    await dialog.getByLabel('Obligation settled · USD').fill('100.00');
    await dialog.getByLabel('Vendor or customer name in the books').fill('Studio North');
    await dialog.getByLabel('Valuation difference account, if needed').selectOption('gain');
    await dialog.getByLabel('Book value evidence').fill('Carrying value from August close schedule');
    const preview = width < 640 ? dialog.getByRole('list', { name: 'Journal preview in USD' }) : dialog.getByRole('table', { name: 'Journal preview in USD' });
    await expect(preview).toContainText('Accounts Payable');
    await expect(preview).toContainText('0.20');
    await expect(preview).not.toContainText('Professional services');
    await expect(dialog.getByRole('button', { name: 'Prepare journal' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'I reviewed the book values' }).check();
    await dialog.getByRole('button', { name: 'Prepare journal', exact: true }).click();
    const call = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!));
    expect(call.name).toBe('accounting:review');
    expect(call.args).toMatchObject({ treatment: 'existing_payable', assetBookValue: '99.80', obligationBookValue: '100.00',
      counterAccountId: 'payable', assetAccountId: 'holding', differenceAccountId: 'gain', externalName: 'Studio North', expectedFingerprint: 'verified-settlement-identity' });
    await expect(dialog.getByRole('alert')).toContainText('read-only');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/accounting-review-${theme}.png`, fullPage: true });
  });
}

test('invoice overpayment requires a customer liability rather than a gain', async ({ page }) => {
  await openAccounting(page, 'accounting-excess');
  await page.getByRole('button', { name: 'Invoice receipts', exact: true }).click();
  await page.getByRole('button', { name: 'Review with books', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('250.000001 USDC is an excess receipt');
  await dialog.getByLabel('How is this recorded in your books?').selectOption('existing_receivable');
  await dialog.getByLabel('Offset account in your books').selectOption('receivable');
  await dialog.getByLabel('Asset book value · USD', { exact: true }).fill('1250.00');
  await dialog.getByLabel('Obligation settled · USD').fill('1000.00');
  await dialog.getByLabel('Vendor or customer name in the books').fill('Acme Studio');
  await expect(dialog.getByRole('button', { name: 'Prepare journal' })).toBeDisabled();
  await dialog.getByLabel('Excess receipt book value · USD').fill('250.00');
  await dialog.getByLabel('Customer liability for excess receipt').selectOption('advance');
  const journal = dialog.getByRole('table', { name: 'Journal preview in USD' });
  await expect(journal).toContainText('Customer advances');
  await expect(journal).not.toContainText('Realized gains');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});

test('chart import previews exact account IDs, hierarchy and type before saving', async ({ page }) => {
  await openAccounting(page);
  await page.getByRole('button', { name: 'Book and account settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import chart CSV').setInputFiles({ name: 'accounts.csv', mimeType: 'text/csv',
    buffer: Buffer.from('account_id,account_name,account_type,active\n00012,Digital assets:Payroll,asset,true\n00210,Accounts Payable,payable,true') });
  await expect(dialog.getByRole('cell', { name: '00012', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Digital assets:Payroll', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 reviewed accounts' }).click();
  const call = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!));
  expect(call.name).toBe('accounting:importAccounts');
  expect(call.args.accounts[0]).toEqual({ externalId: '00012', name: 'Digital assets:Payroll', kind: 'asset', active: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});

test('an existing export downloads stable journal numbers and exact movement evidence', async ({ page }) => {
  await openAccounting(page);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await page.getByRole('button', { name: 'Open export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download journal CSV' }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv).toContain('Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits,Name');
  expect(csv.match(/DSB-1,/g)).toHaveLength(3);
  expect(csv).toContain('Accounts Payable');
  expect(csv).toContain('100.00,,Studio North');
  const evidenceDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download reconciliation evidence' }).click();
  const evidence = await readFile((await (await evidenceDownload).path())!, 'utf8');
  expect(evidence).toContain('100.000001,100000001,USDC');
  expect(evidence).toContain('QBO-BILL-1042');
  await expect(dialog.getByRole('button', { name: 'Confirm import', exact: true })).toBeDisabled();
  await dialog.getByLabel('Import reference in your books').fill('QBO-IMPORT-2026-9');
  await dialog.getByRole('checkbox', { name: 'I verified that every journal' }).check();
  await dialog.getByRole('button', { name: 'Confirm import', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!).args.reference)).toBe('QBO-IMPORT-2026-9');
});

test('missing settlement evidence presents a recoverable explanation instead of a review form', async ({ page }) => {
  await openAccounting(page, 'accounting-evidence-missing');
  await page.getByRole('button', { name: 'Review with books', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Refresh account history');
  await expect(page.getByRole('button', { name: 'Prepare journal' })).toHaveCount(0);
});

test('correcting an imported journal shows its original and requires a linked reason', async ({ page }) => {
  await openAccounting(page, 'accounting-correction');
  await page.getByRole('button', { name: 'Review with books', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('DSB-1');
  await dialog.getByRole('button', { name: 'Correct this journal' }).click();
  await expect(dialog).toContainText('reversal and a replacement for export together');
  await expect(dialog.getByLabel('Asset book value · USD', { exact: true })).toHaveValue('99.80');
  await dialog.getByLabel('Correction reason').fill('Corrected carrying value after close review');
  await dialog.getByLabel('Asset book value · USD', { exact: true }).fill('99.90');
  await dialog.getByRole('checkbox', { name: 'I reviewed the book values' }).check();
  await dialog.getByRole('button', { name: 'Save linked correction' }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!).args.replaces)).toBe('journal1');
});

test('a legacy invoice receipt can verify its original evidence without initiating a transfer', async ({ page }) => {
  await openAccounting(page, 'accounting-receipt-legacy');
  await page.getByRole('button', { name: 'Invoice receipts', exact: true }).click();
  await page.getByRole('button', { name: 'Review with books', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Verify original receipt' }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!))).toMatchObject({ name: 'receiptEvidence:verify', args: { eventId: 'receipt1' } });
  await expect(dialog.getByRole('alert')).toContainText('read-only');
});

test('balance checks retain period evidence and offer a retry after an unavailable historical read', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await openAccounting(page);
  await page.getByRole('button', { name: 'Balance checks', exact: true }).click();
  const proof = page.getByRole('region', { name: 'Balance check for Operations' });
  await expect(proof).toContainText('Balances match');
  await expect(proof).toContainText('4500 USDC');
  const download = page.waitForEvent('download');
  await proof.getByRole('button', { name: 'Download balance evidence' }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain('5000,500,1000,4500,0');
  await page.getByLabel('Account to reconcile').selectOption('safe1');
  await page.getByRole('button', { name: 'Check period balances', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Historical account data is unavailable');
  await expect(page.getByRole('button', { name: 'Check period balances', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Check period balances', exact: true }).focus();
  await page.screenshot({ path: '.local/qa/accounting-balances-mobile.png', fullPage: true });
});
