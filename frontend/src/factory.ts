// frontend/src/factory.ts
// MemeFactory 合约交互模块（只读查询 + 写入交易）

import { BrowserProvider, Contract, formatEther } from "ethers";
import { MemeFactory__factory, FACTORY_ADDRESS } from "./config";
import type { MemeFactory } from "./config";

// ─── 只读连接 ───

export function getFactoryReadOnly(provider: BrowserProvider): MemeFactory {
  return MemeFactory__factory.connect(FACTORY_ADDRESS, provider);
}

// ─── 签名连接 ───

export async function getFactoryWithSigner(
  provider: BrowserProvider
): Promise<MemeFactory> {
  const signer = await provider.getSigner();
  return MemeFactory__factory.connect(FACTORY_ADDRESS, signer);
}

// ─── 查询：总代币数 ───
// 对应 contracts/MemeFactory.sol:112 totalTokens()

export async function getTotalTokens(factory: MemeFactory): Promise<number> {
  const total = await factory.totalTokens();
  return Number(total);
}

// ─── 查询：创建费用 ───
// 对应 contracts/MemeFactory.sol:20 creationFee()

export async function getCreationFee(
  factory: MemeFactory
): Promise<{ fee: bigint; feeEth: string }> {
  const fee = await factory.creationFee();
  return { fee, feeEth: formatEther(fee) };
}

// ─── 查询：分页代币列表 ───
// 对应 contracts/MemeFactory.sol:124 getTokensPaginated(offset, limit)

export async function getTokensPaginated(
  factory: MemeFactory,
  offset: number,
  limit: number
): Promise<{ tokens: string[]; total: number }> {
  const result = await factory.getTokensPaginated(offset, limit);
  return { tokens: result.tokens, total: Number(result.total) };
}

// ─── 查询：某创建者的代币 ───
// 对应 contracts/MemeFactory.sol:116 getTokensByCreator(creator)

export async function getTokensByCreator(
  factory: MemeFactory,
  creator: string
): Promise<string[]> {
  return factory.getTokensByCreator(creator);
}

// ─── 查询：单个代币的创建参数 ───
// 对应 contracts/MemeFactory.sol:26 tokenParams 映射

export async function getTokenParams(
  factory: MemeFactory,
  tokenAddress: string
): Promise<{
  name: string;
  symbol: string;
  totalSupply: bigint;
  marketingWallet: string;
  teamWallet: string;
  buyTax: bigint;
  sellTax: bigint;
}> {
  const params = await factory.tokenParams(tokenAddress);
  return {
    name: params.name,
    symbol: params.symbol,
    totalSupply: params.totalSupply,
    marketingWallet: params.marketingWallet,
    teamWallet: params.teamWallet,
    buyTax: params.buyTax,
    sellTax: params.sellTax,
  };
}

// ─── 创建代币参数类型 ───
// 对应 contracts/MemeFactory.sol:8-17 TokenParams 结构体

export interface CreateTokenParams {
  name: string;
  symbol: string;
  totalSupply: bigint;
  marketingWallet: string;
  teamWallet: string;
  buyTax: bigint;
  sellTax: bigint;
}

// ─── 写入：创建代币 ───
// 对应 contracts/MemeFactory.sol:56-108 createToken(TokenParams) payable

export async function createToken(
  factory: MemeFactory,
  params: CreateTokenParams,
  creationFee: bigint
): Promise<{ txHash: string; tokenAddress: string; blockNumber: number }> {
  const tx = await factory.createToken(params, { value: creationFee });
  const receipt = await tx.wait();
  if (!receipt) throw new Error("未收到交易收据");

  let tokenAddress = "";
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && parsed.name === "TokenCreated") {
        tokenAddress = parsed.args.tokenAddress;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!tokenAddress) {
    throw new Error("交易成功但未能解析出代币地址");
  }

  return {
    txHash: tx.hash,
    tokenAddress,
    blockNumber: receipt.blockNumber,
  };
}

// ─── 错误类型 ───

export enum TxErrorType {
  USER_REJECTED = "USER_REJECTED",
  CONTRACT_REVERT = "CONTRACT_REVERT",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  NETWORK_ERROR = "NETWORK_ERROR",
  UNKNOWN = "UNKNOWN",
}

export interface TxError {
  type: TxErrorType;
  message: string;
}

// ─── 错误解析 ───

const REVERT_REASON_MAP: Record<string, string> = {
  "insufficient creation fee": "创建费用不足",
  "invalid name length": "代币名称长度不符合要求（1-32 字符）",
  "invalid symbol length": "代币符号长度不符合要求（1-8 字符）",
  "supply out of range": "供应量超出范围（1,000 ~ 1,000,000,000,000）",
  "zero marketing wallet": "营销钱包地址不能为零地址",
  "zero team wallet": "团队钱包地址不能为零地址",
  "tax too high": "税率不能超过 25%（2500 基点）",
};

export function parseTransactionError(err: any): TxError {
  if (err.code === "ACTION_REJECTED" || err.code === 4001) {
    return { type: TxErrorType.USER_REJECTED, message: "用户取消了交易" };
  }

  const reason = err.reason || err.shortMessage;
  if (reason) {
    return {
      type: TxErrorType.CONTRACT_REVERT,
      message: REVERT_REASON_MAP[reason] || `合约执行失败: ${reason}`,
    };
  }

  if (err.message && err.message.includes("insufficient funds")) {
    return {
      type: TxErrorType.INSUFFICIENT_FUNDS,
      message: "账户余额不足",
    };
  }

  return {
    type: TxErrorType.UNKNOWN,
    message: `发生未知错误: ${err.message || "请重试"}`,
  };
}

// ─── 安全交易包装 ───

export async function safeExecuteTx<T>(
  fn: () => Promise<T>,
  onError: (error: TxError) => void
): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    const txError = parseTransactionError(err);
    if (txError.type !== TxErrorType.USER_REJECTED) {
      onError(txError);
    }
    return null;
  }
}
