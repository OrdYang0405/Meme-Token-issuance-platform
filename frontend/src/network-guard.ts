// frontend/src/network-guard.ts
// 第15课：网络管理守卫 —— 自动检测链 ID、不支持的链警告、一键切换
//
// 用法：
//   import { initNetworkGuard } from "./network-guard";
//   initNetworkGuard();

import { SUPPORTED_CHAINS } from "./config";
import { switchNetwork } from "./wallet";
import { toast } from "./notify";

// ============ 类型 ============

interface NetworkState {
  chainId: number | null;
  chainName: string;
  isSupported: boolean;
}

// ============ 网络检测 ============

let currentState: NetworkState = {
  chainId: null,
  chainName: "未知网络",
  isSupported: false,
};

export function getNetworkState(): Readonly<NetworkState> {
  return currentState;
}

async function detect(): Promise<NetworkState> {
  const { ethereum } = window as any;
  if (!ethereum) {
    return { chainId: null, chainName: "未检测到钱包", isSupported: false };
  }

  try {
    const chainIdHex: string = await ethereum.request({ method: "eth_chainId" });
    const chainId = parseInt(chainIdHex, 16);
    const chainInfo = SUPPORTED_CHAINS[chainId];

    return {
      chainId,
      chainName: chainInfo?.name || `未知网络 (ID: ${chainId})`,
      isSupported: !!chainInfo,
    };
  } catch {
    return { chainId: null, chainName: "无法检测网络", isSupported: false };
  }
}

// ============ UI 横幅 ============

let bannerEl: HTMLDivElement | null = null;

function ensureBanner(): HTMLDivElement {
  if (!bannerEl) {
    bannerEl = document.createElement("div");
    bannerEl.id = "network-banner";
    bannerEl.className = "hidden";
    bannerEl.style.cssText = `
      padding: 10px 20px;
      text-align: center;
      font-size: 0.85rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    `;
    const header = document.querySelector("header");
    if (header?.parentNode) {
      header.parentNode.insertBefore(bannerEl, header);
    }
  }
  return bannerEl;
}

function updateBanner(state: NetworkState): void {
  const banner = ensureBanner();

  if (state.isSupported || !state.chainId) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  banner.style.background = "rgba(239,68,68,0.12)";
  banner.style.color = "#fca5a5";
  banner.style.borderBottom = "1px solid rgba(239,68,68,0.2)";

  // 找到第一个支持的测试网
  const supportedEntries = Object.entries(SUPPORTED_CHAINS);
  const testnetEntry = supportedEntries.find(
    ([id, cfg]) => cfg.name.includes("Sepolia") || cfg.name.includes("Testnet")
  ) || supportedEntries[0];

  banner.innerHTML = `
    <span>⚠️ 当前网络 <strong>${state.chainName}</strong> 不受支持</span>
    ${testnetEntry ? `
      <button id="btn-switch-network" style="
        padding:4px 12px; border-radius:4px; border:1px solid #ef4444;
        background:rgba(239,68,68,0.15); color:#fca5a5; cursor:pointer;
        font-size:0.8rem; font-weight:500;
      ">切换到 ${testnetEntry[1].name}</button>
    ` : ""}
  `;

  // 绑定切换按钮
  if (testnetEntry) {
    const targetId = parseInt(testnetEntry[0]);
    banner.querySelector("#btn-switch-network")?.addEventListener("click", () => {
      handleSwitch(targetId, testnetEntry[1]);
    });
  }
}

// ============ 网络切换 ============

async function handleSwitch(
  targetChainId: number,
  chainConfig: { name: string; rpcUrl: string },
): Promise<void> {
  try {
    await switchNetwork(targetChainId, chainConfig);
    toast(`已切换到 ${chainConfig.name}`, "success");
  } catch (err: any) {
    toast(err.message || "网络切换失败", "error");
  }
}

// ============ 链变更监听 ============

function startMonitoring(): void {
  const { ethereum } = window as any;
  if (!ethereum) return;

  ethereum.on("chainChanged", async () => {
    // 短暂延迟后检测（让钱包完成切换）
    setTimeout(async () => {
      currentState = await detect();
      updateBanner(currentState);
    }, 500);
  });
}

// ============ 初始化入口 ============

export async function initNetworkGuard(): Promise<void> {
  currentState = await detect();
  updateBanner(currentState);
  startMonitoring();
}
