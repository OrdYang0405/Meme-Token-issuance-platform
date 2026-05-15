// frontend/src/main.ts
// 应用入口：初始化钱包、绑定事件、加载列表、集成新模块

import {
  connectWallet,
  watchWalletChanges,
  checkNetwork,
  getConnectedAccounts,
} from "./wallet";
import type { WalletState } from "./wallet";
import { SUPPORTED_CHAINS, MemeFactory__factory, FACTORY_ADDRESS } from "./config";
import { getFactoryReadOnly, getCreationFee } from "./factory";
import {
  setupCreateForm,
  setupRealTimeValidation,
  loadTokenList,
  showStatus,
  updateAccountDisplay,
  updateCreationFeeDisplay,
  setCreateButtonEnabled,
  toggleConnectButton,
  setWallet,
  setCreationFee,
} from "./ui";
import { initNetworkGuard } from "./network-guard";
import { notify } from "./notify";
import { BrowserProvider, Contract } from "ethers";
import type { MemeFactory } from "./config";

let factoryRO: MemeFactory | null = null;
let currentWallet: WalletState | null = null;

async function init(): Promise<void> {
  setupRealTimeValidation();

  const { ethereum } = window as any;
  if (!ethereum) {
    showStatus("请安装 MetaMask 插件 (https://metamask.io)", "error");
    return;
  }

  // 初始化网络守卫
  await initNetworkGuard();

  const provider = new BrowserProvider(ethereum);
  factoryRO = getFactoryReadOnly(provider);

  if (factoryRO) {
    const { fee, feeEth } = await getCreationFee(factoryRO);
    setCreationFee(fee);
    updateCreationFeeDisplay(feeEth);
    await loadTokenList(factoryRO, 0);
  }

  const accounts = await getConnectedAccounts();
  if (accounts.length > 0) {
    try {
      const walletState = await connectWallet();
      checkNetwork(walletState.chainId, SUPPORTED_CHAINS);
      onConnected(walletState);
    } catch {
      // 静默失败，用户可手动连接
    }
  }

  const connectBtn = document.getElementById("btn-connect");
  if (connectBtn) {
    connectBtn.addEventListener("click", handleConnect);
  }

  watchWalletChanges((address) => {
    if (address) {
      updateAccountDisplay(address);
      if (currentWallet) {
        currentWallet = { ...currentWallet, address };
      }
    } else {
      setWallet(null);
      currentWallet = null;
      updateAccountDisplay(null);
      setCreateButtonEnabled(false);
      toggleConnectButton(false);
    }
  });
}

async function handleConnect(): Promise<void> {
  try {
    const walletState = await connectWallet();
    checkNetwork(walletState.chainId, SUPPORTED_CHAINS);
    onConnected(walletState);
    notify.success("钱包已连接");
  } catch (err: any) {
    const msg = err.message || "连接失败";
    showStatus(msg, "error");
    notify.error(msg);
  }
}

function onConnected(walletState: WalletState): void {
  setWallet(walletState);
  currentWallet = walletState;
  updateAccountDisplay(walletState.address);
  setCreateButtonEnabled(true);
  toggleConnectButton(true);

  if (factoryRO) {
    setupCreateForm(factoryRO);
  }
}

document.addEventListener("DOMContentLoaded", init);
