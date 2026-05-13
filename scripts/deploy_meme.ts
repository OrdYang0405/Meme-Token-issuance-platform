import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  // ============ 部署参数 ============
  const name = "Meme Token";
  const symbol = "MEME";
  const totalSupply = 1_000_000;
  const buyTax = 300;  // 3%
  const sellTax = 500; // 5%

  const marketingWallet = deployer.address;
  const teamWallet = deployer.address;

  console.log("========================================");
  console.log("  MemeToken 部署脚本");
  console.log("========================================");
  console.log(`  Name:             ${name}`);
  console.log(`  Symbol:           ${symbol}`);
  console.log(`  Total Supply:     ${totalSupply.toLocaleString()}`);
  console.log(`  Buy Tax:          ${buyTax / 100}%`);
  console.log(`  Sell Tax:         ${sellTax / 100}%`);
  console.log(`  Tax Shares:       LP:20% | Marketing:40% | Team:20% | Burn:20%`);
  console.log("========================================\n");

  // 部署
  const Factory = await ethers.getContractFactory("MemeToken");
  const token = await Factory.deploy(
    name,
    symbol,
    totalSupply,
    marketingWallet,
    teamWallet,
    buyTax,
    sellTax
  );
  await token.waitForDeployment();
  const contractAddress = await token.getAddress();

  console.log("Deployment successful!");
  console.log(`  Contract: ${contractAddress}\n`);

  // 验证部署状态
  console.log("Contract State:");
  console.log(`  name(): ${await token.name()}`);
  console.log(`  symbol(): ${await token.symbol()}`);
  console.log(`  totalSupply(): ${ethers.formatEther(await token.totalSupply())}`);
  console.log(`  buyTax(): ${await token.buyTax()} (${Number(await token.buyTax()) / 100}%)`);
  console.log(`  sellTax(): ${await token.sellTax()} (${Number(await token.sellTax()) / 100}%)`);
  console.log(`  burnShare(): ${await token.burnShare()} (${Number(await token.burnShare()) / 100}%)`);
  console.log(`  tradingEnabled: ${await token.tradingEnabled()}`);
  console.log(`  swapAndLiquifyEnabled: ${await token.swapAndLiquifyEnabled()}`);
  console.log(`  swapThreshold: ${ethers.formatEther(await token.swapThreshold())}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(await token.balanceOf(deployer.address))}\n`);

  // 配置 Uniswap Router（Sepolia 或 Mainnet 地址）
  // Sepolia: 0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008
  // Mainnet: 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
  console.log("Next steps:");
  console.log("  1. await token.setUniswapRouter(routerAddress)");
  console.log("  2. 在 Uniswap 创建交易对 (token ↔ WETH)");
  console.log("  3. await token.setUniswapPair(pairAddress)");
  console.log("  4. await token.enableTrading()");
  console.log("  5. 公开交易!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
