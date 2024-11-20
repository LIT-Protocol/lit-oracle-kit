import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
  // Deploy with the deployer address as the initial oracle
  const weatherOracle = await WeatherOracle.deploy(deployer.address);

  await weatherOracle.waitForDeployment();
  const address = await weatherOracle.getAddress();

  console.log("WeatherOracle deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
