// frontend/src/swap/priceImpact.ts
// 价格冲击计算与风险等级判定

export type ImpactLevel = "low" | "medium" | "high" | "extreme";

/**
 * 根据价格冲击百分比判定风险等级
 *
 * 阈值参考 Uniswap 前端：
 * - < 1%: 正常，绿色
 * - 1%-3%: 中等，橙色警告
 * - 3%-5%: 高，红色警告
 * - > 5%: 极端，强烈警告
 */
export function getPriceImpactLevel(impactPercent: number): ImpactLevel {
  if (impactPercent < 1) return "low";
  if (impactPercent < 3) return "medium";
  if (impactPercent < 5) return "high";
  return "extreme";
}

export const IMPACT_STYLES: Record<
  ImpactLevel,
  { color: string; label: string }
> = {
  low: { color: "#4CAF50", label: "低" },
  medium: { color: "#FF9800", label: "中等" },
  high: { color: "#F44336", label: "高" },
  extreme: { color: "#B71C1C", label: "极高" },
};

export function formatPriceImpact(impactPercent: number): string {
  if (impactPercent < 0.01) return "< 0.01%";
  return `${impactPercent.toFixed(2)}%`;
}

/** 预设滑点选项 */
export const SLIPPAGE_PRESETS = {
  AUTO: "auto",
  CUSTOM: "custom",
} as const;

export const DEFAULT_SLIPPAGE = 0.5;
export const MIN_SLIPPAGE = 0.1;
export const MAX_SLIPPAGE = 50;

/**
 * 自动滑点计算：价格冲击越高，滑点设置应越大
 */
export function getAutoSlippage(priceImpactPercent: number): number {
  if (priceImpactPercent < 1) return 0.5;
  if (priceImpactPercent < 3) return 1.0;
  if (priceImpactPercent < 5) return 2.0;
  return 5.0;
}
