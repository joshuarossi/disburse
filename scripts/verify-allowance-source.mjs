/** Node is required by solc's remote compiler loader. Input contains public source only. */
import { readFileSync } from 'node:fs';
import solc from 'solc';
const { sources, runtime } = JSON.parse(readFileSync(0, 'utf8'));
const compiler = await new Promise((resolve, reject) => solc.loadRemoteVersion('v0.7.6+commit.7338295f', (error, value) => error ? reject(error) : resolve(value)));
const output = JSON.parse(compiler.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: false }, outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } } })));
if (output.errors?.some(e => e.severity === 'error')) throw new Error('Published source did not compile');
const compiled = '0x' + output.contracts['contracts/AllowanceModule.sol'].AllowanceModule.evm.deployedBytecode.object;
const executable = code => {
  const trailerBytes = parseInt(code.slice(-4), 16) + 2;
  if (trailerBytes < 2 || trailerBytes > 1024) throw new Error('Unrecognized Solidity metadata trailer');
  return code.slice(0, -trailerBytes * 2);
};
if (executable(compiled) !== executable(runtime)) throw new Error('Deployed executable differs from the published source');
console.log(JSON.stringify({ compiler: compiler.version(), optimizer: false, executableMatches: true, fullRuntimeMatches: compiled === runtime, note: 'Only the trailing Solidity metadata may differ. Runtime checks in the app compare the full deployed code hash.' }));
