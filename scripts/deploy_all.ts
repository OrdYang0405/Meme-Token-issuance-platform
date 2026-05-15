// scripts/deploy_all.ts
// 第14课：完整部署流水线 —— 多网络发布
//
// 运行：
//   npx hardhat run scripts/deploy_all.ts --network hardhat
//   npx hardhat run scripts/deploy_all.ts --network sepolia
//   npx hardhat run scripts/deploy_all.ts --network mainnet
//
// 流程：
//   [1] 网络检测 → [2] 部署前检查 → [3] Factory → [4] Token
//   → [5] Uniswap 初始化 → [6] 保存部署状态 → [7] 输出摘要

import { ethers, run } from "hardhat";
import {
  NetworkInfo,
  detectNetwork,
  checkBalance,
  getMinBalance,
  getGasGwei,
  getWETH,
  getOrCreatePair,
  ROUTER_ABI,
} from "./helpers/network";
import {
  DeploymentRecord,
  loadDeployment,
  getContractAddress,
  saveDeployment,
  printSummary,
} from "./helpers/state";

// ════════════════════════════════════════════════════════════════
// 部署参数（修改这里以自定义代币）
// ════════════════════════════════════════════════════════════════

const DEPLOY_PARAMS = {
  tokenName: "Meme Token",
  tokenSymbol: "MEME",
  totalSupply: 1_000_000,
  buyTax: 300,   // 3%
  sellTax: 500,  // 5%
  feeReceiver: "", // 由脚本自动设置为 deployer 地址
  creationFee: "0.01", // ETH
};

// ════════════════════════════════════════════════════════════════
// 类型：完整部署结果
// ════════════════════════════════════════════════════════════════

interface DeployResult {
  network: NetworkInfo;
  factory?: string;
  token?: string;
  pair?: string;
  txHashes: string[];
}

// ════════════════════════════════════════════════════════════════
// 入口
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   MemeToken 完整部署流水线              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  DEPLOY_PARAMS.feeReceiver = deployer.address;

  const result: DeployResult = { network: await detectNetwork(), txHashes: [] };
  printHeader(result.network, deployer.address);

  // ── 步骤 1：部署前检查 ──
  await preflightCheck(deployer.address, result.network);

  // ── 步骤 2：部署或连接 Factory ──
  const factory = await deployOrConnectFactory(deployer, result);

  // ── 步骤 3：部署或连接 Token ──
  const token = await deployOrConnectToken(deployer, factory, result);

  // ── 步骤 4：Uniswap 初始化 ──
  await setupUniswap(deployer, token, result);

  // ── 步骤 5：输出最终摘要 ──
  printFinalSummary(result);

  // ── 步骤 6：保存部署状态 ──
  const file = loadDeployment(result.network.name);
  if (file) printSummary(file);

  console.log("\n✅ 部署流水线执行完毕");
}

// ════════════════════════════════════════════════════════════════
// 步骤 1：部署前检查
// ════════════════════════════════════════════════════════════════

async function preflightCheck(deployer: string, network: NetworkInfo): Promise<void> {
  console.log("═══ 步骤 1：部署前检查 ═══\n");

  const balance = await checkBalance(deployer, network);
  const minBalance = getMinBalance(network);
  const gasGwei = await getGasGwei();

  console.log(`  Deployer:       ${deployer}`);
  console.log(`  ETH 余额:       ${ethers.formatEther(balance)} ETH`);
  console.log(`  最低需求:        ${ethers.formatEther(minBalance)} ETH`);
  console.log(`  当前 Gas Price:  ${gasGwei} gwei`);
  console.log(`  当前区块高度:    ${await ethers.provider.getBlockNumber()}`);
  console.log(`  代币名称:        ${DEPLOY_PARAMS.tokenName} (${DEPLOY_PARAMS.tokenSymbol})`);
  console.log(`  买入/卖出税:     ${DEPLOY_PARAMS.buyTax / 100}% / ${DEPLOY_PARAMS.sellTax / 100}%`);
  console.log(`  创建费用:        ${DEPLOY_PARAMS.creationFee} ETH\n`);

  if (balance < minBalance) {
    throw new Error(
      `ETH 余额不足！当前: ${ethers.formatEther(balance)}, 最少需要: ${ethers.formatEther(minBalance)}`
    );
  }

  if (!network.isTestnet && parseFloat(gasGwei) > 100) {
    console.warn("  ⚠️  Gas Price > 100 gwei，建议等待降低后再部署\n");
  }

  console.log("  ✅ 部署前检查通过\n");
}

// ════════════════════════════════════════════════════════════════
// 步骤 2：部署或连接 Factory
// ════════════════════════════════════════════════════════════════

async function deployOrConnectFactory(
  deployer: ethers.Signer,
  result: DeployResult,
): Promise<ethers.Contract> {
  console.log("═══ 步骤 2：部署 MemeFactory ═══\n");

  // 检查是否已部署
  const existing = getContractAddress(result.network.name, "MemeFactory");
  if (existing) {
    console.log(`  MemeFactory 已部署: ${existing}`);
    console.log("  跳过部署\n");
    return ethers.getContractAt("MemeFactory", existing);
  }

  const Factory = await ethers.getContractFactory("MemeFactory");
  const creationFee = ethers.parseEther(DEPLOY_PARAMS.creationFee);
  const factory = await Factory.deploy(creationFee);
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  const deployTx = factory.deploymentTransaction();
  const txHash = deployTx?.hash || "unknown";

  console.log(`  MemeFactory:  ${addr}`);
  console.log(`  CreationFee:  ${ethers.formatEther(creationFee)} ETH`);
  console.log(`  TxHash:       ${txHash}\n`);

  result.factory = addr;
  result.txHashes.push(txHash);

  // 保存到状态文件
  const record: DeploymentRecord = {
    contract: "MemeFactory",
    address: addr,
    txHash,
    deployer: await deployer.getAddress(),
    timestamp: new Date().toISOString(),
    constructorArgs: [creationFee.toString()],
  };
  saveDeployment(result.network.name, result.network.chainId, record);

  return factory;
}

// ════════════════════════════════════════════════════════════════
// 步骤 3：部署或连接 Token（通过 Factory）
// ════════════════════════════════════════════════════════════════

async function deployOrConnectToken(
  deployer: ethers.Signer,
  factory: ethers.Contract,
  result: DeployResult,
): Promise<ethers.Contract> {
  console.log("═══ 步骤 3：创建 MemeToken ═══\n");

  const existing = getContractAddress(result.network.name, "MemeToken");
  if (existing) {
    console.log(`  MemeToken 已部署: ${existing}`);
    console.log("  跳过创建\n");
    return ethers.getContractAt("MemeToken", existing);
  }

  const p = DEPLOY_PARAMS;
  const creationFee = ethers.parseEther(p.creationFee);

  console.log(`  通过 Factory 创建代币...`);
  console.log(`  Name:   ${p.tokenName}`);
  console.log(`  Symbol: ${p.tokenSymbol}`);
  console.log(`  Supply: ${p.totalSupply.toLocaleString()}`);
  console.log(`  Tax:    ${p.buyTax / 100}% buy / ${p.sellTax / 100}% sell\n`);

  const tx = await factory.createToken(
    p.tokenName,
    p.tokenSymbol,
    p.totalSupply,
    p.feeReceiver,
    p.feeReceiver,
    p.buyTax,
    p.sellTax,
    { value: creationFee },
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Token creation transaction failed");
  }

  // 从 Factory 的 allTokens 数组获取新创建的代币地址
  const allTokensLength = await factory.allTokensLength();
  const tokenAddr = await factory.allTokens(allTokensLength - 1n);
  const token = await ethers.getContractAt("MemeToken", tokenAddr);

  console.log(`  Token:   ${tokenAddr}`);
  console.log(`  Owner:   ${await token.owner()}`);
  console.log(`  Supply:  ${ethers.formatEther(await token.totalSupply())}`);
  console.log(`  TxHash:  ${receipt.hash}\n`);

  result.token = tokenAddr;
  result.txHashes.push(receipt.hash);

  const record: DeploymentRecord = {
    contract: "MemeToken",
    address: tokenAddr,
    txHash: receipt.hash,
    deployer: await deployer.getAddress(),
    timestamp: new Date().toISOString(),
    constructorArgs: [
      p.tokenName, p.tokenSymbol, p.totalSupply,
      p.feeReceiver, p.feeReceiver, p.buyTax, p.sellTax,
    ],
  };
  saveDeployment(result.network.name, result.network.chainId, record);

  return token;
}

// ════════════════════════════════════════════════════════════════
// 步骤 4：Uniswap 初始化
// ════════════════════════════════════════════════════════════════

async function setupUniswap(
  deployer: ethers.Signer,
  token: ethers.Contract,
  result: DeployResult,
): Promise<void> {
  console.log("═══ 步骤 4：Uniswap 初始化 ═══\n");

  const network = result.network;
  const deployerAddr = await deployer.getAddress();
  const tokenAddr = await token.getAddress();

  // 4a. 设置 Router
  const existingRouter = await token.uniswapV2Router();
  if (existingRouter !== ethers.ZeroAddress) {
    console.log(`  Router 已设置: ${existingRouter}`);
  } else {
    console.log(`  设置 Router: ${network.uniswapV2Router}`);
    const tx = await token.setUniswapRouter(network.uniswapV2Router);
    const receipt = await tx.wait();
    console.log(`  Router 已设置 ✓ (${receipt.hash})`);
    result.txHashes.push(receipt.hash);
  }

  // 4b. 创建或获取 Pair
  const pairAddr = await getOrCreatePair(tokenAddr, network, deployer);
  const existingPair = await token.uniswapV2Pair();
  if (existingPair !== ethers.ZeroAddress) {
    console.log(`  Pair 已设置: ${existingPair}`);
  } else {
    console.log(`  Pair 地址: ${pairAddr}`);
    const tx = await token.setUniswapPair(pairAddr);
    const receipt = await tx.wait();
    console.log(`  Pair 已设置 ✓ (${receipt.hash})`);
    result.txHashes.push(receipt.hash);
  }
  result.pair = pairAddr;

  // 4c. 启用交易
  const tradingEnabled = await token.tradingEnabled();
  if (tradingEnabled) {
    console.log("  交易已启用");
  } else {
    const tx = await token.enableTrading();
    const receipt = await tx.wait();
    console.log(`  交易已启用 ✓ (${receipt.hash})`);
    result.txHashes.push(receipt.hash);
  }

  // 4d. 锁定 Router（安全修复）
  const routerLocked = await token.routerLocked();
  if (routerLocked) {
    console.log("  Router 已锁定");
  } else {
    try {
      const tx = await token.lockRouter();
      const receipt = await tx.wait();
      console.log(`  Router 已锁定 ✓ (${receipt.hash})`);
      result.txHashes.push(receipt.hash);
    } catch (e: any) {
      console.warn(`  Router 锁定跳过: ${e.reason || e.message}`);
    }
  }

  // 4e. 验证最终状态
  console.log("\n  验证状态:");
  console.log(`    Router:       ${await token.uniswapV2Router()}`);
  console.log(`    Pair:         ${await token.uniswapV2Pair()}`);
  console.log(`    Trading:      ${await token.tradingEnabled()}`);
  console.log(`    RouterLocked: ${await token.routerLocked()}`);
  console.log(`    WETH:         ${await getWETH(network, deployer)}\n`);
}

// ════════════════════════════════════════════════════════════════
// 输出
// ════════════════════════════════════════════════════════════════

function printHeader(network: NetworkInfo, deployer: string): void {
  console.log(`  网络:     ${network.name} (chainId: ${network.chainId})`);
  console.log(`  测试网:   ${network.isTestnet}`);
  console.log(`  UniswapV2 Router: ${network.uniswapV2Router}`);
  console.log(`  Deployer: ${deployer}\n`);
}

function printFinalSummary(result: DeployResult): void {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║           部署完成                       ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log(`  网络:         ${result.network.name} (chainId: ${result.network.chainId})`);
  console.log(`  Factory:      ${result.factory || "N/A"}`);
  console.log(`  Token:        ${result.token || "N/A"}`);
  console.log(`  Pair:         ${result.pair || "N/A"}`);
  console.log(`  交易总数:     ${result.txHashes.length}`);
  console.log("");
}

// ════════════════════════════════════════════════════════════════
// 参数验证工具（可被外部调用）
// ════════════════════════════════════════════════════════════════

function validateDeployParams(params: typeof DEPLOY_PARAMS): void {
  const errors: string[] = [];

  if (params.tokenName.length === 0 || params.tokenName.length > 32) {
    errors.push("代币名长度必须在 1-32 之间");
  }
  if (params.tokenSymbol.length === 0 || params.tokenSymbol.length > 10) {
    errors.push("代币符号长度必须在 1-10 之间");
  }
  if (params.buyTax > 2500 || params.sellTax > 2500) {
    errors.push("税率不能超过 25% (2500 bps)");
  }
  if (params.totalSupply < 1_000 || params.totalSupply > 1_000_000_000) {
    errors.push("总供应量必须在 1,000 - 1,000,000,000 之间");
  }
  if (params.feeReceiver && !ethers.isAddress(params.feeReceiver)) {
    errors.push("feeReceiver 不是有效地址");
  }
  const feeNum = parseFloat(params.creationFee);
  if (isNaN(feeNum) || feeNum < 0.001 || feeNum > 1) {
    errors.push("创建费用应在 0.001-1 ETH 之间");
  }

  if (errors.length > 0) {
    throw new Error(`部署参数验证失败:\n  - ${errors.join("\n  - ")}`);
  }
}

// ════════════════════════════════════════════════════════════════
// 合约验证工具
// ════════════════════════════════════════════════════════════════

async function verifyContract(
  address: string,
  constructorArgs: any[],
  networkName: string,
): Promise<void> {
  if (networkName === "hardhat") {
    console.log(`  Hardhat 网络跳过验证: ${address}`);
    return;
  }

  console.log(`  验证合约: ${address} (${networkName})`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments: constructorArgs,
    });
    console.log(`  验证成功 ✓`);
  } catch (error: any) {
    if (error.message?.includes("Already Verified")) {
      console.log("  合约已验证，跳过");
    } else {
      console.warn(`  验证失败: ${error.message}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 导出
// ════════════════════════════════════════════════════════════════

export {
  DEPLOY_PARAMS,
  validateDeployParams,
  verifyContract,
  main,
};

// 直接运行
main().catch((error) => {
  console.error("\n❌ 部署失败:", error.reason || error.message);
  process.exitCode = 1;
});
