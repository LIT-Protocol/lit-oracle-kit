import { LitOracleKit } from "@lit-protocol/lit-oracle-kit";
import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const contractAddress = process.env.WEATHER_ORACLE_ADDRESS;
  if (!contractAddress) {
    throw new Error("Please set WEATHER_ORACLE_ADDRESS in your .env file");
  }

  if (!process.env.LIT_ORACLE_KIT_PRIVATE_KEY) {
    throw new Error("Please set LIT_ORACLE_KIT_PRIVATE_KEY in your .env file");
  }

  const sdk = new LitOracleKit(
    "datil-dev",
    process.env.LIT_ORACLE_KIT_PRIVATE_KEY!
  );
  await sdk.connect();

  const result = await sdk.writeToChain({
    dataSource: `
      const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
      const response = await fetch(url).then((res) => res.json());
      const nearestForecast = response.properties.periods[0];
      const temp = nearestForecast.temperature;
      const probabilityOfPrecipitation = nearestForecast.probabilityOfPrecipitation.value || 0;
      return [ temp, probabilityOfPrecipitation ];
    `,
    functionAbi:
      "function updateWeather(int256 temperature, uint8 precipitationProbability) external",
    toAddress: contractAddress,
    chain: "yellowstone",
  });

  console.log("Weather update transaction:", result);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
