// frontend/src/tx-history.ts
// 第15课：交易历史追踪 —— localStorage 持久化、按账户+链分组、自动裁剪
//
// 用法：
//   import { recordTx, loadHistory, renderHistory, TxRecord } from "./tx-history";
//   recordTx({ type: "CREATE_TOKEN", txHash: "0x...", account, chainId, summary: "..." });
//   renderHistory(account, chainId, container);

import { getEtherscanLink } from "./swap/swap";

// ============ 类型 ============

export type TxType =
  | "CREATE_TOKEN"
  | "SWAP_BUY"
  | "SWAP_SELL"
  | "TRANSFER"
  | "OWNER_ACTION";

export interface TxRecord {
  txHash: string;
  account: string;
  chainId: number;
  type: TxType;
  status: "confirmed" | "failed";
  timestamp: number;
  summary: string;
  details?: Record<string, string>;
}

const STORAGE_KEY = "meme_tx_history";
const MAX_RECORDS_PER_ACCOUNT = 50;

// ============ 读写 ============

function loadAll(): TxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TxRecord[];
  } catch {
    return [];
  }
}

function saveAll(records: TxRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function loadHistory(account: string, chainId: number): TxRecord[] {
  return loadAll()
    .filter(r => r.account === account && r.chainId === chainId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function recordTx(record: Omit<TxRecord, "status" | "timestamp">): void {
  const all = loadAll();
  all.unshift({
    ...record,
    status: "confirmed",
    timestamp: Date.now(),
  });

  // 按账户裁剪
  const pruned: TxRecord[] = [];
  const counts = new Map<string, number>();
  for (const r of all) {
    const key = `${r.account}_${r.chainId}`;
    const count = counts.get(key) || 0;
    if (count < MAX_RECORDS_PER_ACCOUNT) {
      pruned.push(r);
      counts.set(key, count + 1);
    }
  }

  saveAll(pruned);
}

// ============ 类型映射 ============

const TYPE_LABELS: Record<TxType, { label: string; color: string }> = {
  CREATE_TOKEN:  { label: "创建代币",  color: "#22c55e" },
  SWAP_BUY:      { label: "买入",     color: "#3b82f6" },
  SWAP_SELL:     { label: "卖出",     color: "#ef4444" },
  TRANSFER:      { label: "转账",     color: "#8b5cf6" },
  OWNER_ACTION:  { label: "管理操作", color: "#f59e0b" },
};

// ============ 渲染 ============

export function renderHistory(
  container: HTMLElement,
  account: string,
  chainId: number,
): void {
  const records = loadHistory(account, chainId);

  if (records.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:#64748b;">
        暂无交易记录
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  for (const r of records) {
    const typeInfo = TYPE_LABELS[r.type];
    const time = new Date(r.timestamp).toLocaleString("zh-CN", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const item = document.createElement("div");
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: #1e293b;
      border-radius: 8px;
      font-size: 0.8rem;
    `;

    item.innerHTML = `
      <span style="
        flex-shrink:0;
        padding:2px 8px;
        border-radius:4px;
        font-size:0.7rem;
        font-weight:600;
        background:${typeInfo.color}22;
        color:${typeInfo.color};
        border:1px solid ${typeInfo.color}44;
      ">${typeInfo.label}</span>

      <span style="flex:1;color:#e2e8f0;">${escapeHtml(r.summary)}</span>

      <span style="color:#64748b;font-size:0.7rem;">${time}</span>

      <a href="${getEtherscanLink(chainId, r.txHash, "tx")}"
         target="_blank" rel="noopener"
         style="color:#3b82f6;text-decoration:none;font-size:0.7rem;flex-shrink:0;">
        查看 →
      </a>
    `;

    list.appendChild(item);
  }

  container.innerHTML = "";
  container.appendChild(list);
}

// ============ 导出到当前连接的钱包上下文 ============

export function clearAllHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============ 工具 ============

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
