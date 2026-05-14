// frontend/src/swap/swapState.ts
// Swap 交易状态机

export enum SwapState {
  IDLE = "IDLE",
  QUOTING = "QUOTING",
  QUOTE_READY = "QUOTE_READY",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
  AWAITING_SWAP = "AWAITING_SWAP",
  SWAP_PENDING = "SWAP_PENDING",
  SWAP_CONFIRMED = "SWAP_CONFIRMED",
  FAILED = "FAILED",
}

export interface SwapStateMachine {
  state: SwapState;
  error: string | null;
  txHash: string | null;
}

const BUTTON_TEXT: Record<SwapState, string> = {
  [SwapState.IDLE]: "输入金额",
  [SwapState.QUOTING]: "获取报价中...",
  [SwapState.QUOTE_READY]: "Swap",
  [SwapState.AWAITING_APPROVAL]: "请在 MetaMask 中确认授权...",
  [SwapState.AWAITING_SWAP]: "请在 MetaMask 中确认交易...",
  [SwapState.SWAP_PENDING]: "交易确认中...",
  [SwapState.SWAP_CONFIRMED]: "交易完成",
  [SwapState.FAILED]: "重试",
};

export function getButtonText(state: SwapState): string {
  return BUTTON_TEXT[state] || "Swap";
}

export function isButtonDisabled(state: SwapState): boolean {
  return (
    state === SwapState.IDLE ||
    state === SwapState.QUOTING ||
    state === SwapState.AWAITING_APPROVAL ||
    state === SwapState.AWAITING_SWAP ||
    state === SwapState.SWAP_PENDING
  );
}

export const ProposalStateDesc: Record<number, string> = {
  0: "Pending",
  1: "Active",
  2: "Canceled",
  3: "Defeated",
  4: "Succeeded",
  5: "Queued",
  6: "Expired",
  7: "Executed",
};
