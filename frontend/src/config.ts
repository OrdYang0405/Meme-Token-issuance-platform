// frontend/src/config.ts
// 合约地址常量与 TypeChain 类型导入

import type { MemeFactory } from "@typechain/contracts/MemeFactory";
import { MemeFactory__factory } from "@typechain/factories/contracts/MemeFactory__factory";

// 合约地址（部署后替换）
export const FACTORY_ADDRESS = "0x0000000000000000000000000000000000000000";

// 支持的链配置
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
