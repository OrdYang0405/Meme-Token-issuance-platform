// test/helpers/utils.ts
// 测试工具函数 —— MerkleProof 生成、余额断言、事件验证、常量与类型

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

// ============ MerkleTree 工具 ============

export interface MerkleTreeData {
  merkleTree: MerkleTree;
  merkleRoot: string;
  getProof: (addr: string) => string[];
}

/**
 * 从地址数组构建 MerkleTree
 * @param addresses 白名单地址列表
 * @param sortPairs 是否排序叶子对（需与合约中 MerkleProof.verify 一致，通常为 true）
 */
export function buildMerkleTree(
  addresses: string[],
  sortPairs: boolean = true,
): MerkleTreeData {
  const leaves = addresses.map(addr =>
    keccak256(Buffer.from(addr.slice(2), "hex"))
  );
  const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs });
  const merkleRoot = "0x" + merkleTree.getRoot().toString("hex");

  function getProof(addr: string): string[] {
    const leaf = keccak256(Buffer.from(addr.slice(2), "hex"));
    return merkleTree.getHexProof(leaf);
  }

  return { merkleTree, merkleRoot, getProof };
}

// ============ 参数类型 ============

export interface TokenParams {
  name: string;
  symbol: string;
  totalSupply: number;
  marketingWallet: string;
  teamWallet: string;
  buyTax: number;
  sellTax: number;
}

export interface FairLaunchParams {
  tokensPerETH: bigint;
  tokensForSale: bigint;
  softCap: bigint;
  hardCap: bigint;
  maxPerWallet: bigint;
  whitelistDuration: number;
  publicDuration: number;
  liquidityETH: bigint;
}

// ============ 余额断言 ============

/**
 * 验证一笔交易导致的 ETH 余额变化（自动扣除 gas 成本）
 *
 * 用法：
 *   const ethChange = await assertETHBalanceChange(
 *     owner, tx, ethers.parseEther("1")
 *   );
 *
 * @param signer   交易的签名者（支付 gas 的账户）
 * @param tx       已确认的交易
 * @param expected 预期的 ETH 变化（正数=收到，负数=支出，不含 gas）
 * @returns 实际的 ETH 变化（不含 gas）
 */
export async function assertETHBalanceChange(
  signer: SignerWithAddress,
  tx: ethers.ContractTransactionResponse,
  expected: bigint,
): Promise<bigint> {
  const balanceBefore = await ethers.provider.getBalance(signer.address);
  const receipt = await tx.wait();
  const balanceAfter = await ethers.provider.getBalance(signer.address);

  if (!receipt) {
    throw new Error("Transaction receipt is null");
  }

  const gasCost = receipt.fee;
  const actualChange = balanceAfter - balanceBefore + gasCost;

  expect(actualChange).to.equal(expected);
  return actualChange;
}

/**
 * 获取账户当前 ETH 余额（快捷方法）
 */
export async function getETHBalance(address: string): Promise<bigint> {
  return ethers.provider.getBalance(address);
}

// ============ 事件验证 ============

/**
 * 验证交易收据中是否包含指定事件
 *
 * @param receipt   交易收据
 * @param contract  合约实例（用于 parseLog）
 * @param eventName 事件名称
 * @returns 解析后的事件参数（含 args），未找到则抛出
 */
export function findEvent(
  receipt: ethers.ContractTransactionReceipt,
  contract: ethers.Contract,
  eventName: string,
): ethers.LogDescription {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  throw new Error(`Event "${eventName}" not found in receipt logs`);
}

/**
 * 验证交易中是否触发了指定事件（简化版，不验证参数）
 */
export async function expectEvent(
  tx: ethers.ContractTransactionResponse,
  contract: ethers.Contract,
  eventName: string,
): Promise<void> {
  await expect(tx).to.emit(contract, eventName);
}

// ============ 时间工具 ============

/**
 * 获取当前 Hardhat 网络的区块时间戳
 */
export async function currentTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Cannot get latest block");
  return block.timestamp;
}

// ============ 地址工具 ============

/**
 * 缩短地址显示（0x1234...abcd）
 */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * 验证值是否为有效的以太坊地址格式
 */
export function isValidAddress(value: unknown): boolean {
  return typeof value === "string" && ethers.isAddress(value);
}
