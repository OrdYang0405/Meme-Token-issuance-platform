# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Meme 代币发行平台的 Hardhat 项目，使用 TypeScript 编写部署脚本和测试。

## 技术栈

- **智能合约**: Solidity 0.8.20（已启用 optimizer，runs: 200）
- **开发框架**: Hardhat + `@nomicfoundation/hardhat-toolbox`
- **脚本语言**: TypeScript (ES2020, commonjs)
- **测试网络**: Sepolia（通过 Alchemy RPC）

## 常用命令

```bash
# 编译合约
npx hardhat compile

# 清理构建产物
npx hardhat clean

# 部署到本地 Hardhat 网络
npx hardhat run scripts/deploy.ts

# 部署到 Sepolia 测试网
npx hardhat run scripts/deploy.ts --network sepolia

# 启动本地节点
npx hardhat node

# 运行测试
npx hardhat test

# 运行单个测试文件
npx hardhat test test/xxx.ts

# 合约验证（需配置 ETHERSCAN_API_KEY）
npx hardhat verify --network sepolia <合约地址> <构造参数...>
```

## 项目结构

```
contracts/       Solidity 合约源码
scripts/         TypeScript 部署脚本
test/            TypeScript 测试文件
.env             环境变量（RPC URL、私钥等，不提交）
hardhat.config.ts Hardhat 配置
tsconfig.json    TypeScript 配置
```

## 环境变量

通过 `.env` 文件配置，`hardhat.config.ts` 在启动时加载：

| 变量 | 说明 |
|------|------|
| `SEPOLIA_RPC_URL` | Sepolia 网络的 Alchemy（或其他）RPC 端点 |
| `PRIVATE_KEY` | 部署账户私钥（64 位十六进制，无需 0x 前缀） |
| `ETHERSCAN_API_KEY` | Etherscan API Key，用于合约验证 |

仅当 `SEPOLIA_RPC_URL` 和 `PRIVATE_KEY` 均已配置且私钥长度为 64 字符时，Sepolia 网络配置才会生效。

## 合约架构

当前合约 `HelloMeme.sol` 是一个标准 ERC-20 Token 实现：
- 构造函数接收 name、symbol、totalSupply 三个参数
- 实现了 `transfer`、`approve`、`transferFrom` 核心方法
- decimal 固定为 18
- 部署时所有代币铸造给部署者
