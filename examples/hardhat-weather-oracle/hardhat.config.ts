import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
require("dotenv").config();

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    yellowstone: {
      url: "https://yellowstone-rpc.litprotocol.com",
      accounts: process.env.LIT_ORACLE_KIT_PRIVATE_KEY
        ? [process.env.LIT_ORACLE_KIT_PRIVATE_KEY]
        : [],
    },
  },
};

module.exports = config;
