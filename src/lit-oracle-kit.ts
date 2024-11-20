import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";
import { ethers } from "ethers";
import {
  LIT_NETWORK,
  LIT_RPC,
  AuthMethodScope,
  AuthMethodType,
  ProviderType,
} from "@lit-protocol/constants";
import { getSessionSigs } from "./utils";
declare global {
  var localStorage: Storage;
}

if (typeof localStorage === "undefined" || localStorage === null) {
  const { LocalStorage } = require("node-localstorage");
  global.localStorage = new LocalStorage("./lit-session-storage");
}

interface FetchToChainParams {
  dataSource: string;
  functionAbi: string;
}

export class LitOracleKit {
  private litNodeClient: LitNodeClientNodeJs;
  private ethersWallet: ethers.Signer;

  constructor() {
    this.litNodeClient = new LitNodeClientNodeJs({
      litNetwork: LIT_NETWORK.DatilDev,
      alertWhenUnauthorized: false,
      debug: false,
    });
    this.ethersWallet = new ethers.Wallet(
      process.env.LIT_ORACLE_KIT_PRIVATE_KEY!,
      new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE)
    );
  }

  async connect(): Promise<void> {
    await this.litNodeClient.connect();
  }

  ready(): boolean {
    return this.litNodeClient.ready;
  }

  async generateLitActionCode(params: FetchToChainParams): Promise<string> {
    const { dataSource, functionAbi } = params;

    return `
      (async () => {
        // fetch the data
        const data = await (async () => {
            ${dataSource}
        })();
        // create a txn
        // const txn = await ${functionAbi}(data);
        // send the txn to chain
        // return the txn hash
        Lit.Actions.setResponse({ response: JSON.stringify(data) });
      })();
    `;
  }

  async writeToChain(params: FetchToChainParams): Promise<any> {
    if (!this.litNodeClient.ready) {
      await this.connect();
    }

    const litActionCode = await this.generateLitActionCode(params);
    console.log(`Running code: ${litActionCode}`);
    const sessionSigs = await getSessionSigs(
      this.litNodeClient,
      this.ethersWallet
    );

    const result = await this.litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs,
      jsParams: {},
    });

    return result;
  }
}

// Export both the class and a singleton instance
export const litOracleKit = new LitOracleKit();
export default LitOracleKit;
