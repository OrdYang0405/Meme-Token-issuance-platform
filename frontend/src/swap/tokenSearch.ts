// frontend/src/swap/tokenSearch.ts
// 代币列表搜索与元数据缓存

import { BrowserProvider, Contract } from "ethers";

// ============ 类型定义 ============

export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

// ETH 哨兵地址
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const NATIVE_ETH: TokenMetadata = {
  address: ETH_SENTINEL,
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
};

export function isNativeETH(token: TokenMetadata): boolean {
  return token.address === ETH_SENTINEL;
}

// ============ ERC20 元数据 ABI ============

const ERC20_METADATA_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// ============ 缓存 ============

const metadataCache = new Map<string, TokenMetadata>();

export function clearMetadataCache(): void {
  metadataCache.clear();
}

// ============ 批量获取元数据 ============

export async function fetchTokenMetadataBatch(
  provider: BrowserProvider,
  addresses: string[]
): Promise<Map<string, TokenMetadata>> {
  const uncached = addresses.filter(
    (a) => !metadataCache.has(a.toLowerCase())
  );
  const result = new Map<string, TokenMetadata>();

  for (const addr of addresses) {
    const cached = metadataCache.get(addr.toLowerCase());
    if (cached) result.set(addr, cached);
  }

  if (uncached.length === 0) return result;

  const metadata: TokenMetadata[] = await Promise.all(
    uncached.map(async (addr) => {
      try {
        const token = new Contract(addr, ERC20_METADATA_ABI, provider);
        const [name, symbol, decimals] = await Promise.all([
          token.name(),
          token.symbol(),
          token.decimals(),
        ]);
        const meta: TokenMetadata = {
          address: addr,
          name,
          symbol,
          decimals: Number(decimals),
        };
        metadataCache.set(addr.toLowerCase(), meta);
        return meta;
      } catch {
        return {
          address: addr,
          name: "Unknown Token",
          symbol: "???",
          decimals: 18,
        };
      }
    })
  );

  for (const meta of metadata) {
    result.set(meta.address, meta);
  }
  return result;
}

// ============ 搜索过滤 ============

export function filterTokens(
  tokens: TokenMetadata[],
  query: string
): TokenMetadata[] {
  const q = query.toLowerCase().trim();
  if (!q) return tokens;

  return tokens.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.symbol.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
  );
}

// ============ 地址缩短显示 ============

export function shortAddr(addr: string): string {
  if (addr === ETH_SENTINEL) return "ETH";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ============ XSS 防护 ============

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
