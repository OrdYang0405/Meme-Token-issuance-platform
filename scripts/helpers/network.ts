// scripts/helpers/network.ts
// 第14课：多网络配置管理 —— 链 ID 驱动的地址表 + 自动网络检测
//
// 支持的链：
//   - Hardhat (31337)  → Fork 主网 Uniswap 地址
//   - Sepolia (11155111) → 测试网 Uniswap V2
//   - Mainnet (1) → 生产 Uniswap V2

import { ethers } from "hardhat";

// ============ 常量 ============

const UNISWAP_ADDRESSES: Record<number, { factory: string; router: string }> = {
  11155111: {
    factory: "0x7E0987E5b3a30e3f2828572Bb659A548460a3003",
    router: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",
  },
  1: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
  31337: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
};

const NETWORK_NAMES: Record<number, string> = {
  1: "mainnet",
  11155111: "sepolia",
  31337: "hardhat",
};

export interface NetworkInfo {
  name: string;
  chainId: number;
  isTestnet: boolean;
  uniswapV2Factory: string;
  uniswapV2Router: string;
}

// ============ 最小化 ABI（避免引入完整 typechain）============

export const ROUTER_ABI = [
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)",
  "function getAmountsOut(uint256,address[]) external view returns (uint256[])",
];

export const FACTORY_ABI = [
  "function createPair(address,address) external returns (address)",
  "function getPair(address,address) external view returns (address)",
];

// ============ 网络检测 ============

async function detectNetwork(): Promise<NetworkInfo> {
  const { chainId } = await ethers.provider.getNetwork();
  const chainIdNum = Number(chainId);

  const uni = UNISWAP_ADDRESSES[chainIdNum];
  if (!uni) {
    throw new Error(
      `不支持的链 ID: ${chainIdNum}。支持的链: ${Object.keys(UNISWAP_ADDRESSES).join(", ")}`
    );
  }

  const name = NETWORK_NAMES[chainIdNum] || `chain-${chainIdNum}`;

  return {
    name,
    chainId: chainIdNum,
    isTestnet: chainIdNum !== 1,
    uniswapV2Factory: uni.factory,
    uniswapV2Router: uni.router,
  };
}

// ============ ETH 余额检查 ============

async function checkBalance(deployer: string, network: NetworkInfo): Promise<bigint> {
  const balance = await ethers.provider.getBalance(deployer);
  const minBalance = network.isTestnet
    ? ethers.parseEther("0.1")
    : ethers.parseEther("0.5");

  return balance;
}

function getMinBalance(network: NetworkInfo): bigint {
  return network.isTestnet
    ? ethers.parseEther("0.1")
    : ethers.parseEther("0.5");
}

// ============ Gas Price 查询 ============

async function getGasGwei(): Promise<string> {
  const feeData = await ethers.provider.getFeeData();
  if (feeData.gasPrice) {
    return ethers.formatUnits(feeData.gasPrice, "gwei");
  }
  return "unknown";
}

// ============ WETH 地址查询 ============

async function getWETH(network: NetworkInfo, signer: ethers.Signer): Promise<string> {
  const router = new ethers.Contract(network.uniswapV2Router, ROUTER_ABI, signer);
  return router.WETH();
}

// ============ Pair 地址查询 ============

async function getOrCreatePair(
  tokenAddr: string,
  network: NetworkInfo,
  signer: ethers.Signer
): Promise<string> {
  const factory = new ethers.Contract(network.uniswapV2Factory, FACTORY_ABI, signer);
  const weth = await getWETH(network, signer);

  let pairAddr = await factory.getPair(tokenAddr, weth);
  if (pairAddr === ethers.ZeroAddress) {
    const tx = await factory.createPair(tokenAddr, weth);
    await tx.wait();
    pairAddr = await factory.getPair(tokenAddr, weth);
  }
  return pairAddr;
}

// ============ 导出 ============

export {
  UNISWAP_ADDRESSES,
  NETWORK_NAMES,
  detectNetwork,
  checkBalance,
  getMinBalance,
  getGasGwei,
  getWETH,
  getOrCreatePair,
};
