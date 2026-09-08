// Base Sepolia only. This exercises the published Safe4337 module, Circle
// paymaster and public submission endpoint. It is protocol QA, not evidence
// that every application workflow has been migrated to this execution path.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi, erc20Abi, encodeFunctionData, encodePacked, concatHex, hashTypedData, maxUint256, toHex, getAddress, keccak256, stringToHex, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { circleAccountCall, circleConfiguration, circleOperationHash, circleOperationSigningData, circlePaymasterAndData, circlePermitData, circlePrefund, circleSignature } from '../shared/circleExecution.ts';
import { circleRpc } from '../shared/circleTransport.ts';
import { circleUserOperationEvent, readCircleSettlement } from '../shared/circleSettlement.ts';
import { safeMessageTypes } from '../shared/safeSignatures.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = option('run');
if (!run || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(run)) throw new Error('Choose a unique --run=name for this test. Use --status to check an existing run.');
const directory = `${root}.local/qa/customer-fees`;
await mkdir(directory, { recursive: true });
const path = `${directory}/${run}.json`;
const json = value => JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2);
const client = createPublicClient({ chain: baseSepolia, transport: http(undefined, { retryCount: 0, timeout: 20_000 }) });
const config = circleConfiguration(baseSepolia.id);
const existing = await readFile(path, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if (await client.getChainId() !== baseSepolia.id) throw new Error('The test RPC is on a different network.');

if (process.argv.includes('--status')) {
  if (!existing?.userOpHash) throw new Error('No submitted operation was recorded for this run.');
  const numbers = ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxPriorityFeePerGas', 'maxFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
  const operation = Object.fromEntries(Object.entries(existing.operation).map(([key, value]) => [key, numbers.includes(key) ? BigInt(value) : value]));
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({ address: config.entryPoint, event: circleUserOperationEvent, args: { userOpHash: existing.userOpHash, sender: existing.safe }, fromBlock: BigInt(existing.startBlock), toBlock: head - 2n, strict: true });
  const balances = {
    ownerETH: (await client.getBalance({ address: existing.owner })).toString(),
    safeETH: (await client.getBalance({ address: existing.safe })).toString(),
    ownerUSDC: (await client.readContract({ address: config.token, abi: erc20Abi, functionName: 'balanceOf', args: [existing.owner] })).toString(),
    safeUSDC: (await client.readContract({ address: config.token, abi: erc20Abi, functionName: 'balanceOf', args: [existing.safe] })).toString(),
  };
  if (!logs.length) { console.log(json({ status: 'pending', hash: existing.userOpHash, balances })); }
  else {
    if (logs.length !== 1 || logs[0].removed) throw new Error('The network returned inconsistent execution evidence.');
    const receipt = await client.getTransactionReceipt({ hash: logs[0].transactionHash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.blockHash !== block.hash || receipt.blockNumber > head - 2n) throw new Error('Wait for the original transaction to be confirmed.');
    const settlement = readCircleSettlement(baseSepolia.id, operation, receipt);
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs, strict: true }).filter(log => !log.removed && log.address.toLowerCase() === config.token.toLowerCase() && log.args.from.toLowerCase() === existing.safe.toLowerCase() && log.args.to.toLowerCase() === existing.owner.toLowerCase());
    const received = transfers.reduce((sum, log) => sum + log.args.value, 0n);
    if (received !== (settlement.status === 'confirmed' ? BigInt(existing.amount) : 0n)) throw new Error('Recipient transfers do not match this execution result.');
    if (balances.ownerETH !== '0' || balances.safeETH !== '0') throw new Error('The test did not preserve zero native-token balances.');
    const result = { ...settlement, transactionHash: receipt.transactionHash, received, balances };
    await writeFile(path, json({ ...existing, result }));
    await writeFile(`${directory}/${run}-receipt.json`, json(receipt));
    console.log(json(result));
  }
} else {
  if (existing) throw new Error('This run already has an original request. Use --status; do not resubmit it.');
  if (!option('safe')) throw new Error('Provide --safe=0x... for a funded Base Sepolia test Safe with the published Safe4337 module.');
  const safe = getAddress(option('safe'));
  // Private test material is read locally and is never written to a result or log.
  const owner = privateKeyToAccount(JSON.parse(await readFile(`${root}.local/qa/wallet.json`, 'utf8')).privateKey);
  const accountAbi = parseAbi(['function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)', 'function isModuleEnabled(address module) view returns(bool)', 'function VERSION() view returns(string)']);
  const [owners, threshold, enabled, version, ownerETH, safeETH, storage] = await Promise.all([
    client.readContract({ address: safe, abi: accountAbi, functionName: 'getOwners' }),
    client.readContract({ address: safe, abi: accountAbi, functionName: 'getThreshold' }),
    client.readContract({ address: safe, abi: accountAbi, functionName: 'isModuleEnabled', args: [config.module] }),
    client.readContract({ address: safe, abi: accountAbi, functionName: 'VERSION' }),
    client.getBalance({ address: owner.address }), client.getBalance({ address: safe }),
    client.getStorageAt({ address: safe, slot: keccak256(stringToHex('fallback_manager.handler.address')) }),
  ]);
  if (owners.length !== 1 || owners[0].toLowerCase() !== owner.address.toLowerCase() || threshold !== 1n || !enabled || version !== '1.4.1' || storage?.slice(-40).toLowerCase() !== config.module.slice(2).toLowerCase()) throw new Error('This script requires a Safe 1.4.1 owned only by the test wallet, with Safe4337 enabled as its module and handler.');
  if (ownerETH !== 0n || safeETH !== 0n) throw new Error('This acceptance test requires zero native ETH in both the signer and Safe.');
  if (BigInt(await circleRpc(baseSepolia.id, 'eth_chainId', [])) !== BigInt(baseSepolia.id)) throw new Error('The submission service is on a different network.');
  const paymasterAbi = parseAbi(['function token() view returns(address)', 'function paused() view returns(bool)', 'function fetchPrice() view returns(uint256)', 'function feeSpread() view returns(uint32)', 'function additionalGasCharge() view returns(uint256)']);
  const [token, paused, price, spread, additionalGas] = await Promise.all(['token', 'paused', 'fetchPrice', 'feeSpread', 'additionalGasCharge'].map(functionName => client.readContract({ address: config.paymaster, abi: paymasterAbi, functionName })));
  if (token.toLowerCase() !== config.token.toLowerCase() || paused) throw new Error('The USDC gas service is not available.');
  const balance = await client.readContract({ address: config.token, abi: erc20Abi, functionName: 'balanceOf', args: [safe] });
  const feeAllowance = 500_000n, forceFailure = process.argv.includes('--force-failure'), amount = forceFailure ? 1_000_000_000_000n : 100_000n;
  if (balance < 600_000n || (forceFailure && balance >= amount)) throw new Error('The test balance does not match this scenario.');
  const permitAbi = parseAbi(['function name() view returns(string)', 'function version() view returns(string)', 'function nonces(address owner) view returns(uint256)']);
  const [name, tokenVersion, permitNonce] = await Promise.all(['name', 'version', 'nonces'].map(functionName => client.readContract({ address: config.token, abi: permitAbi, functionName, ...(functionName === 'nonces' ? { args: [safe] } : {}) })));
  const permit = { domain: { name, version: tokenVersion, chainId: baseSepolia.id, verifyingContract: config.token }, types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, primaryType: 'Permit', message: { owner: safe, spender: config.paymaster, value: feeAllowance, nonce: permitNonce, deadline: maxUint256 } };
  const permitSignature = await owner.signTypedData({ domain: { chainId: baseSepolia.id, verifyingContract: safe }, types: safeMessageTypes, primaryType: 'SafeMessage', message: { message: hashTypedData(permit) } });
  const fees = await client.estimateFeesPerGas(), validAfter = 0, validUntil = Math.floor(Date.now() / 1000) + 600;
  const nonce = await client.readContract({ address: config.entryPoint, abi: parseAbi(['function getNonce(address sender,uint192 key) view returns(uint256)']), functionName: 'getNonce', args: [safe, 0n] });
  const times = encodePacked(['uint48', 'uint48'], [validAfter, validUntil]);
  const operation = { sender: safe, nonce, callData: circleAccountCall(config.token, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner.address, amount] })), callGasLimit: 200_000n, verificationGasLimit: 900_000n, preVerificationGas: 100_000n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas * 2n, paymaster: config.paymaster, paymasterData: circlePermitData(baseSepolia.id, feeAllowance, permitSignature), paymasterVerificationGasLimit: 300_000n, paymasterPostOpGasLimit: 80_000n, signature: concatHex([times, `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`]) };
  // Deliberately bypass simulation only for this explicit testnet failure case.
  // Product submission must never make this exception.
  const estimate = forceFailure ? {} : await circleRpc(baseSepolia.id, 'eth_estimateUserOperationGas', [operation, config.entryPoint]);
  for (const key of ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit']) if (estimate[key]) operation[key] = (BigInt(estimate[key]) * 120n + 99n) / 100n;
  const estimatedFee = circlePrefund(operation, price, additionalGas, BigInt(spread));
  if (estimatedFee > feeAllowance) throw new Error('The estimate exceeds the test fee authorization of 0.5 USDC.');
  const signingData = circleOperationSigningData(baseSepolia.id, operation, validAfter, validUntil);
  const moduleHash = await client.readContract({ address: config.module, abi: parseAbi(['function getOperationHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns(bytes32)']), functionName: 'getOperationHash', args: [{ sender: safe, nonce, initCode: '0x', callData: operation.callData, accountGasLimits: concatHex([toHex(operation.verificationGasLimit, { size: 16 }), toHex(operation.callGasLimit, { size: 16 })]), preVerificationGas: operation.preVerificationGas, gasFees: concatHex([toHex(operation.maxPriorityFeePerGas, { size: 16 }), toHex(operation.maxFeePerGas, { size: 16 })]), paymasterAndData: circlePaymasterAndData(operation), signature: times }] });
  if (moduleHash !== hashTypedData(signingData)) throw new Error('The authorization does not match the deployed Safe4337 module.');
  if (!process.argv.includes('--execute')) console.log(json({ status: 'simulation_only', safe, owner: owner.address, amount, estimatedFee, feeAllowance, nonce }));
  else {
    operation.signature = circleSignature(validAfter, validUntil, await owner.signTypedData(signingData));
    const state = { chainId: baseSepolia.id, safe, owner: owner.address, amount, estimatedFee, feeAllowance, operation, userOpHash: circleOperationHash(baseSepolia.id, operation), startBlock: (await client.getBlockNumber()).toString() };
    // Exclusive create prevents two local processes from submitting this run.
    await writeFile(path, json(state), { flag: 'wx' });
    const response = await circleRpc(baseSepolia.id, 'eth_sendUserOperation', [operation, config.entryPoint]);
    if (response !== state.userOpHash) throw new Error('Submission response was not confirmed. Check this original run with --status.');
    console.log(json({ status: 'submitted', hash: state.userOpHash, nonce, estimatedFee, feeAllowance }));
  }
}
