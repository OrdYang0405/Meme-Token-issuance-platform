import { ethers } from "hardhat";

async function main() {
  // 部署参数
  const tokenName = "Hello Meme";
  const tokenSymbol = "HEME";
  const initialSupply = 1_000_000; // 100万

  console.log("Deploying HelloMeme...");
  console.log(`  Name: ${tokenName}`);
  console.log(`  Symbol: ${tokenSymbol}`);
  console.log(`  Initial Supply: ${initialSupply.toLocaleString()}`);

  // 获取合约工厂
  const HelloMeme = await ethers.getContractFactory("HelloMeme");

  // 部署合约
  const contract = await HelloMeme.deploy(tokenName, tokenSymbol, initialSupply);

  // 等待部署完成
  await contract.waitForDeployment();

  // 获取部署信息
  const address = await contract.getAddress();
  const deployer = (await ethers.getSigners())[0];

  console.log("\nDeployment successful!");
  console.log(`  Contract Address: ${address}`);
  console.log(`  Deployer: ${deployer.address}`);

  // 验证
  const name = await contract.name();
  const symbol = await contract.symbol();
  const totalSupply = await contract.totalSupply();
  const deployerBalance = await contract.balanceOf(deployer.address);

  console.log("\nVerification:");
  console.log(`  name(): ${name}`);
  console.log(`  symbol(): ${symbol}`);
  console.log(`  totalSupply(): ${ethers.formatEther(totalSupply)}`);
  console.log(`  balanceOf(deployer): ${ethers.formatEther(deployerBalance)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
