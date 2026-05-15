// frontend/src/detail.ts
// 第15课：代币详情面板 —— 链上数据聚合、owner 管理操作、Promise.all 批量查询
//
// 用法：
//   import { showTokenDetail, closeDetail } from "./detail";
//   showTokenDetail(tokenAddress, provider, signer);

import { BrowserProvider, Contract, formatEther, Signer } from "ethers";
import type { WalletState } from "./wallet";
import { toast } from "./notify";
import { recordTx } from "./tx-history";

// ============ MemeToken ABI（用于详情查询 + owner 操作）============

const MEME_TOKEN_DETAIL_ABI = [
  // 元数据
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  // 税费
  "function buyTax() view returns (uint256)",
  "function sellTax() view returns (uint256)",
  "function liquidityShare() view returns (uint256)",
  "function marketingShare() view returns (uint256)",
  "function teamShare() view returns (uint256)",
  "function burnShare() view returns (uint256)",
  "function marketingWallet() view returns (address)",
  "function teamWallet() view returns (address)",
  // 状态
  "function tradingEnabled() view returns (bool)",
  "function paused() view returns (bool)",
  "function routerLocked() view returns (bool)",
  "function swapAndLiquifyEnabled() view returns (bool)",
  "function limitsEnabled() view returns (bool)",
  // Uniswap
  "function uniswapV2Router() view returns (address)",
  "function uniswapV2Pair() view returns (address)",
  // SwapAndLiquify
  "function accumulatedForLiquidity() view returns (uint256)",
  "function swapThreshold() view returns (uint256)",
  // 限制
  "function maxTransactionAmount() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)",
  // 白名单 / 排除
  "function isExcludedFromFee(address) view returns (bool)",
  "function isExcludedFromLimits(address) view returns (bool)",
  "function isWhitelisted(address) view returns (bool)",
  // Owner 操作
  "function pause()",
  "function unpause()",
  "function rescueETH()",
  "function triggerManualSwap()",
  "function enableTrading()",
];

// ============ 类型 ============

interface TokenDetail {
  address: string;
  name: string;
  symbol: string;
  totalSupply: bigint;
  decimals: number;
  owner: string;
  userBalance: bigint;
  buyTax: number;
  sellTax: number;
  liquidityShare: number;
  marketingShare: number;
  teamShare: number;
  burnShare: number;
  marketingWallet: string;
  teamWallet: string;
  tradingEnabled: boolean;
  paused: boolean;
  routerLocked: boolean;
  swapAndLiquifyEnabled: boolean;
  limitsEnabled: boolean;
  uniswapRouter: string;
  uniswapPair: string;
  accumulatedForLiquidity: bigint;
  swapThreshold: bigint;
  maxTransactionAmount: bigint;
  maxWalletAmount: bigint;
  isExcludedFromFee: boolean;
  isExcludedFromLimits: boolean;
  isWhitelisted: boolean;
}

// ============ 数据获取 ============

async function fetchDetail(
  tokenAddr: string,
  provider: BrowserProvider,
  userAddress?: string,
): Promise<TokenDetail> {
  const token = new Contract(tokenAddr, MEME_TOKEN_DETAIL_ABI, provider);

  const promises = [
    token.name(),
    token.symbol(),
    token.totalSupply(),
    token.decimals(),
    token.owner(),
    token.buyTax(),
    token.sellTax(),
    token.liquidityShare(),
    token.marketingShare(),
    token.teamShare(),
    token.burnShare(),
    token.marketingWallet(),
    token.teamWallet(),
    token.tradingEnabled(),
    token.paused(),
    token.routerLocked(),
    token.swapAndLiquifyEnabled(),
    token.limitsEnabled(),
    token.uniswapV2Router(),
    token.uniswapV2Pair(),
    token.accumulatedForLiquidity(),
    token.swapThreshold(),
    token.maxTransactionAmount(),
    token.maxWalletAmount(),
  ];

  // 异步查询当前用户的状态
  const userQuery = userAddress
    ? Promise.all([
        token.balanceOf(userAddress) as Promise<bigint>,
        token.isExcludedFromFee(userAddress) as Promise<boolean>,
        token.isExcludedFromLimits(userAddress) as Promise<boolean>,
        token.isWhitelisted(userAddress) as Promise<boolean>,
      ])
    : null;

  const mainResults = await Promise.all(promises);
  const userResults = await userQuery;
  let idx = 0;

  const result: TokenDetail = {
    address: tokenAddr,
    name: mainResults[idx++],
    symbol: mainResults[idx++],
    totalSupply: mainResults[idx++],
    decimals: Number(mainResults[idx++]),
    owner: mainResults[idx++],
    userBalance: 0n,
    buyTax: Number(mainResults[idx++]),
    sellTax: Number(mainResults[idx++]),
    liquidityShare: Number(mainResults[idx++]),
    marketingShare: Number(mainResults[idx++]),
    teamShare: Number(mainResults[idx++]),
    burnShare: Number(mainResults[idx++]),
    marketingWallet: mainResults[idx++],
    teamWallet: mainResults[idx++],
    tradingEnabled: mainResults[idx++],
    paused: mainResults[idx++],
    routerLocked: mainResults[idx++],
    swapAndLiquifyEnabled: mainResults[idx++],
    limitsEnabled: mainResults[idx++],
    uniswapRouter: mainResults[idx++],
    uniswapPair: mainResults[idx++],
    accumulatedForLiquidity: mainResults[idx++],
    swapThreshold: mainResults[idx++],
    maxTransactionAmount: mainResults[idx++],
    maxWalletAmount: mainResults[idx++],
    isExcludedFromFee: false,
    isExcludedFromLimits: false,
    isWhitelisted: false,
  };

  if (userResults) {
    result.userBalance = userResults[0];
    result.isExcludedFromFee = userResults[1];
    result.isExcludedFromLimits = userResults[2];
    result.isWhitelisted = userResults[3];
  }

  return result;
}

// ============ 面板渲染 ============

let panelEl: HTMLDivElement | null = null;
let overlayEl: HTMLDivElement | null = null;

export function showTokenDetail(
  tokenAddr: string,
  provider: BrowserProvider,
  wallet: WalletState | null,
): void {
  ensurePanel();
  showLoader();

  fetchDetail(tokenAddr, provider, wallet?.address)
    .then(detail => renderPanel(detail, wallet))
    .catch(err => {
      toast(`加载代币详情失败: ${err.message}`, "error");
      closeDetail();
    });
}

export function closeDetail(): void {
  overlayEl?.remove();
  overlayEl = null;
  panelEl?.remove();
  panelEl = null;
}

// ============ 面板 DOM ============

function ensurePanel(): void {
  // 遮罩层
  overlayEl = document.createElement("div");
  overlayEl.className = "detail-overlay";
  overlayEl.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    z-index: 1000; display: flex; align-items: center; justify-content: center;
  `;
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeDetail();
  });

  // 面板
  panelEl = document.createElement("div");
  panelEl.className = "detail-panel";
  panelEl.style.cssText = `
    background: #1e293b; border-radius: 12px;
    max-width: 600px; width: 90vw; max-height: 85vh;
    overflow-y: auto; padding: 28px;
    position: relative;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  `;

  // 关闭按钮
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
    position: absolute; top: 12px; right: 16px;
    background: none; border: none; color: #64748b;
    font-size: 1.5rem; cursor: pointer;
  `;
  closeBtn.addEventListener("click", closeDetail);
  panelEl.appendChild(closeBtn);

  overlayEl.appendChild(panelEl);
  document.body.appendChild(overlayEl);
}

function showLoader(): void {
  if (!panelEl) return;
  panelEl.innerHTML = `
    <div style="text-align:center;padding:40px;color:#64748b;">
      <div style="font-size:1.2rem;margin-bottom:12px;">加载中...</div>
      <div class="skeleton" style="width:200px;height:16px;margin:8px auto;"></div>
      <div class="skeleton" style="width:160px;height:16px;margin:8px auto;"></div>
    </div>
  `;
  // 注入骨架动画
  if (!document.getElementById("skeleton-style")) {
    const style = document.createElement("style");
    style.id = "skeleton-style";
    style.textContent = `
      .skeleton {
        background: linear-gradient(90deg, #334155 25%, #475569 50%, #334155 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 4px;
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  }
}

function renderPanel(detail: TokenDetail, wallet: WalletState | null): void {
  if (!panelEl) return;

  const isOwner = wallet && wallet.address.toLowerCase() === detail.owner.toLowerCase();
  const taxDisplay = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  const shareDisplay = (bps: number) => `${(bps / 100).toFixed(1)}%`;

  panelEl.innerHTML = `
    <button style="
      position: absolute; top: 12px; right: 16px;
      background: none; border: none; color: #64748b;
      font-size: 1.5rem; cursor: pointer;
    ">×</button>

    <h2 style="margin-bottom:4px;color:#f1f5f9;">
      ${escapeHtml(detail.name)}
      <span style="color:#64748b;font-size:0.9rem;margin-left:8px;">${escapeHtml(detail.symbol)}</span>
    </h2>
    <div style="color:#64748b;font-size:0.75rem;font-family:monospace;margin-bottom:20px;word-break:break-all;">
      ${detail.address}
    </div>

    <!-- 基本信息 -->
    <section style="margin-bottom:20px;">
      <h3 style="color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">基本信息</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">总供应量</span>
          <span>${formatEther(detail.totalSupply)} ${escapeHtml(detail.symbol)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Owner</span>
          <span class="addr">${shortAddr(detail.owner)}</span>
        </div>
        ${wallet ? `
        <div class="detail-item">
          <span class="detail-label">你的余额</span>
          <span>${formatEther(detail.userBalance)} ${escapeHtml(detail.symbol)}</span>
        </div>` : ""}
      </div>
    </section>

    <!-- 税费配置 -->
    <section style="margin-bottom:20px;">
      <h3 style="color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">税费配置</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">买入税</span>
          <span style="color:#3b82f6;">${taxDisplay(detail.buyTax)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">卖出税</span>
          <span style="color:#ef4444;">${taxDisplay(detail.sellTax)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">分配比例</span>
          <span style="font-size:0.75rem;">
            LP:${shareDisplay(detail.liquidityShare)}
            营销:${shareDisplay(detail.marketingShare)}
            团队:${shareDisplay(detail.teamShare)}
            销毁:${shareDisplay(detail.burnShare)}
          </span>
        </div>
      </div>
    </section>

    <!-- 状态 -->
    <section style="margin-bottom:20px;">
      <h3 style="color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">交易状态</h3>
      <div class="detail-grid status-grid">
        ${statusBadge("交易", detail.tradingEnabled)}
        ${statusBadge("暂停", detail.paused, true)}
        ${statusBadge("Router 锁定", detail.routerLocked)}
        ${statusBadge("S&L 开关", detail.swapAndLiquifyEnabled)}
        ${statusBadge("限制", detail.limitsEnabled)}
        ${wallet ? statusBadge("白名单", detail.isWhitelisted) : ""}
        ${wallet ? statusBadge("免手续费", detail.isExcludedFromFee, false, true) : ""}
      </div>
    </section>

    <!-- SwapAndLiquify -->
    <section style="margin-bottom:20px;">
      <h3 style="color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Swap & Liquify</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">累积流动性</span>
          <span>${formatEther(detail.accumulatedForLiquidity)} ${escapeHtml(detail.symbol)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">触发阈值</span>
          <span>${formatEther(detail.swapThreshold)} ${escapeHtml(detail.symbol)}</span>
        </div>
      </div>
    </section>

    <!-- Owner 操作 -->
    ${isOwner ? renderOwnerActions(detail) : ""}

    <!-- Uniswap 链接 -->
    <section style="margin-top:16px;padding-top:16px;border-top:1px solid #334155;">
      <div style="color:#64748b;font-size:0.75rem;margin-bottom:8px;">Uniswap Pair</div>
      <div class="addr" style="margin-bottom:8px;">${detail.uniswapPair || "未设置"}</div>
      <div style="color:#64748b;font-size:0.75rem;margin-bottom:8px;">Router</div>
      <div class="addr">${detail.uniswapRouter}</div>
    </section>
  `;

  // 绑定关闭按钮
  panelEl.querySelector("button")?.addEventListener("click", closeDetail);
}

// ============ Owner 操作区域 ============

function renderOwnerActions(detail: TokenDetail): string {
  return `
    <section style="margin-bottom:20px;padding-top:16px;border-top:1px solid #334155;">
      <h3 style="color:#fbbf24;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">
        ⚡ Owner 管理操作
      </h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;" id="owner-actions">
        <button class="owner-btn" data-action="pause" ${detail.paused ? "disabled" : ""}>
          ⏸ 暂停交易
        </button>
        <button class="owner-btn" data-action="unpause" ${!detail.paused ? "disabled" : ""}>
          ▶ 恢复交易
        </button>
        <button class="owner-btn" data-action="triggerManualSwap">
          🔄 触发 S&L
        </button>
        <button class="owner-btn owner-btn-danger" data-action="rescueETH">
          💰 提取 ETH
        </button>
        ${!detail.tradingEnabled ? `
        <button class="owner-btn" data-action="enableTrading">
          🚀 启用交易
        </button>` : ""}
      </div>
    </section>
  `;
}

// ============ Owner 操作执行 ============

export async function executeDetailAction(
  tokenAddr: string,
  action: string,
  signer: Signer,
  wallet: WalletState,
): Promise<void> {
  const token = new Contract(tokenAddr, MEME_TOKEN_DETAIL_ABI, signer);

  try {
    let tx: any;
    switch (action) {
      case "pause":             tx = await token.pause(); break;
      case "unpause":           tx = await token.unpause(); break;
      case "triggerManualSwap": tx = await token.triggerManualSwap(); break;
      case "rescueETH":         tx = await token.rescueETH(); break;
      case "enableTrading":     tx = await token.enableTrading(); break;
      default: throw new Error(`未知操作: ${action}`);
    }
    await tx.wait();

    const label = actionMap[action] || action;
    toast(`${label} 执行成功`, "success");
    recordTx({
      txHash: tx.hash,
      account: wallet.address,
      chainId: wallet.chainId,
      type: "OWNER_ACTION",
      summary: `${label}: ${tokenAddr.slice(0, 6)}...${tokenAddr.slice(-4)}`,
    });

    // 延迟后刷新面板
    setTimeout(() => {
      const provider = new BrowserProvider((window as any).ethereum);
      showTokenDetail(tokenAddr, provider, wallet);
    }, 1000);
  } catch (err: any) {
    if (err.code === "ACTION_REJECTED" || err.code === 4001) return;
    toast(err.reason || err.shortMessage || "操作失败", "error");
  }
}

const actionMap: Record<string, string> = {
  pause: "暂停交易",
  unpause: "恢复交易",
  triggerManualSwap: "触发 Swap & Liquify",
  rescueETH: "提取 ETH",
  enableTrading: "启用交易",
};

// ============ 工具 ============

function statusBadge(
  label: string,
  value: boolean,
  reverse: boolean = false,
  warnOnTrue: boolean = false,
): string {
  const ok = reverse ? !value : value;
  const color = ok ? (warnOnTrue ? "#fbbf24" : "#22c55e") : "#ef4444";
  const text = ok ? (reverse ? "正常" : "✓") : (reverse ? "已暂停" : "✕");
  return `
    <div class="detail-item">
      <span class="detail-label">${label}</span>
      <span style="color:${color};font-weight:500;">${text}</span>
    </div>`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
