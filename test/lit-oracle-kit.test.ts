import { litOracleKit, LitOracleKit } from "../src/lit-oracle-kit";
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

    sdk = new LitOracleKit();
    // Connect to Lit Network before running tests
    await sdk.connect();
  });

  test("should successfully connect to Lit Network", async () => {
    expect(sdk.ready()).toBe(true);
  });

  test("should execute a Lit Action that fetches weather data", async () => {
    const result = await sdk.writeToChain({
      dataSource: `
        const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
        const response = await fetch(url).then((res) => res.json());
        const nearestForecast = response.properties.periods[0];
        const temp = nearestForecast.temperature;
        const probabilityOfPrecipitation = nearestForecast.probabilityOfPrecipitation.value;
        return { temp, probabilityOfPrecipitation };
      `,
      functionAbi: `
        // will be defined later when we add chain interaction
      `,
    });

    console.log(result);

    const { data, txnHash } = JSON.parse(result.response);

    // Verify the response contains the expected data structure
    expect(data).toHaveProperty("temp");
    expect(data).toHaveProperty("probabilityOfPrecipitation");
    expect(txnHash).toBeDefined();
    await sdk.disconnect();
  }, 30000); // Increased timeout for network requests
});
