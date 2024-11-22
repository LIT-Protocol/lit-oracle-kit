import { LitOracleKit } from "../src/lit-oracle-kit";
import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";

describe("LitOracleKit Integration Tests", () => {
  let sdk: LitOracleKit;

  beforeAll(async () => {
    // Check if required env var is present
    if (!process.env.LIT_ORACLE_KIT_PRIVATE_KEY) {
      throw new Error(
        "LIT_ORACLE_KIT_PRIVATE_KEY environment variable is required for integration tests"
      );
    }

    sdk = new LitOracleKit(
      "datil-dev",
      process.env.LIT_ORACLE_KIT_PRIVATE_KEY!
    );
    // Connect to Lit Network before running tests
    await sdk.connect();
  });

  test("should successfully connect to Lit Network", async () => {
    expect(sdk.ready()).toBe(true);
  });

  test("should test the data source", async () => {
    const result = await sdk.testDataSource(`
          const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
          const response = await fetch(url).then((res) => res.json());
          const nearestForecast = response.properties.periods[0];
          const temp = nearestForecast.temperature;
          const probabilityOfPrecipitation = nearestForecast.probabilityOfPrecipitation.value || 0;
          return [ temp, probabilityOfPrecipitation ];
        `);

    console.log(result.response);
    const returnedData = JSON.parse(result.response as string);

    // Verify the response contains the expected data structure
    expect(returnedData).toHaveLength(2);
  }, 30000); // Increased timeout for network requests

  test("should execute a Lit Action that fetches weather data", async () => {
    const deployedWeatherOracleContractAddress =
      "0xE2c2A8A1f52f8B19A46C97A6468628db80d31673";
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
      toAddress: deployedWeatherOracleContractAddress,
      chain: "yellowstone",
    });

    console.log(result);

    const { functionArgs, txnHash } = JSON.parse(result.response as string);

    // Verify the response contains the expected data structure
    expect(functionArgs).toHaveLength(2);
    expect(txnHash).toBeDefined();

    await sdk.disconnect();
  }, 30000); // Increased timeout for network requests
});
