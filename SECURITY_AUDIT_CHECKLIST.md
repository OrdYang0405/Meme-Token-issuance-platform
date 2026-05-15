# 安全审计检查清单

> 基于第13课《合约安全审计实践》—— 每次合约修改后逐一检查

## P0 —— 必须通过（发布前）

- [ ] **Router 锁定**: `lockRouter()` 在部署流程末尾调用，`routerLocked == true`
- [ ] **滑点保护**: `_swapTokensForEth` 中 `amountOutMin` 不再为 0（使用 `getAmountsOut` + `slippageBPS`）
- [ ] **rescueETH 互斥**: `rescueETH()` 检查 `!_inSwap`，防止 Swap 中途提取 ETH
- [ ] **CEI 模式**: 所有外部调用前的状态更新已确认
- [ ] **ReentrancyGuard**: FairLaunch 的 `claimTokens` / `claimRefund` 带有 `nonReentrant`
- [ ] **transfer 不会失败**: rescueETH / claimRefund 的 `transfer()` 目标确认为 EOA 或已知合约

## P1 —— 应当通过（审计后）

- [ ] **swapThreshold 上限**: `setSwapThreshold()` 检查 `<= maxSwapThreshold`
- [ ] **滑点可配置**: `setSlippageBPS()` 范围在 `[MIN_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS]`
- [ ] **Router 锁定不可逆**: `lockRouter()` 无解锁机制（设计如此）
- [ ] **Locker owner 风险记录**: LiquidityLocker 的 owner 越权已文档化，计划迁移到 Timelock
- [ ] **工厂创建上限**: MemeFactory 所有代币列表的增长有监控

## P2 —— 建议改进

- [ ] **Locker 查询索引**: `getLocksByToken` 使用索引映射替代全数组遍历
- [ ] **Merkle 叶子哈希**: 使用 `keccak256(abi.encode(msg.sender))` 替代 `encodePacked`
- [ ] **冷却期评估**: TAX_COOLDOWN 的 1 天是否足够（考虑增加）
- [ ] **事件完整性**: 所有状态变更函数都 emit 事件

## 自动化检查

- [ ] Slither 扫描通过（无 P0/P1 报告）
- [ ] 测试覆盖率 > 80%
- [ ] Gas 报告无异常峰值

## 审计检查流程

```
[合约修改] → [单元测试 pass] → [Slither 扫描] → [清单检查] → [人工审计] → [同行评审]
```

每次合约修改后，按此清单从头检查。P0 项必须全部通过才能部署。
