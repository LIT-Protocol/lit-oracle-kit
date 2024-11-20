import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";
import { ethers } from "ethers";
import {
  LIT_NETWORK,
  LIT_RPC,
  AUTH_METHOD_TYPE,
  AUTH_METHOD_SCOPE,
} from "@lit-protocol/constants";
import { LIT_NETWORKS_KEYS } from "@lit-protocol/types";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import Hash from "ipfs-only-hash";
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
  private litNetwork: LIT_NETWORKS_KEYS;

  constructor(litNetwork: LIT_NETWORKS_KEYS = LIT_NETWORK.DatilDev) {
    this.litNetwork = litNetwork;
    this.litNodeClient = new LitNodeClientNodeJs({
      litNetwork: this.litNetwork,
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

  disconnect(): Promise<void> {
    return this.litNodeClient.disconnect();
  }

  async generateLitActionCode(params: FetchToChainParams): Promise<{
    litActionCode: string;
    ipfsCid: string;
  }> {
    const { dataSource, functionAbi } = params;

    const litActionCode = `
      (async () => {
        // fetch the data
        const data = await (async () => {
            ${dataSource}
        })();
        // create a txn (example random data for testing)
        const serializedTxn = ethers.utils.arrayify("0x65b84f5c21a9137aa915ca0a44f3eeb6d34261a238753ffcddd6eb0b4a63ea26")
        // sign the txn
        const sig = await Lit.Actions.signAndCombineEcdsa({ toSign: serializedTxn, publicKey: pkpPublicKey.slice(2), sigName: "sig1" })
        // send the txn to chain

        // return the txn hash
        const response = {
            data,
            txnHash: sig,
        }
        Lit.Actions.setResponse({ response: JSON.stringify(response) });
      })();
    `;
    // get the ipfs cid
    const ipfsCid = await Hash.of(litActionCode);
    return { litActionCode, ipfsCid };
  }

  async mintAndBindPkp(ipfsCid: string): Promise<string> {
    const litContracts = new LitContracts({
      signer: this.ethersWallet,
      network: this.litNetwork,
    });
    await litContracts.connect();

    // mint the pkp
    // get mint cost
    const mintCost = await litContracts.pkpNftContract.read.mintCost();
    // console.log("Mint cost:", mintCost);
    /*
      function mintNextAndAddAuthMethods(
        uint256 keyType,
        uint256[] memory permittedAuthMethodTypes,
        bytes[] memory permittedAuthMethodIds,
        bytes[] memory permittedAuthMethodPubkeys,
        uint256[][] memory permittedAuthMethodScopes,
        bool addPkpEthAddressAsPermittedAddress,
        bool sendPkpToItself
        */
    const txn =
      await litContracts.pkpHelperContract.write.mintNextAndAddAuthMethods(
        2,
        [AUTH_METHOD_TYPE.LitAction],
        [ethers.utils.base58.decode(ipfsCid)],
        ["0x"],
        [[AUTH_METHOD_SCOPE.SignAnything]],
        false,
        true,
        { value: mintCost, gasLimit: 4000000 }
      );
    const receipt = await txn.wait();
    // console.log("Minted!", receipt);
    // get the pkp public key from the mint event
    const pkpId = receipt.logs[0].topics[1];
    const pkpInfo = await litContracts.pubkeyRouterContract.read.pubkeys(
      ethers.BigNumber.from(pkpId)
    );
    console.log("PKP Info:", pkpInfo);
    const pkpPublicKey = pkpInfo.pubkey;
    console.log("PKP Public Key:", pkpPublicKey);
    return pkpPublicKey;
  }

  async writeToChain(params: FetchToChainParams): Promise<any> {
    if (!this.litNodeClient.ready) {
      await this.connect();
    }

    const { litActionCode, ipfsCid } = await this.generateLitActionCode(params);

    // check if we need to mint a pkp for this ipfs cid
    const pkpPublicKey = await this.mintAndBindPkp(ipfsCid);

    // console.log(`Running code: ${litActionCode}`);
    const sessionSigs = await getSessionSigs(
      this.litNodeClient,
      this.ethersWallet
    );

    const result = await this.litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs,
      jsParams: {
        pkpPublicKey,
        functionAbi: params.functionAbi,
      },
    });

    return result;
  }
}

// Export both the class and a singleton instance
export const litOracleKit = new LitOracleKit();
export default LitOracleKit;
