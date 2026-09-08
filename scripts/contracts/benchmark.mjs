// Local EVM benchmark only. Neither the clone prototype nor batch harness is a deployment artifact.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  toHex,
} from "viem";
import { compile } from "./compile.mjs";
const prototype = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
contract CloneForwarder is ReentrancyGuard {
 using SafeERC20 for IERC20;
 event Forwarded(address indexed token,address indexed treasury,uint256 amount);
 function treasury() public view returns(address payable){return payable(abi.decode(Clones.fetchCloneArgs(address(this)),(address)));}
 function sweep(address token) external nonReentrant returns(uint256 amount){amount=IERC20(token).balanceOf(address(this));if(amount==0)return 0; address dest=treasury();require(dest!=address(0));IERC20(token).safeTransfer(dest,amount);emit Forwarded(token,dest,amount);}
 function sweepNative() external nonReentrant {uint256 amount=address(this).balance;if(amount==0)return;address payable dest=treasury();require(dest!=address(0));(bool ok,)=dest.call{value:amount}('');require(ok);emit Forwarded(address(0),dest,amount);}
 receive() external payable{}
}
contract CloneFactory {
 address public immutable implementation;
 event Created(address indexed forwarder,address indexed treasury,bytes32 indexed salt);
 constructor(){implementation=address(new CloneForwarder());}
 function predict(address treasury,bytes32 salt) public view returns(address){return Clones.predictDeterministicAddressWithImmutableArgs(implementation,abi.encode(treasury),salt);}
 function deployAndSweep(address treasury,bytes32 salt,address token) external {require(treasury!=address(0));address at=predict(treasury,salt);if(at.code.length==0){at=Clones.cloneDeterministicWithImmutableArgs(implementation,abi.encode(treasury),salt);emit Created(at,treasury,salt);}CloneForwarder(payable(at)).sweep(token);}
}
interface IFactory{function deployAndSweep(address treasury,bytes32 salt,address token) external;}
contract GroupedCollections{function collect(address factory,address treasury,bytes32[] calldata salts,address token) external{for(uint256 i;i<salts.length;++i)IFactory(factory).deployAndSweep(treasury,salts[i],token);}}
contract Token{mapping(address=>uint256)public balanceOf;bool public fail;function setFail(bool value)external{fail=value;}function mint(address to,uint256 v)external{balanceOf[to]+=v;}function transfer(address to,uint256 v)external returns(bool){require(!fail);balanceOf[msg.sender]-=v;balanceOf[to]+=v;return true;}}
`;
const output = compile({ "Benchmark.sol": { content: prototype } }),
  provider = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true },
    chain: { hardfork: "shanghai" },
  });
const chain = defineChain({
  id: 1337,
  name: "Local benchmark",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});
const client = createPublicClient({
    chain,
    transport: custom(provider),
    pollingInterval: 10,
  }),
  wallet = createWalletClient({ chain, transport: custom(provider) });
const [payer, treasury, stranger] = await wallet.getAddresses(),
  account = payer;
const sent = async (hash) => {
  const receipt = await client.getTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
};
const deploy = async (c) =>
  sent(
    await wallet.deployContract({
      account,
      gas: 25_000_000n,
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
    }),
  );
const send = async (args) =>
  sent(await wallet.writeContract({ account, gas: 25_000_000n, ...args }));
try {
  const tokenC = output["Benchmark.sol"].Token,
    token = (await deploy(tokenC)).contractAddress;
  await send({
    address: token,
    abi: tokenC.abi,
    functionName: "mint",
    args: [treasury, 1n],
  });
  const batchC = output["Benchmark.sol"].GroupedCollections,
    batch = await deploy(batchC);
  const results = {
    compiler: "solc 0.8.30 / optimizer 200 / Shanghai",
    scope:
      "Local execution gas. Excludes Safe/ERC-4337/paymaster overhead, L1 data charges and live provider prices.",
    batchHarnessDeploymentGas: String(batch.gasUsed),
    variants: [],
  };
  let saltId = 1;
  for (const [name, c] of [
    ["immutable", output["InvoiceForwarder.sol"].InvoiceForwarderFactory],
    ["clone prototype", output["Benchmark.sol"].CloneFactory],
  ]) {
    const deployed = await deploy(c),
      factory = deployed.contractAddress,
      entry = {
        name,
        factoryDeploymentGas: String(deployed.gasUsed),
        sizes: [],
      };
    for (const count of [1, 5, 20]) {
      const groups = [];
      for (const mode of ["separate", "grouped"]) {
        const salts = Array.from({ length: count }, () =>
            toHex(saltId++, { size: 32 }),
          ),
          addresses = [];
        for (const salt of salts) {
          const address = await client.readContract({
            address: factory,
            abi: c.abi,
            functionName: "predict",
            args: [treasury, salt],
          });
          assert.notEqual(
            address,
            await client.readContract({
              address: factory,
              abi: c.abi,
              functionName: "predict",
              args: [stranger, salt],
            }),
          );
          assert.equal(await client.getCode({ address }), undefined);
          addresses.push(address);
        }
        const row = { mode };
        for (const cycle of ["first", "repeat"]) {
          for (const address of addresses)
            await send({
              address: token,
              abi: tokenC.abi,
              functionName: "mint",
              args: [address, 1000000n],
            });
          const before = await client.readContract({
            address: token,
            abi: tokenC.abi,
            functionName: "balanceOf",
            args: [treasury],
          });
          let gas = 0n;
          if (mode === "separate")
            for (const salt of salts)
              gas += (
                await send({
                  address: factory,
                  abi: c.abi,
                  functionName: "deployAndSweep",
                  args: [treasury, salt, token],
                })
              ).gasUsed;
          else
            gas = (
              await send({
                address: batch.contractAddress,
                abi: batchC.abi,
                functionName: "collect",
                args: [factory, treasury, salts, token],
              })
            ).gasUsed;
          const after = await client.readContract({
            address: token,
            abi: tokenC.abi,
            functionName: "balanceOf",
            args: [treasury],
          });
          assert.equal(after - before, BigInt(count) * 1000000n);
          for (const address of addresses)
            assert.equal(
              await client.readContract({
                address: token,
                abi: tokenC.abi,
                functionName: "balanceOf",
                args: [address],
              }),
              0n,
            );
          assert.equal(
            await client.readContract({
              address: token,
              abi: tokenC.abi,
              functionName: "balanceOf",
              args: [stranger],
            }),
            0n,
          );
          row[cycle] = String(gas);
        }
        groups.push(row);
      }
      entry.sizes.push({
        count,
        ...Object.fromEntries(
          groups.map((g) => [g.mode, { first: g.first, repeat: g.repeat }]),
        ),
      });
    }
    results.variants.push(entry);
  }
  if (process.argv.includes("--write"))
    writeFileSync(
      "docs/receiving-gas-benchmark.json",
      JSON.stringify(results, null, 2) + "\n",
    );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await provider.disconnect();
}
