// frontend/src/swap/swap.ts
// Swap 核心逻辑：链上报价、交易执行、滑点保护

import { BrowserProvider, Contract, Signer } from "ethers";
import type { TokenMetadata } from "./tokenSearch";
import { NATIVE_ETH, isNativeETH } from "./tokenSearch";
import {
  getPriceImpactLevel,
  getAutoSlippage,
  formatPriceImpact,
  DEFAULT_SLIPPAGE,
  MIN_SLIPPAGE,
  MAX_SLIPPAGE,
} from "./priceImpact";
import type { ImpactLevel } from "./priceImpact";

// ============ Router ABI ============

export const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[])",
  "function getAmountsIn(uint amountOut, address[] path) view returns (uint[])",
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[])",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[])",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
];

export const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

export const FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
];

// ============ 类型定义 ============

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippagePercent: number;
}

export interface QuoteResult {
  amountOut: bigint;
  amountOutMin: bigint;
  executionPrice: number;
  spotPrice: number;
  priceImpact: number;
  priceImpactLevel: ImpactLevel;
  path: string[];
  feeOnTransfer: boolean;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: string;
  deadline: number;
  slippagePercent: number;
  isFeeOnTransfer: boolean;
}

export interface SwapConfirmationDetails {
  amountIn: string;
  tokenInSymbol: string;
  amountOut: string;
  tokenOutSymbol: string;
  exchangeRate: string;
  priceImpact: string;
  priceImpactLevel: ImpactLevel;
  slippagePercent: number;
  estimatedGas: string;
  minimumReceived: string;
  recipient: string;
  buyTax?: number;
  sellTax?: number;
}

// ============ 报价引擎 ============

/**
 * 获取交易报价（正向：给定输入量，计算输出量）
 */
export async function getSwapQuote(
  provider: BrowserProvider,
  routerAddress: string,
  request: QuoteRequest
): Promise<QuoteResult> {
  const router = new Contract(routerAddress, ROUTER_ABI, provider);
  const weth: string = await router.WETH();

  const tokenIn = request.tokenIn === NATIVE_ETH.address ? weth : request.tokenIn;
  const tokenOut = request.tokenOut === NATIVE_ETH.address ? weth : request.tokenOut;
  const path = [tokenIn, tokenOut];

  // 调用 Router 获取报价
  const amounts: bigint[] = await router.getAmountsOut(request.amountIn, path);
  const amountOut = amounts[amounts.length - 1];

  if (amountOut === 0n) {
    throw new Error("交易路径无流动性，输出量为 0");
  }

  // 查询 Pair reserves 计算即时价格
  const factoryAddr: string = await router.factory();
  const factory = new Contract(factoryAddr, FACTORY_ABI, provider);
  const pairAddr: string = await factory.getPair(tokenIn, tokenOut);
  const pair = new Contract(pairAddr, PAIR_ABI, provider);
  const reserves = await pair.getReserves();
  const token0: string = await pair.token0();

  let reserveIn: bigint;
  let reserveOut: bigint;
  if (tokenIn.toLowerCase() < tokenOut.toLowerCase()) {
    reserveIn = reserves[0];
    reserveOut = reserves[1];
  } else {
    reserveIn = reserves[1];
    reserveOut = reserves[0];
  }

  // 计算价格冲击
  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const executionPrice = Number(amountOut) / Number(request.amountIn);
  const priceImpact =
    spotPrice > 0 ? ((spotPrice - executionPrice) / spotPrice) * 100 : 0;

  // 应用滑点保护
  const slip = request.slippagePercent;
  const slippageFactor = (100 - slip) / 100;
  const amountOutMin = BigInt(Math.floor(Number(amountOut) * slippageFactor));

  return {
    amountOut,
    amountOutMin,
    executionPrice,
    spotPrice,
    priceImpact,
    priceImpactLevel: getPriceImpactLevel(priceImpact),
    path,
    feeOnTransfer: true,
  };
}

/**
 * 反向报价：给定期望输出量，计算所需输入量
 */
export async function getSwapQuoteIn(
  provider: BrowserProvider,
  routerAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountOut: bigint,
  slippagePercent: number
): Promise<{ amountIn: bigint; amountInMax: bigint }> {
  const router = new Contract(routerAddress, ROUTER_ABI, provider);
  const weth: string = await router.WETH();

  const _tokenIn = tokenIn === NATIVE_ETH.address ? weth : tokenIn;
  const _tokenOut = tokenOut === NATIVE_ETH.address ? weth : tokenOut;
  const path = [_tokenIn, _tokenOut];

  const amounts: bigint[] = await router.getAmountsIn(amountOut, path);
  const amountIn = amounts[0];

  // 反向滑点：最多多付 slippage%
  const slippageFactor = (100 + slippagePercent) / 100;
  const amountInMax = BigInt(Math.ceil(Number(amountIn) * slippageFactor));

  return { amountIn, amountInMax };
}

// ============ MemeToken 税费修正 ============

/**
 * 针对 MemeToken 的报价修正（买入方向扣 buyTax）
 */
export async function getMemeTokenQuote(
  provider: BrowserProvider,
  routerAddress: string,
  token: Contract,
  request: QuoteRequest,
  direction: "buy" | "sell"
): Promise<QuoteResult> {
  const baseQuote = await getSwapQuote(provider, routerAddress, request);

  let adjustedAmountOut = baseQuote.amountOut;

  if (direction === "buy") {
    const buyTax: bigint = await token.buyTax();
    adjustedAmountOut =
      (baseQuote.amountOut * (10000n - buyTax)) / 10000n;
  }

  const slip = request.slippagePercent;
  const slippageFactor = (100 - slip) / 100;
  const amountOutMin = BigInt(
    Math.floor(Number(adjustedAmountOut) * slippageFactor)
  );

  return {
    ...baseQuote,
    amountOut: adjustedAmountOut,
    amountOutMin,
  };
}

// ============ 交易执行 ============

/**
 * ETH → Token 买入
 */
export async function swapETHForTokens(
  signer: Signer,
  routerAddress: string,
  params: SwapParams
): Promise<{ txHash: string; amountOut: bigint }> {
  const router = new Contract(routerAddress, ROUTER_ABI, signer);
  const weth: string = await router.WETH();
  const path = [weth, params.tokenOut];

  let tx;
  if (params.isFeeOnTransfer) {
    tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      params.amountOutMin,
      path,
      params.recipient,
      params.deadline,
      { value: params.amountIn }
    );
  } else {
    tx = await router.swapExactETHForTokens(
      params.amountOutMin,
      path,
      params.recipient,
      params.deadline,
      { value: params.amountIn }
    );
  }

  console.log("买入交易已广播:", tx.hash);
  const receipt = await tx.wait();

  // 从 Transfer 事件解析实际收到的代币量
  let amountOut = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === params.tokenOut.toLowerCase()) {
      try {
        const to = "0x" + log.topics[2].slice(26);
        if (to.toLowerCase() === params.recipient.toLowerCase()) {
          amountOut = BigInt(log.data);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return { txHash: tx.hash, amountOut };
}

/**
 * Token → ETH 卖出
 */
export async function swapTokensForETH(
  signer: Signer,
  routerAddress: string,
  token: Contract,
  params: SwapParams
): Promise<{ txHash: string; ethReceived: bigint }> {
  const router = new Contract(routerAddress, ROUTER_ABI, signer);
  const weth: string = await router.WETH();
  const path = [params.tokenOut, weth];

  // 步骤 1：approve Router
  const approveTx = await token.approve(routerAddress, params.amountIn);
  await approveTx.wait();
  console.log("approve 已确认");

  // 步骤 2：执行卖出
  const tx =
    await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      params.amountIn,
      params.amountOutMin,
      path,
      params.recipient,
      params.deadline
    );

  console.log("卖出交易已广播:", tx.hash);
  await tx.wait();

  // 通过 WETH Withdrawal 事件获取 ETH 数量
  // 解析所有 WETH 相关日志中的 Withdrawal 事件
  let ethReceived = 0n;
  const wethContract = new Contract(weth, [
    "event Withdrawal(address indexed src, uint wad)",
  ], signer);

  // 实际从 receipt logs 中查找
  for (const log of tx.receipt?.logs || []) {
    if (log.address.toLowerCase() === weth.toLowerCase()) {
      try {
        const parsed = wethContract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed && parsed.name === "Withdrawal") {
          ethReceived = ethReceived + parsed.args.wad;
        }
      } catch {
        continue;
      }
    }
  }

  return { txHash: tx.hash, ethReceived };
}

// ============ Gas 估算 ============

export async function estimateSwapGas(
  provider: BrowserProvider,
  routerAddress: string,
  params: SwapParams
): Promise<bigint | null> {
  try {
    const router = new Contract(routerAddress, ROUTER_ABI, provider);
    const weth: string = await router.WETH();
    let gasEstimate: bigint;

    if (params.tokenIn === NATIVE_ETH.address) {
      const path = [weth, params.tokenOut];
      if (params.isFeeOnTransfer) {
        gasEstimate =
          await router.swapExactETHForTokensSupportingFeeOnTransferTokens.estimateGas(
            params.amountOutMin,
            path,
            params.recipient,
            params.deadline,
            { value: params.amountIn }
          );
      } else {
        gasEstimate = await router.swapExactETHForTokens.estimateGas(
          params.amountOutMin,
          path,
          params.recipient,
          params.deadline,
          { value: params.amountIn }
        );
      }
    } else {
      const path = [params.tokenOut, weth];
      gasEstimate =
        await router.swapExactTokensForETHSupportingFeeOnTransferTokens.estimateGas(
          params.amountIn,
          params.amountOutMin,
          path,
          params.recipient,
          params.deadline
        );
    }

    return gasEstimate;
  } catch (err) {
    console.error("Gas 估算失败:", err);
    return null;
  }
}

// ============ 滑点工具 ============

export function applySlippage(
  amount: bigint,
  slippagePercent: number,
  direction: "out" | "in"
): bigint {
  if (direction === "out") {
    const factor = (100 - slippagePercent) / 100;
    return BigInt(Math.floor(Number(amount) * factor));
  } else {
    const factor = (100 + slippagePercent) / 100;
    return BigInt(Math.ceil(Number(amount) * factor));
  }
}

// ============ 确认数据构建 ============

export function buildConfirmationDetails(
  quote: QuoteResult,
  params: SwapParams,
  tokenInMeta: TokenMetadata,
  tokenOutMeta: TokenMetadata,
  estimatedGas: bigint | null,
  buyTax?: number,
  sellTax?: number
): SwapConfirmationDetails {
  const amountInHuman =
    Number(params.amountIn) / 10 ** tokenInMeta.decimals;
  const amountOutHuman =
    Number(quote.amountOut) / 10 ** tokenOutMeta.decimals;

  return {
    amountIn: `${amountInHuman.toFixed(6)}`,
    tokenInSymbol: tokenInMeta.symbol,
    amountOut: `${amountOutHuman.toFixed(6)}`,
    tokenOutSymbol: tokenOutMeta.symbol,
    exchangeRate: `1 ${tokenInMeta.symbol} = ${(amountOutHuman / amountInHuman).toFixed(6)} ${tokenOutMeta.symbol}`,
    priceImpact: formatPriceImpact(quote.priceImpact),
    priceImpactLevel: quote.priceImpactLevel,
    slippagePercent: params.slippagePercent,
    estimatedGas: estimatedGas
      ? `${(Number(estimatedGas) * 1e-9).toFixed(4)} Gwei`
      : "估算失败",
    minimumReceived: `${(Number(quote.amountOutMin) / 10 ** tokenOutMeta.decimals).toFixed(6)} ${tokenOutMeta.symbol}`,
    recipient: `${params.recipient.slice(0, 6)}...${params.recipient.slice(-4)}`,
    buyTax,
    sellTax,
  };
}

// ============ Etherscan 链接 ============

export function getEtherscanLink(
  chainId: number,
  hash: string,
  type: "tx" | "address"
): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    31337: "#",
  };

  const base = explorers[chainId] || "https://etherscan.io";
  return `${base}/${type}/${hash}`;
}

// ============ 完整 Swap 流程 ============

export async function executeSwap(
  signer: Signer,
  routerAddress: string,
  token: Contract,
  params: SwapParams,
  onStateChange: (state: string, error?: string | null) => void
): Promise<{ txHash: string; amountOut: bigint } | null> {
  try {
    // 阶段 1：卖出需 approve
    if (params.tokenIn !== NATIVE_ETH.address) {
      onStateChange("AWAITING_APPROVAL");
      const approveTx = await token.approve(routerAddress, params.amountIn);
      await approveTx.wait();
    }

    // 阶段 2：执行 swap
    onStateChange("AWAITING_SWAP");

    let txHash: string;
    let amountOut: bigint;

    if (params.tokenIn === NATIVE_ETH.address) {
      const result = await swapETHForTokens(signer, routerAddress, params);
      txHash = result.txHash;
      amountOut = result.amountOut;
    } else {
      const result = await swapTokensForETH(signer, routerAddress, token, params);
      txHash = result.txHash;
      amountOut = result.ethReceived;
    }

    // 阶段 3：确认中
    onStateChange("SWAP_PENDING");

    return { txHash, amountOut };
  } catch (err: any) {
    if (err.code === "ACTION_REJECTED" || err.code === 4001) {
      onStateChange("QUOTE_READY");
      return null;
    }
    onStateChange("FAILED", err.shortMessage || err.message || "交易失败");
    return null;
  }
}
