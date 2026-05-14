// frontend/src/wallet.ts
// 钱包连接 / 账户切换监听 / 网络检测模块

import { BrowserProvider } from "ethers";

// ─── 钱包状态 ───

export interface WalletState {
  address: string;
  provider: BrowserProvider;
  chainId: number;
}

// ─── MetaMask 检测 ───

export function getEthereum(): any {
  const { ethereum } = window as any;
  if (!ethereum) {
    throw new Error("请安装 MetaMask 插件 (https://metamask.io)");
  }
  return ethereum;
}

// ─── 连接钱包 ───

export async function connectWallet(): Promise<WalletState> {
  const ethereum = getEthereum();

  const accounts: string[] = await ethereum.request({
    method: "eth_requestAccounts",
  });

  if (!accounts || accounts.length === 0) {
    throw new Error("未获取到账户，请检查 MetaMask 是否已解锁");
  }

  const provider = new BrowserProvider(ethereum);

  const chainIdHex: string = await ethereum.request({ method: "eth_chainId" });
  const chainId = parseInt(chainIdHex, 16);

  return { address: accounts[0], provider, chainId };
}

// ─── 静默检查已授权账户（不弹窗）───

export async function getConnectedAccounts(): Promise<string[]> {
  const ethereum = getEthereum();
  const accounts: string[] = await ethereum.request({
    method: "eth_accounts",
  });
  return accounts;
}

// ─── 监听账户与网络变化 ───

export function watchWalletChanges(
  onAccountChange: (address: string | null) => void
): void {
  const ethereum = getEthereum();

  ethereum.on("accountsChanged", (accounts: string[]) => {
    if (!accounts || accounts.length === 0) {
      onAccountChange(null);
    } else {
      onAccountChange(accounts[0]);
    }
  });

  ethereum.on("chainChanged", () => {
    window.location.reload();
  });
}

// ─── 网络检测 ───

export function checkNetwork(
  chainId: number,
  supported: Record<number, { name: string }>
): void {
  if (!supported[chainId]) {
    const names = Object.values(supported)
      .map((c) => c.name)
      .join(" / ");
    throw new Error(`当前网络不支持，请切换到: ${names}`);
  }
}

// ─── 引导切换网络 ───

export async function switchNetwork(
  targetChainId: number,
  chainConfig: { name: string; rpcUrl: string }
): Promise<void> {
  const ethereum = getEthereum();
  const chainIdHex = "0x" + targetChainId.toString(16);

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    if (err.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: chainConfig.name,
            rpcUrls: [chainConfig.rpcUrl],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}
