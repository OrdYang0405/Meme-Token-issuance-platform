import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import * as dotenv from "dotenv";

dotenv.config();

const {
  SEPOLIA_RPC_URL,
  MAINNET_RPC_URL,
  PRIVATE_KEY,
  ETHERSCAN_API_KEY,
  COINMARKETCAP_API_KEY,
  REPORT_GAS,
} = process.env;

const networks: HardhatUserConfig["networks"] = {
  hardhat: {
    chainId: 31337,
    forking: MAINNET_RPC_URL
      ? { url: MAINNET_RPC_URL, blockNumber: 19221000 }
      : undefined,
  },
};

if (SEPOLIA_RPC_URL && PRIVATE_KEY && PRIVATE_KEY.length === 64) {
  networks.sepolia = {
    url: SEPOLIA_RPC_URL,
    accounts: [PRIVATE_KEY],
  };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks,
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  gasReporter: {
    enabled: REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: COINMARKETCAP_API_KEY || "",
    token: "ETH",
    gasPriceApi:
      "https://api.etherscan.io/api?module=proxy&action=eth_gasPrice",
    showTimeSpent: true,
    outputFile: "gas-report.txt",
    noColors: false,
  },
};

export default config;
