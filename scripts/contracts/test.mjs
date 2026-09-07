import { privateKeyToAccount } from "viem/accounts";
import assert from "node:assert/strict";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  defineChain,
} from "viem";
import { compile } from "./compile.mjs";
import { invoiceAddress, forwarderFactory } from "../../shared/receivableAddress.ts";
const output = compile({
  "TestToken.sol": {
    content: `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract TestToken { mapping(address=>uint256) public balanceOf; bool public fail; function setFail(bool value) external {fail=value;} function mint(address to,uint256 value) external {balanceOf[to]+=value;} function transfer(address to,uint256 value) external returns(bool) {if(fail)return false; require(balanceOf[msg.sender]>=value); balanceOf[msg.sender]-=value; balanceOf[to]+=value; return true;} }
contract NoReturnToken { mapping(address=>uint256) public balanceOf; function mint(address to,uint256 value) external {balanceOf[to]+=value;} function transfer(address to,uint256 value) external {require(balanceOf[msg.sender]>=value); balanceOf[msg.sender]-=value; balanceOf[to]+=value;} }
`,
  },
});
assert.equal(`0x${output['InvoiceForwarder.sol'].InvoiceForwarderFactory.evm.bytecode.object}`, forwarderFactory.bytecode, 'Generated factory artifact must match source');
assert.equal(`0x${output['InvoiceForwarder.sol'].InvoiceForwarderFactory.evm.deployedBytecode.object}`, forwarderFactory.deployedBytecode, 'Pinned runtime must match source');
const provider = ganache.provider({
  logging: { quiet: true },
  wallet: { deterministic: true },
  chain: { hardfork: "shanghai" },
});
const localChain = defineChain({
  id: 1337,
  name: "Contract QA",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});
const publicClient = createPublicClient({
  chain: localChain,
  transport: custom(provider),
});
const wallet = createWalletClient({
  chain: localChain,
  transport: custom(provider),
});
const [payer, treasury, stranger] = await wallet.getAddresses();
const accounts = provider.getInitialAccounts();
const signer = (address) =>
  privateKeyToAccount(accounts[address.toLowerCase()].secretKey);
const send = async (args) => {
  const hash = await wallet.writeContract({
    ...args,
    account: signer(args.account ?? payer),
  });
  return publicClient.waitForTransactionReceipt({ hash });
};
const deploy = async (contract) => {
  const hash = await wallet.deployContract({
    account: signer(payer),
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  });
  return (await publicClient.waitForTransactionReceipt({ hash }))
    .contractAddress;
};
try {
  const factoryContract =
    output["InvoiceForwarder.sol"].InvoiceForwarderFactory;
  const factory = await deploy(factoryContract),
    factoryAbi = factoryContract.abi;
  const tokenContract = output["TestToken.sol"].TestToken,
    token = await deploy(tokenContract);
  const salt = `0x${"1".repeat(64)}`,
    otherSalt = `0x${"2".repeat(64)}`;
  const predicted = invoiceAddress(factory, treasury, salt);
  assert.equal(
    (
      await publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "predict",
        args: [treasury, salt],
      })
    ).toLowerCase(),
    predicted.toLowerCase(),
  );
  assert.notEqual(invoiceAddress(factory, treasury, otherSalt), predicted);
  assert.notEqual(invoiceAddress(factory, stranger, salt), predicted);
  await send({
    address: token,
    abi: tokenContract.abi,
    functionName: "mint",
    args: [predicted, 10001n],
  });
  assert.equal(await publicClient.getCode({ address: predicted }), undefined);
  await send({
    account: stranger,
    address: factory,
    abi: factoryAbi,
    functionName: "deployAndSweep",
    args: [treasury, salt, token],
  });
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [treasury],
    }),
    10001n,
  );
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [stranger],
    }),
    0n,
  );
  await send({
    address: factory,
    abi: factoryAbi,
    functionName: "deployAndSweep",
    args: [treasury, salt, token],
  });
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [treasury],
    }),
    10001n,
  );
  await send({
    address: token,
    abi: tokenContract.abi,
    functionName: "mint",
    args: [predicted, 77n],
  });
  await send({
    address: token,
    abi: tokenContract.abi,
    functionName: "setFail",
    args: [true],
  });
  await assert.rejects(() =>
    send({
      address: factory,
      abi: factoryAbi,
      functionName: "deployAndSweep",
      args: [treasury, salt, token],
    }),
  );
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [predicted],
    }),
    77n,
  );
  await send({
    address: token,
    abi: tokenContract.abi,
    functionName: "setFail",
    args: [false],
  });
  await send({
    address: factory,
    abi: factoryAbi,
    functionName: "deployAndSweep",
    args: [treasury, salt, token],
  });
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [treasury],
    }),
    10078n,
  );
  const noReturn = output["TestToken.sol"].NoReturnToken,
    legacy = await deploy(noReturn);
  await send({
    address: legacy,
    abi: noReturn.abi,
    functionName: "mint",
    args: [predicted, 5n],
  });
  await send({
    account: stranger,
    address: factory,
    abi: factoryAbi,
    functionName: "deployAndSweep",
    args: [treasury, salt, legacy],
  });
  assert.equal(
    await publicClient.readContract({
      address: legacy,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [treasury],
    }),
    5n,
  );
  const before = await publicClient.getBalance({ address: treasury });
  const hash = await wallet.sendTransaction({
    account: signer(payer),
    to: predicted,
    value: 123n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await send({
    account: stranger,
    address: predicted,
    abi: output["InvoiceForwarder.sol"].InvoiceForwarder.abi,
    functionName: "sweepNative",
  });
  assert.equal(
    await publicClient.getBalance({ address: treasury }),
    before + 123n,
  );
  console.log(
    "PASS deterministic address, destination binding, pre-deployment receipt, permissionless forwarding, repeat sweep, late deposit, failed-token safety, no-return token, native recovery",
  );
} finally {
  await provider.disconnect();
}
