// frontend/src/ui.ts
// DOM 操作：表单校验、列表渲染、状态反馈

import { formatEther } from "ethers";
import type { MemeFactory } from "./config";
import {
  getTokensPaginated,
  getTokenParams,
  createToken,
  getFactoryWithSigner,
  safeExecuteTx,
  type CreateTokenParams,
} from "./factory";
import type { WalletState } from "./wallet";

// ════════════════════════════════════════════════════════════════
// 表单校验
// ════════════════════════════════════════════════════════════════

interface ValidationRule {
  fieldId: string;
  errorFor: string;
  validate: (value: string) => string | null;
}

const VALIDATION_RULES: ValidationRule[] = [
  // contracts/MemeFactory.sol:61-62 name length
  {
    fieldId: "name",
    errorFor: "name",
    validate: (v) => {
      if (!v.trim()) return "名称不能为空";
      if (v.trim().length > 32) return "名称不能超过 32 个字符";
      return null;
    },
  },
  // contracts/MemeFactory.sol:64-65 symbol length
  {
    fieldId: "symbol",
    errorFor: "symbol",
    validate: (v) => {
      if (!v.trim()) return "符号不能为空";
      if (!/^[A-Z]{3,8}$/.test(v)) return "符号必须为 3-8 个大写字母";
      return null;
    },
  },
  // contracts/MemeFactory.sol:67-69 supply range
  {
    fieldId: "supply",
    errorFor: "supply",
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || !Number.isInteger(n)) return "请输入整数";
      if (n < 1000) return "供应量不能小于 1,000";
      if (n > 1_000_000_000_000) return "供应量不能大于 1,000,000,000,000";
      return null;
    },
  },
  // contracts/MemeFactory.sol:71 marketing non-zero
  {
    fieldId: "marketing",
    errorFor: "marketing",
    validate: (v) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return "请输入有效的以太坊地址";
      if (v === "0x0000000000000000000000000000000000000000")
        return "不能为零地址";
      return null;
    },
  },
  // contracts/MemeFactory.sol:72 team non-zero
  {
    fieldId: "team",
    errorFor: "team",
    validate: (v) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return "请输入有效的以太坊地址";
      if (v === "0x0000000000000000000000000000000000000000")
        return "不能为零地址";
      return null;
    },
  },
  // contracts/MemeFactory.sol:73 buyTax <= 2500
  {
    fieldId: "buy-tax",
    errorFor: "buyTax",
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || !Number.isInteger(n)) return "请输入整数";
      if (n < 0 || n > 2500) return "税率范围为 0 ~ 2500 基点";
      return null;
    },
  },
  // contracts/MemeFactory.sol:73 sellTax <= 2500
  {
    fieldId: "sell-tax",
    errorFor: "sellTax",
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || !Number.isInteger(n)) return "请输入整数";
      if (n < 0 || n > 2500) return "税率范围为 0 ~ 2500 基点";
      return null;
    },
  },
];

export function validateForm(): Map<string, string> {
  const errors = new Map<string, string>();
  for (const rule of VALIDATION_RULES) {
    const input = document.getElementById(
      `input-${rule.fieldId}`
    ) as HTMLInputElement;
    if (!input) continue;
    const error = rule.validate(input.value);
    if (error) errors.set(rule.errorFor, error);
  }
  return errors;
}

export function setupRealTimeValidation(): void {
  for (const rule of VALIDATION_RULES) {
    const input = document.getElementById(
      `input-${rule.fieldId}`
    ) as HTMLInputElement;
    if (!input) continue;

    input.addEventListener("blur", () => {
      const error = rule.validate(input.value);
      showFieldError(rule.errorFor, error);
    });

    input.addEventListener("input", () => {
      clearFieldError(rule.errorFor);
    });
  }
}

function showFieldError(fieldId: string, error: string | null): void {
  const errorEl = document.querySelector(`.error-msg[data-for="${fieldId}"]`);
  const inputEl = document.getElementById(`input-${fieldId}`);
  if (errorEl) errorEl.textContent = error || "";
  if (inputEl) {
    inputEl.classList.toggle("invalid", !!error);
    inputEl.classList.toggle("valid", !error);
  }
}

function clearFieldError(fieldId: string): void {
  showFieldError(fieldId, null);
}

// ════════════════════════════════════════════════════════════════
// 表单提交
// ════════════════════════════════════════════════════════════════

let wallet: WalletState | null = null;
let creationFee: bigint = 0n;

export function setWallet(w: WalletState | null): void {
  wallet = w;
}

export function setCreationFee(fee: bigint): void {
  creationFee = fee;
}

export function setupCreateForm(factory: MemeFactory): void {
  const form = document.getElementById("create-token-form") as HTMLFormElement;
  if (!form) return;

  form.addEventListener("submit", async (event: Event) => {
    event.preventDefault();

    const errors = validateForm();
    if (errors.size > 0) {
      const firstErr = errors.keys().next().value;
      const input = document.getElementById(`input-${firstErr}`);
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus();
      return;
    }

    if (!wallet) {
      showStatus("请先连接钱包", "error");
      return;
    }

    const params: CreateTokenParams = {
      name: getInputVal("name"),
      symbol: getInputVal("symbol"),
      totalSupply: BigInt(getInputVal("supply")),
      marketingWallet: getInputVal("marketing"),
      teamWallet: getInputVal("team"),
      buyTax: BigInt(getInputVal("buy-tax")),
      sellTax: BigInt(getInputVal("sell-tax")),
    };

    const factoryWithSigner = await getFactoryWithSigner(wallet.provider);
    setBtnLoading(true, "请在 MetaMask 中确认交易...");

    const result = await safeExecuteTx(
      () => createToken(factoryWithSigner, params, creationFee),
      (err) => showStatus(err.message, "error")
    );

    if (result) {
      showStatus(
        `代币创建成功！地址: ${result.tokenAddress}`,
        "success"
      );
      resetBtn();
      await loadTokenList(factory, 0);
    } else {
      resetBtn();
    }
  });
}

function getInputVal(id: string): string {
  return (
    (document.getElementById(`input-${id}`) as HTMLInputElement)?.value.trim() ||
    ""
  );
}

// ════════════════════════════════════════════════════════════════
// 代币列表
// ════════════════════════════════════════════════════════════════

const PAGE_SIZE = 10;
let currentPage = 0;
let totalTokens = 0;

export async function loadTokenList(
  factory: MemeFactory,
  page: number
): Promise<void> {
  const offset = page * PAGE_SIZE;
  const { tokens, total } = await getTokensPaginated(factory, offset, PAGE_SIZE);
  totalTokens = total;
  currentPage = page;

  await renderTokenTable(factory, tokens);

  const totalPages = Math.max(1, Math.ceil(totalTokens / PAGE_SIZE));
  renderPagination(factory, page, totalPages);

  const info = document.getElementById("list-info");
  if (info) {
    info.textContent = `共 ${totalTokens} 个代币，第 ${page + 1}/${totalPages} 页`;
  }
}

async function renderTokenTable(
  factory: MemeFactory,
  tokens: string[]
): Promise<void> {
  const tbody = document.querySelector("#token-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (tokens.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty">暂无代币，成为第一个创建者！</td></tr>';
    return;
  }

  const paramPromises = tokens.map((addr) => getTokenParams(factory, addr));
  const allParams = await Promise.all(paramPromises);

  for (let i = 0; i < tokens.length; i++) {
    const addr = tokens[i];
    const params = allParams[i];

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <span class="token-name">${escapeHtml(params.name)}</span>
        <span class="token-symbol">(${escapeHtml(params.symbol)})</span>
      </td>
      <td>${formatEther(params.totalSupply)}</td>
      <td>
        <span class="tax-badge">买 ${(Number(params.buyTax) / 100).toFixed(2)}%</span>
        <span class="tax-badge">卖 ${(Number(params.sellTax) / 100).toFixed(2)}%</span>
      </td>
      <td><span class="addr" title="${addr}">${shortAddr(addr)}</span></td>
    `;
    tbody.appendChild(row);
  }
}

function renderPagination(
  factory: MemeFactory,
  current: number,
  totalPages: number
): void {
  const nav = document.getElementById("pagination");
  if (!nav) return;
  nav.innerHTML = "";

  if (totalPages <= 1) return;

  nav.appendChild(
    createPageBtn("← 上一页", current > 0, () => loadTokenList(factory, current - 1))
  );

  const visible = getVisiblePages(current, totalPages);
  for (const p of visible) {
    if (p === -1) {
      const span = document.createElement("span");
      span.textContent = "...";
      span.className = "page-ellipsis";
      nav.appendChild(span);
    } else {
      nav.appendChild(
        createPageBtn(String(p + 1), p !== current, () =>
          loadTokenList(factory, p)
        , p === current)
      );
    }
  }

  nav.appendChild(
    createPageBtn("下一页 →", current < totalPages - 1, () =>
      loadTokenList(factory, current + 1)
    )
  );
}

function getVisiblePages(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: number[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) pages.push(-1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 2) pages.push(-1);
  pages.push(total - 1);
  return pages;
}

function createPageBtn(
  label: string,
  enabled: boolean,
  onClick: () => void,
  isActive: boolean = false
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.disabled = !enabled;
  btn.className = "page-btn";
  if (isActive) btn.classList.add("active");
  if (enabled) btn.addEventListener("click", onClick);
  return btn;
}

// ════════════════════════════════════════════════════════════════
// UI 工具函数
// ════════════════════════════════════════════════════════════════

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setBtnLoading(loading: boolean, text: string): void {
  const btn = document.getElementById("btn-create") as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = text;
  btn.classList.toggle("loading", loading);
}

function resetBtn(): void {
  setBtnLoading(false, "创建代币");
}

export function showStatus(
  message: string,
  type: "success" | "error" | "info"
): void {
  const el = document.getElementById("tx-status");
  if (!el) return;
  el.textContent = message;
  el.className = `status-${type}`;
  el.classList.remove("hidden");
  if (type === "success" || type === "error") {
    setTimeout(() => el.classList.add("hidden"), 8000);
  }
}

export function updateAccountDisplay(address: string | null): void {
  const el = document.getElementById("current-account");
  if (!el) return;
  if (address) {
    el.textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
  } else {
    el.textContent = "未连接";
  }
}

export function updateCreationFeeDisplay(feeEth: string): void {
  const el = document.getElementById("creation-fee-display");
  if (el) el.textContent = `${feeEth} ETH`;
}

export function setCreateButtonEnabled(enabled: boolean): void {
  const btn = document.getElementById("btn-create") as HTMLButtonElement;
  if (btn) {
    btn.disabled = !enabled;
    if (!enabled) btn.textContent = "请先连接钱包";
  }
}

export function toggleConnectButton(connected: boolean): void {
  const btn = document.getElementById("btn-connect") as HTMLButtonElement;
  if (btn) {
    btn.classList.toggle("hidden", connected);
  }
}
