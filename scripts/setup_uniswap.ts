// scripts/setup_uniswap.ts
// 代币部署后的 Uniswap 初始化脚本
// 运行: npx hardhat run scripts/setup_uniswap.ts --network hardhat

import { ethers } from "hardhat";

// 不同网络的 Uniswap V2 合约地址
const UNISWAP: Record<string, { factory: string; router: string }> = {
  sepolia: {
    factory: "0x7E0987E5b3a30e3f2828572Bb659A548460a3003",
    router: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",
  },
  mainnet: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
};

// 最小化 ABI
const ROUTER_ABI = [
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)",
];

const FACTORY_ABI = [
  "function createPair(address tokenA, address tokenB) external returns (address pair)",
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  // ── 步骤 1：确定网络 ──
  const chainId = (await ethers.provider.getNetwork()).chainId;

  let uni: { factory: string; router: string };
  if (chainId === 11155111n) {
    uni = UNISWAP.sepolia;
    console.log("网络: Sepolia Testnet");
  } else if (chainId === 31337n) {
    uni = UNISWAP.mainnet;
    console.log("网络: Hardhat (使用主网 Uniswap 地址)");
  } else {
    throw new Error(`不支持的链 ID: ${chainId}`);
  }

  // ── 步骤 2：部署或连接代币 ──
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  let token: any;

  if (TOKEN_ADDRESS) {
    console.log(`\n连接已有代币: ${TOKEN_ADDRESS}`);
    token = await ethers.getContractAt("MemeToken", TOKEN_ADDRESS);
  } else {
    console.log("\n部署新代币...");
    const Factory = await ethers.getContractFactory("MemeToken");
    token = await Factory.deploy(
      "Test Meme", "TMEME", 1_000_000,
      deployer.address, deployer.address,
      300, 500
    );
    await token.waitForDeployment();
    console.log(`  代币已部署: ${await token.getAddress()}`);
  }

  const tokenAddr = await token.getAddress();

  // ── 步骤 3：设置 Uniswap Router ──
  console.log(`\n设置 Uniswap Router: ${uni.router}`);
  const routerContract = new ethers.Contract(uni.router, ROUTER_ABI, deployer);
  const weth = await routerContract.WETH();
  console.log(`  WETH 地址: ${weth}`);

  let tx = await token.setUniswapRouter(uni.router);
  await tx.wait();
  console.log("  Router 已设置 ✓");

  // ── 步骤 4：创建 Uniswap Pair ──
  console.log("\n创建 Uniswap Pair (代币 ↔ WETH)...");
  const factoryContract = new ethers.Contract(uni.factory, FACTORY_ABI, deployer);

  const existingPair = await factoryContract.getPair(tokenAddr, weth);
  if (existingPair !== ethers.ZeroAddress) {
    console.log(`  Pair 已存在: ${existingPair}`);
  } else {
    tx = await factoryContract.createPair(tokenAddr, weth);
    await tx.wait();
    console.log(`  Pair 已创建`);
  }

  const pairAddr = await factoryContract.getPair(tokenAddr, weth);
  console.log(`  Pair 地址: ${pairAddr}`);

  // ── 步骤 5：设置 Pair（自动从交易限制中排除）──
  console.log("\n设置 Pair 地址...");
  tx = await token.setUniswapPair(pairAddr);
  await tx.wait();
  console.log(`  Pair 已设置 ✓`);
  console.log(`  Pair 已排除交易限制: ${await token.isExcludedFromLimits(pairAddr)}`);

  // ── 步骤 6：启用交易 ──
  console.log("\n启用交易...");
  tx = await token.enableTrading();
  await tx.wait();
  console.log(`  交易已启用: ${await token.tradingEnabled()} ✓`);

  // ── 步骤 7：最终状态 ──
  console.log("\n═══════════════════════════════════");
  console.log("  初始化完成");
  console.log("═══════════════════════════════════");
  console.log(`  代币:           ${tokenAddr}`);
  console.log(`  Router:         ${await token.uniswapV2Router()}`);
  console.log(`  Pair:           ${await token.uniswapV2Pair()}`);
  console.log(`  交易已启用:     ${await token.tradingEnabled()}`);
  console.log(`  SwapAndLiquify: ${await token.swapAndLiquifyEnabled()}`);
  console.log(`  买入税:         ${Number(await token.buyTax()) / 100}%`);
  console.log(`  卖出税:         ${Number(await token.sellTax()) / 100}%`);
  console.log("═══════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
