// scripts/helpers/state.ts
// 第14课：部署状态管理 —— 持久化部署地址到 deployments/<network>.json
//
// 设计原则：
//   - 可重入：重新运行脚本时检查已有部署，跳过已部署的合约
//   - 可追溯：每次部署记录 txHash + 时间戳
//   - 网络隔离：不同网络的部署记录存储在不同文件中

import * as fs from "fs";
import * as path from "path";

// ============ 类型定义 ============

export interface DeploymentRecord {
  contract: string;
  address: string;
  txHash: string;
  deployer: string;
  timestamp: string;
  constructorArgs?: any[];
}

export interface DeploymentFile {
  network: string;
  chainId: number;
  lastUpdated: string;
  deployments: DeploymentRecord[];
}

// ============ 路径 ============

function deploymentsDir(): string {
  return path.join(__dirname, "..", "..", "deployments");
}

function filePath(network: string): string {
  return path.join(deploymentsDir(), `${network}.json`);
}

// ============ 读取 ============

function loadDeployment(network: string): DeploymentFile | null {
  const fp = filePath(network);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as DeploymentFile;
  } catch {
    console.warn(`部署状态文件损坏: ${fp}，将重新部署`);
    return null;
  }
}

function getContractAddress(network: string, contractName: string): string | null {
  const file = loadDeployment(network);
  if (!file) return null;
  const record = file.deployments.find(d => d.contract === contractName);
  return record?.address || null;
}

// ============ 写入 ============

function saveDeployment(
  network: string,
  chainId: number,
  record: DeploymentRecord,
): void {
  const dir = deploymentsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fp = filePath(network);
  let file: DeploymentFile = loadDeployment(network) || {
    network,
    chainId,
    lastUpdated: new Date().toISOString(),
    deployments: [],
  };

  // 去重：同一合约名称只保留最新记录
  const idx = file.deployments.findIndex(d => d.contract === record.contract);
  if (idx >= 0) {
    file.deployments[idx] = record;
  } else {
    file.deployments.push(record);
  }

  file.lastUpdated = new Date().toISOString();
  file.chainId = chainId;
  fs.writeFileSync(fp, JSON.stringify(file, null, 2), "utf8");
}

// ============ 摘要 ============

function printSummary(file: DeploymentFile): void {
  console.log(`\n部署摘要 — ${file.network} (chainId: ${file.chainId})`);
  console.log(`最后更新: ${file.lastUpdated}`);
  console.log("─".repeat(60));
  for (const d of file.deployments) {
    console.log(`  ${d.contract}`);
    console.log(`    地址:   ${d.address}`);
    console.log(`    时间:   ${d.timestamp}`);
    console.log(`    TxHash: ${d.txHash}`);
  }
  console.log("─".repeat(60));
}

// ============ 导出 ============

export {
  loadDeployment,
  getContractAddress,
  saveDeployment,
  printSummary,
  deploymentsDir,
  filePath,
};
