import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  // ============ 部署参数 ============
  const name = "Meme Token";
  const symbol = "MEME";
  const totalSupply = 1_000_000;
  const buyTax = 300;  // 3% 买入税
  const sellTax = 500; // 5% 卖出税

  // 使用部署者地址作为初始的钱包地址（实际项目应替换为独立地址）
  const marketingWallet = deployer.address;
  const teamWallet = deployer.address;

  console.log("========================================");
  console.log("  MemeToken 部署脚本");
  console.log("========================================");
  console.log(`  Name:            ${name}`);
  console.log(`  Symbol:          ${symbol}`);
  console.log(`  Total Supply:    ${totalSupply.toLocaleString()}`);
  console.log(`  Buy Tax:         ${buyTax / 100}%`);
  console.log(`  Sell Tax:        ${sellTax / 100}%`);
  console.log(`  Marketing Wallet: ${marketingWallet}`);
  console.log(`  Team Wallet:      ${teamWallet}`);
  console.log(`  Deployer:         ${deployer.address}`);
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

  // 验证
  const n = await token.name();
  const s = await token.symbol();
  const ts = await token.totalSupply();
  const bt = await token.buyTax();
  const st = await token.sellTax();
  const trading = await token.tradingEnabled();
  const maxTx = await token.maxTransactionAmount();
  const maxWallet = await token.maxWalletAmount();

  console.log("Contract State:");
  console.log(`  name(): ${n}`);
  console.log(`  symbol(): ${s}`);
  console.log(`  totalSupply(): ${ethers.formatEther(ts)}`);
  console.log(`  buyTax(): ${bt} (${Number(bt) / 100}%)`);
  console.log(`  sellTax(): ${st} (${Number(st) / 100}%)`);
  console.log(`  tradingEnabled: ${trading}`);
  console.log(`  maxTransactionAmount: ${ethers.formatEther(maxTx)}`);
  console.log(`  maxWalletAmount: ${ethers.formatEther(maxWallet)}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(await token.balanceOf(deployer.address))}\n`);

  // 启用交易
  console.log("Enabling trading...");
  const tx = await token.enableTrading();
  await tx.wait();
  console.log(`  tradingEnabled: ${await token.tradingEnabled()}\n`);

  // 测试转账
  console.log("Testing transfer (100 tokens)...");
  const [_, addr1] = await ethers.getSigners();
  await token.transfer(addr1.address, ethers.parseEther("100"));
  console.log(`  balanceOf(addr1): ${ethers.formatEther(await token.balanceOf(addr1.address))}`);

  console.log("\nDone! MemeToken is ready.");
  console.log(`  下一步: 设置 Uniswap Pair → await token.setUniswapPair(pairAddress)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
