// frontend/src/config.ts
// 合约地址常量与 TypeChain 类型导入

import type { MemeFactory } from "@typechain/contracts/MemeFactory";
import { MemeFactory__factory } from "@typechain/factories/contracts/MemeFactory__factory";

// 合约地址（部署后替换）
export const FACTORY_ADDRESS = "0x0000000000000000000000000000000000000000";

// ============ Uniswap V2 地址（按链 ID 映射）============

export const UNISWAP_ADDRESSES: Record<
  number,
  { factory: string; router: string }
> = {
  1: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
  11155111: {
    factory: "0x7E0987E5b3a30e3f2828572Bb659A548460a3003",
    router: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",
  },
  31337: {
    factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  },
};

// ============ 支持的链配置 ============

export const SUPPORTED_CHAINS: Record<
  number,
  { name: string; rpcUrl: string; explorerUrl: string }
> = {
  31337: {
    name: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "",
  },
  11155111: {
    name: "Sepolia Testnet",
    rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY",
    explorerUrl: "https://sepolia.etherscan.io",
  },
};

// 默认每页数量
export const DEFAULT_PAGE_SIZE = 10;

export { MemeFactory__factory };
export type { MemeFactory };
