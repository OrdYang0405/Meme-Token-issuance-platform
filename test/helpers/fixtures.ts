// test/helpers/fixtures.ts
// 共享测试 Fixture —— 使用 loadFixture 快照机制加速测试
// 用法：const { token, owner } = await loadFixture(deployMemeToken);

import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MemeToken, MemeFactory, MemeFairLaunch, StandardMemeToken } from "../../typechain-types";
import { buildMerkleTree, TokenParams, FairLaunchParams } from "./utils";

// ============ 常量定义 ============

export const MEME_TOKEN_DEFAULTS = {
  name: "Test Meme",
  symbol: "TEST",
  totalSupply: 1_000_000,
  buyTax: 300,
  sellTax: 500,
} as const;

export const FACTORY_DEFAULTS = {
  creationFee: ethers.parseEther("0.01"),
} as const;

export const FAIR_LAUNCH_DEFAULTS = {
  tokensPerETH: 10000n,
  tokensForSale: ethers.parseEther("400000"),
  softCap: ethers.parseEther("10"),
  hardCap: ethers.parseEther("40"),
  maxPerWallet: ethers.parseEther("15"),
  whitelistDuration: 3600,
  publicDuration: 7200,
  liquidityETH: ethers.parseEther("10"),
} as const;

// ============ Fixture 返回值类型 ============

export interface MemeTokenFixture {
  token: MemeToken;
  owner: SignerWithAddress;
  marketing: SignerWithAddress;
  team: SignerWithAddress;
  buyer: SignerWithAddress;
  seller: SignerWithAddress;
  pair: SignerWithAddress;
}

export interface MemeFactoryFixture {
  factory: MemeFactory;
  owner: SignerWithAddress;
  creator: SignerWithAddress;
  marketing: SignerWithAddress;
  team: SignerWithAddress;
}

export interface MemeFairLaunchFixture {
  launch: MemeFairLaunch;
  token: MemeToken;
  owner: SignerWithAddress;
  marketing: SignerWithAddress;
  team: SignerWithAddress;
  lpReceiver: SignerWithAddress;
  buyers: SignerWithAddress[];
  nonWhitelisted: SignerWithAddress;
  merkleRoot: string;
  getProof: (addr: string) => string[];
}

// ============ MemeToken Fixture ============

export async function deployMemeToken(): Promise<MemeTokenFixture> {
  const [owner, marketing, team, buyer, seller, pair] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("MemeToken");
  const token = await Factory.deploy(
    MEME_TOKEN_DEFAULTS.name,
    MEME_TOKEN_DEFAULTS.symbol,
    MEME_TOKEN_DEFAULTS.totalSupply,
    marketing.address,
    team.address,
    MEME_TOKEN_DEFAULTS.buyTax,
    MEME_TOKEN_DEFAULTS.sellTax,
  );
  await token.waitForDeployment();

  // 设置交易条件
  await token.enableTrading();
  await token.setUniswapPair(pair.address);

  return { token, owner, marketing, team, buyer, seller, pair };
}

// ============ StandardMemeToken Fixture ============

export interface StandardMemeTokenFixture {
  token: StandardMemeToken;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}

export async function deployStandardMemeToken(): Promise<StandardMemeTokenFixture> {
  const [owner, user] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("StandardMemeToken");
  const token = await Factory.deploy("Standard Meme", "SMEME", 1_000_000, 10_000_000);
  await token.waitForDeployment();

  return { token, owner, user };
}

// ============ MemeFactory Fixture ============

export async function deployMemeFactory(): Promise<MemeFactoryFixture> {
  const [owner, creator, marketing, team] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("MemeFactory");
  const factory = await Factory.deploy(FACTORY_DEFAULTS.creationFee);
  await factory.waitForDeployment();

  return { factory, owner, creator, marketing, team };
}

// ============ MemeFairLaunch Fixture ============

export async function deployMemeFairLaunch(): Promise<MemeFairLaunchFixture> {
  const [owner, marketing, team, lpReceiver, ...rest] = await ethers.getSigners();
  const buyers = rest.slice(0, 5);
  const nonWhitelisted = rest[5];

  // 1. 部署 MemeToken
  const TokenFactory = await ethers.getContractFactory("MemeToken");
  const token = await TokenFactory.deploy(
    "FairLaunch Meme", "FLM", 1_000_000,
    marketing.address, team.address, 300, 500,
  );
  await token.waitForDeployment();

  // 2. 构建 Merkle Tree（白名单：前 5 个 buyer）
  const whitelistAddrs = buyers.map(b => b.address);
  const { merkleTree, merkleRoot, getProof } = buildMerkleTree(whitelistAddrs);

  // 3. 部署 FairLaunch
  const LaunchFactory = await ethers.getContractFactory("MemeFairLaunch");
  const launch = await LaunchFactory.deploy(
    await token.getAddress(),
    FAIR_LAUNCH_DEFAULTS.tokensPerETH,
    FAIR_LAUNCH_DEFAULTS.tokensForSale,
    FAIR_LAUNCH_DEFAULTS.softCap,
    FAIR_LAUNCH_DEFAULTS.hardCap,
    FAIR_LAUNCH_DEFAULTS.maxPerWallet,
    FAIR_LAUNCH_DEFAULTS.whitelistDuration,
    FAIR_LAUNCH_DEFAULTS.publicDuration,
    merkleRoot,
    ethers.ZeroAddress,
    FAIR_LAUNCH_DEFAULTS.liquidityETH,
    lpReceiver.address,
  );
  await launch.waitForDeployment();

  // 4. 启用交易并转移代币到 FairLaunch
  await token.enableTrading();
  await token.setExcludedFromLimits(await launch.getAddress(), true);
  await token.transfer(await launch.getAddress(), FAIR_LAUNCH_DEFAULTS.tokensForSale);

  return { launch, token, owner, marketing, team, lpReceiver, buyers, nonWhitelisted, merkleRoot, getProof };
}

// ============ 重新导出 loadFixture（方便调用方只需一个 import）============

export { loadFixture };
