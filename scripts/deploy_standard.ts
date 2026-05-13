import { ethers } from "hardhat";

async function main() {
  const tokenName = "Standard Meme";
  const tokenSymbol = "SMEME";
  const initialSupply = 1_000_000; // 100 万初始铸造
  const maxSupply = 10_000_000;    // 1000 万硬顶（0 表示不限）

  console.log("Deploying StandardMemeToken...");
  console.log(`  Name: ${tokenName}`);
  console.log(`  Symbol: ${tokenSymbol}`);
  console.log(`  Initial Supply: ${initialSupply.toLocaleString()}`);
  console.log(`  Max Supply: ${maxSupply > 0 ? maxSupply.toLocaleString() : "unlimited"}`);

  const StandardMemeToken = await ethers.getContractFactory("StandardMemeToken");
  const token = await StandardMemeToken.deploy(
    tokenName,
    tokenSymbol,
    initialSupply,
    maxSupply
  );
  await token.waitForDeployment();

  const address = await token.getAddress();
  const deployer = (await ethers.getSigners())[0];

  console.log("\nDeployment successful!");
  console.log(`  Contract Address: ${address}`);

  // 验证
  const name = await token.name();
  const symbol = await token.symbol();
  const totalSupply = await token.totalSupply();
  const owner = await token.owner();
  const deployerBalance = await token.balanceOf(deployer.address);

  console.log("\nVerification:");
  console.log(`  name(): ${name}`);
  console.log(`  symbol(): ${symbol}`);
  console.log(`  owner(): ${owner}`);
  console.log(`  totalSupply(): ${ethers.formatEther(totalSupply)}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(deployerBalance)}`);

  // 测试 mint
  const mintAmount = 500_000;
  console.log(`\nTesting mint(${mintAmount.toLocaleString()})...`);
  const mintTx = await token.mint(deployer.address, mintAmount);
  await mintTx.wait();

  const newSupply = await token.totalSupply();
  const newBalance = await token.balanceOf(deployer.address);
  console.log(`  totalSupply(): ${ethers.formatEther(newSupply)}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(newBalance)}`);

  // 测试 burn
  const burnAmount = 100_000;
  console.log(`\nTesting burn(${burnAmount.toLocaleString()})...`);
  const burnTx = await token.burn(burnAmount);
  await burnTx.wait();

  const afterBurnSupply = await token.totalSupply();
  const afterBurnBalance = await token.balanceOf(deployer.address);
  console.log(`  totalSupply(): ${ethers.formatEther(afterBurnSupply)}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(afterBurnBalance)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
