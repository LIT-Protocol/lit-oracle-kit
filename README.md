# Lit Oracle Kit

This is a simple kit for using the Lit Network to write web data to a chain.

## How it works

The Lit Oracle Kit uses an PKP Wallet (Programmable Key Pair) to sign the data that is written to the chain using a Lit Action (JS code that runs on Lit Nodes). The PKP is irrevocably bound to the code that retrieves and writes the data to chain, so you know that if this PKP wrote the data, it was by running that Lit Action JS code.

When you call `writeToChain`, the kit does the following:

1. Checks if there is already a PKP Wallet for the given IPFS CID. If not, it creates a new one and stores it in local storage.
2. Sends the JS code to the Lit Nodes to be executed
3. On the Lit Nodes, the JS code uses the PKP Wallet to sign the data and broadcast it to chain.

## Installation

```bash
npm i lit-oracle-kit
```

## Usage

```ts
import { LitOracleKit } from "lit-oracle-kit";

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
  toAddress: "0xE2c2A8A1f52f8B19A46C97A6468628db80d31673",
  chain: "yellowstone",
});
```

## Examples

### Fetching weather data and writing to a chain

The examples/hardhat-weather-oracle directory contains a simple example of how to use this kit to fetch weather data from the NOAA API and write it to a chain using the Lit Oracle Kit.

The script [update-weather.ts](./examples/hardhat-weather-oracle/scripts/update-weather.ts) fetches the weather data and writes it to the chain by calling the `updateWeather` function on the deployed [WeatherOracle contract](./examples/hardhat-weather-oracle/contracts/WeatherOracle.sol).

## Writing your data source

You can test your data source retrieval code using the `testDataSource()` function. This will simply run your code on the Lit Nodes and return the result, so you can confirm that it's retrieving the correct values.

```ts
import { LitOracleKit } from "lit-oracle-kit";

const sdk = new LitOracleKit(
  "datil-dev",
  process.env.LIT_ORACLE_KIT_PRIVATE_KEY!
);
await sdk.connect();

const result = await sdk.testDataSource(`
    const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
    const response = await fetch(url).then((res) => res.json());
    const nearestForecast = response.properties.periods[0];
    const temp = nearestForecast.temperature;
    const probabilityOfPrecipitation = nearestForecast.probabilityOfPrecipitation.value || 0;
    return [ temp, probabilityOfPrecipitation ];
`);

// this will output your return value, so you can confirm it's correct
console.log(result.response);
```

## Documentation

- [API Documentation](https://lit-protocol.github.io/lit-oracle-kit/)
- [Example Project](./examples/hardhat-weather-oracle/)

## License

MIT

## Support

You can find support information, including Discord and Telegram support channels, here: https://developer.litprotocol.com/support/intro
