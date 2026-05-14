// frontend/src/swap-page.ts
// 交易页面入口——连接钱包、加载代币、绑定 Swap 面板

import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { connectWallet, getConnectedAccounts, watchWalletChanges } from "./wallet";
import type { WalletState } from "./wallet";
import { MemeFactory__factory, FACTORY_ADDRESS, UNISWAP_ADDRESSES } from "./config";
import {
  getTradeableTokens,
  NATIVE_ETH,
  isNativeETH,
  TokenMetadata,
} from "./swap/tokenSearch";
import { getMemeTokenQuote, executeSwap, getSwapQuote } from "./swap/swap";
import type { QuoteResult, SwapParams } from "./swap/swap";
import { SwapState, getButtonText, isButtonDisabled } from "./swap/swapState";
import type { SwapStateMachine } from "./swap/swapState";
import { getAutoSlippage, DEFAULT_SLIPPAGE } from "./swap/priceImpact";

// ============ MEME_TOKEN ABI（最小化，仅用于查询税费和余额）============

const MEME_TOKEN_ABI = [
  "function buyTax() view returns (uint256)",
  "function sellTax() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

// ============ 全局状态 ============

let wallet: WalletState | null = null;
let provider: BrowserProvider | null = null;
let routerAddress: string;
let tradeableTokens: TokenMetadata[] = [];
let selectedTokenIn: TokenMetadata = NATIVE_ETH;
let selectedTokenOut: TokenMetadata | null = null;
let currentQuote: QuoteResult | null = null;
let currentSlippage = DEFAULT_SLIPPAGE;

let swapState: SwapStateMachine = {
  state: SwapState.IDLE,
  error: null,
  txHash: null,
};

// 防抖计时器
let debounceTimer: ReturnType<typeof setTimeout>;

// ============ 页面初始化 ============

export async function initSwapPage(): Promise<void> {
  const { ethereum } = window as any;
  if (!ethereum) {
    showError("请安装 MetaMask 插件");
    return;
  }

  provider = new BrowserProvider(ethereum);

  // 确定 Uniswap Router 地址
  const chainIdHex: string = await ethereum.request({ method: "eth_chainId" });
  const chainId = parseInt(chainIdHex, 16);
  const uniAddr = UNISWAP_ADDRESSES[chainId];
  if (!uniAddr) {
    showError(`当前网络 (chainId=${chainId}) 不支持 Uniswap，请切换网络`);
    return;
  }
  routerAddress = uniAddr.router;

  // 静默检查钱包
  const accounts = await getConnectedAccounts();
  if (accounts.length > 0) {
    wallet = { address: accounts[0], provider: provider!, chainId };
    onWalletReady();
  }

  // 加载代币列表
  await loadTokenList();

  // 绑定 UI 事件
  bindEvents();

  // 监听钱包变化
  watchWalletChanges(handleAccountChange);
}

// ============ 加载代币列表 ============

async function loadTokenList(): Promise<void> {
  if (!provider) return;

  try {
    const factoryRO = MemeFactory__factory.connect(FACTORY_ADDRESS, provider);
    tradeableTokens = await getTradeableTokens(factoryRO, provider);
    // ETH 总是在列表最前面
    tradeableTokens = [NATIVE_ETH, ...tradeableTokens];
    renderTokenOptions();
  } catch (err) {
    console.error("加载代币列表失败:", err);
  }
}

// ============ 报价更新 ============

async function updateQuote(): Promise<void> {
  if (!provider || !selectedTokenOut) return;

  const inputEl = document.getElementById("amount-in") as HTMLInputElement;
  const rawAmount = inputEl.value;
  if (!rawAmount || parseFloat(rawAmount) <= 0) {
    updateSwapState({ state: SwapState.IDLE, error: null, txHash: null });
    return;
  }

  updateSwapState({ state: SwapState.QUOTING, error: null, txHash: null });

  try {
    const amountIn = parseEther(rawAmount); // 简化：假设 18 位精度

    // 自动滑点
    currentSlippage = getAutoSlippage(0); // 初始默认，获取报价后更新

    const quote = await getSwapQuote(provider, routerAddress, {
      tokenIn: selectedTokenIn.address,
      tokenOut: selectedTokenOut.address,
      amountIn,
      slippagePercent: currentSlippage,
    });

    // 根据价格冲击调整滑点
    currentSlippage = getAutoSlippage(quote.priceImpact);

    // 重新计算带正确滑点的 amountOutMin
    quote.amountOutMin = BigInt(
      Math.floor(
        Number(quote.amountOut) * ((100 - currentSlippage) / 100)
      )
    );

    currentQuote = quote;
    updateSwapState({ state: SwapState.QUOTE_READY, error: null, txHash: null });
    renderQuote(quote);
  } catch (err: any) {
    updateSwapState({
      state: SwapState.FAILED,
      error: err.shortMessage || err.message || "报价失败",
      txHash: null,
    });
  }
}

// ============ 执行 Swap ============

async function handleSwap(): Promise<void> {
  if (!wallet || !currentQuote || !selectedTokenOut) return;

  const signer = await wallet.provider.getSigner();

  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 分钟
  const params: SwapParams = {
    tokenIn: selectedTokenIn.address,
    tokenOut: selectedTokenOut.address,
    amountIn: parseEther(
      (document.getElementById("amount-in") as HTMLInputElement).value
    ),
    amountOutMin: currentQuote.amountOutMin,
    recipient: wallet.address,
    deadline,
    slippagePercent: currentSlippage,
    isFeeOnTransfer: true,
  };

  const token = new Contract(selectedTokenOut.address, MEME_TOKEN_ABI, signer);

  const result = await executeSwap(
    signer,
    routerAddress,
    token,
    params,
    (state: string, error?: string | null) => {
      updateSwapState({
        state: state as SwapState,
        error: error || null,
        txHash: null,
      });
    }
  );

  if (result) {
    updateSwapState({
      state: SwapState.SWAP_CONFIRMED,
      error: null,
      txHash: result.txHash,
    });
  }
}

// ============ 状态管理 ============

function updateSwapState(next: SwapStateMachine): void {
  swapState = next;
  const btn = document.getElementById("btn-swap") as HTMLButtonElement;
  if (btn) {
    btn.textContent = getButtonText(swapState.state);
    btn.disabled = isButtonDisabled(swapState.state);
  }

  // 错误提示
  const errorEl = document.getElementById("swap-error");
  if (errorEl) {
    errorEl.textContent = swapState.error || "";
    errorEl.classList.toggle("hidden", !swapState.error);
  }

  // 成功提示
  if (swapState.state === SwapState.SWAP_CONFIRMED && swapState.txHash) {
    showSwapSuccess(swapState.txHash);
  }
}

// ============ 事件绑定 ============

function bindEvents(): void {
  // 连接钱包按钮
  document.getElementById("btn-connect")?.addEventListener("click", handleConnect);

  // 金额输入（防抖 500ms）
  document.getElementById("amount-in")?.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => updateQuote(), 500);
  });

  // Swap 按钮
  document.getElementById("btn-swap")?.addEventListener("click", () => {
    if (swapState.state === SwapState.QUOTE_READY) {
      handleSwap();
    }
  });

  // 方向切换
  document.getElementById("btn-switch")?.addEventListener("click", switchDirection);
}

// ============ 方向切换 ============

function switchDirection(): void {
  if (!selectedTokenOut) return;
  const tmp = selectedTokenIn;
  selectedTokenIn = selectedTokenOut;
  selectedTokenOut = tmp;
  updateTokenDisplay();
  updateQuote();
}

// ============ UI 渲染 ============

function renderTokenOptions(): void {
  // 实现代币选择器渲染（简化版）
}

function updateTokenDisplay(): void {
  const inEl = document.getElementById("token-in-label");
  const outEl = document.getElementById("token-out-label");
  if (inEl) inEl.textContent = selectedTokenIn.symbol;
  if (outEl && selectedTokenOut) outEl.textContent = selectedTokenOut.symbol;
}

function renderQuote(quote: QuoteResult): void {
  const outEl = document.getElementById("amount-out") as HTMLInputElement;
  if (outEl && selectedTokenOut) {
    outEl.value = formatEther(quote.amountOut);
  }

  const rateEl = document.getElementById("exchange-rate");
  if (rateEl) {
    rateEl.textContent = `1 ${selectedTokenIn.symbol} = ${quote.executionPrice.toFixed(6)} ${selectedTokenOut!.symbol}`;
  }

  const impactEl = document.getElementById("price-impact");
  if (impactEl) {
    impactEl.textContent = `${quote.priceImpact.toFixed(2)}%`;
    impactEl.className = `impact-${quote.priceImpactLevel}`;
  }
}

function showSwapSuccess(txHash: string): void {
  const linkEl = document.getElementById("tx-link") as HTMLAnchorElement;
  if (linkEl && wallet) {
    const chainId = wallet.chainId === 31337 ? 11155111 : wallet.chainId;
    const base = chainId === 1
      ? "https://etherscan.io"
      : "https://sepolia.etherscan.io";
    linkEl.href = `${base}/tx/${txHash}`;
    linkEl.textContent = "在 Etherscan 查看 →";
    linkEl.classList.remove("hidden");
  }
}

function showError(msg: string): void {
  const el = document.getElementById("swap-error");
  if (el) {
    el.textContent = msg;
    el.classList.remove("hidden");
  }
}

// ============ 钱包事件 ============

async function handleConnect(): Promise<void> {
  try {
    wallet = await connectWallet();
    onWalletReady();
  } catch (err: any) {
    showError(err.message || "连接钱包失败");
  }
}

function handleAccountChange(address: string | null): void {
  if (address && wallet) {
    wallet = { ...wallet, address };
    onWalletReady();
  } else {
    wallet = null;
  }
}

function onWalletReady(): void {
  const addrEl = document.getElementById("current-account");
  if (addrEl && wallet) {
    addrEl.textContent = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
  }
  updateSwapState({ state: SwapState.IDLE, error: null, txHash: null });
}
