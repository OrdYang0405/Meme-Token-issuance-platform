// frontend/src/notify.ts
// 第15课：Toast 通知系统 —— 多类型、可堆叠、自动消失
//
// 用法：
//   import { toast } from "./notify";
//   toast("代币创建成功！", "success");
//   toast("网络不支持，请切换", "warning", 0); // duration=0 手动关闭

// ============ 类型 ============

type ToastType = "success" | "error" | "warning" | "info";
type ToastPosition = "top-right" | "bottom-center";

interface ToastOptions {
  type: ToastType;
  message: string;
  duration?: number;       // ms，0 = 手动关闭
  position?: ToastPosition;
}

const TOAST_STYLES: Record<ToastType, { border: string; bg: string; emoji: string }> = {
  success:  { border: "#22c55e", bg: "rgba(34,197,94,0.10)",  emoji: "✓" },
  error:    { border: "#ef4444", bg: "rgba(239,68,68,0.10)",  emoji: "✕" },
  warning:  { border: "#fbbf24", bg: "rgba(251,191,36,0.10)", emoji: "⚠" },
  info:     { border: "#3b82f6", bg: "rgba(59,130,246,0.10)", emoji: "ℹ" },
};

// ============ 容器管理 ============

let containerEl: HTMLDivElement | null = null;

function ensureContainer(position: ToastPosition): HTMLDivElement {
  if (!containerEl) {
    containerEl = document.createElement("div");
    containerEl.className = "toast-container";
    containerEl.style.cssText = `
      position: fixed;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(containerEl);
  }

  // 根据位置调整样式
  if (position === "top-right") {
    containerEl.style.top = "80px";
    containerEl.style.right = "20px";
    containerEl.style.bottom = "auto";
    containerEl.style.left = "auto";
    containerEl.style.transform = "none";
  } else {
    containerEl.style.top = "auto";
    containerEl.style.right = "auto";
    containerEl.style.bottom = "20px";
    containerEl.style.left = "50%";
    containerEl.style.transform = "translateX(-50%)";
  }

  // 注入动画样式（仅一次）
  if (!document.getElementById("toast-animations")) {
    const style = document.createElement("style");
    style.id = "toast-animations";
    style.textContent = `
      @keyframes toast-slide-in {
        from { transform: translateX(120%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
      @keyframes toast-slide-out {
        from { transform: translateX(0);    opacity: 1; }
        to   { transform: translateX(120%); opacity: 0; }
      }
      @keyframes toast-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  return containerEl;
}

// ============ 创建 Toast 元素 ============

let counter = 0;

function createElement(opts: ToastOptions): HTMLDivElement {
  const styles = TOAST_STYLES[opts.type];
  const el = document.createElement("div");
  el.className = `toast toast-${opts.type}`;
  el.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 18px;
    border-radius: 10px;
    background: ${styles.bg};
    border-left: 4px solid ${styles.border};
    color: #e2e8f0;
    font-size: 0.875rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    animation: toast-slide-in 0.3s ease;
    min-width: 260px;
    max-width: 400px;
    pointer-events: auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    word-break: break-word;
    position: relative;
  `;

  el.innerHTML = [
    `<span style="font-size:1.1rem;font-weight:700;flex-shrink:0;color:${styles.border}">${styles.emoji}</span>`,
    `<span style="flex:1;line-height:1.4;">${escapeHtml(opts.message)}</span>`,
    opts.duration !== 0
      ? `<button class="toast-close-btn" aria-label="关闭" style="
           flex-shrink:0;
           background:none; border:none;
           color:#64748b; cursor:pointer;
           font-size:1.2rem; padding:0; line-height:1;
         ">×</button>`
      : "",
  ].join("");

  return el;
}

// ============ 显示与关闭 ============

function show(opts: ToastOptions): void {
  const container = ensureContainer(opts.position || "top-right");
  const el = createElement(opts);

  const remove = () => {
    el.style.animation = "toast-slide-out 0.25s ease forwards";
    setTimeout(() => {
      el.remove();
      // 检查容器是否为空，清理
      if (container.children.length === 0 && containerEl) {
        containerEl.remove();
        containerEl = null;
      }
    }, 250);
  };

  // 关闭按钮
  el.querySelector(".toast-close-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    remove();
  });

  // 自动消失
  const dur = opts.duration ?? 4000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (dur > 0) {
    timer = setTimeout(remove, dur);
  }

  // 点击 toast 也可关闭
  el.addEventListener("click", () => {
    if (timer) clearTimeout(timer);
    remove();
  });

  container.appendChild(el);
}

// ============ 公开 API ============

export function toast(
  message: string,
  type: ToastType = "info",
  duration?: number
): void {
  show({ type, message, duration });
}

export const notify = {
  success: (msg: string) => toast(msg, "success"),
  error:   (msg: string) => toast(msg, "error", 8000),
  warning: (msg: string) => toast(msg, "warning", 6000),
  info:    (msg: string) => toast(msg, "info"),
};

// ============ 工具 ============

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
