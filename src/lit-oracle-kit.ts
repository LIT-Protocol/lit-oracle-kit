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
import { LocalStorage } from "node-localstorage";

declare global {
  var localStorage: Storage;
}

if (typeof localStorage === "undefined" || localStorage === null) {
  global.localStorage = new LocalStorage("./lit-session-storage");
}

interface FetchToChainParams {
  dataSource: string;
  functionAbi: string;
  toAddress: string;
  chain: string;
}

export class LitOracleKit {
  private litNodeClient: LitNodeClientNodeJs;
  private ethersWallet: ethers.Signer;
  private litNetwork: LIT_NETWORKS_KEYS;

  constructor(
    litNetwork: LIT_NETWORKS_KEYS = LIT_NETWORK.DatilDev,
    privateKey: string
  ) {
    this.litNetwork = litNetwork;
    this.litNodeClient = new LitNodeClientNodeJs({
      litNetwork: this.litNetwork,
      alertWhenUnauthorized: false,
      debug: false,
    });
    this.ethersWallet = new ethers.Wallet(
      privateKey,
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
    const { dataSource } = params;

    const litActionCode = `
      (async () => {
        // fetch the data
        const functionArgs = await (async () => {
            ${dataSource}
        })();
        // create the txn
        const iface = new ethers.utils.Interface([functionAbi]);
        const txData = iface.encodeFunctionData(iface.functions[0].name, functionArgs);
        const tx = {
            to: toAddress,
            data: txData,
            from: ethers.utils.computeAddress(pkpPublicKey)
        };
        const serializedTxn = ethers.utils.serializeTransaction(tx);
        // sign the txn
        const sig = await Lit.Actions.signAndCombineEcdsa({ toSign: serializedTxn, publicKey: pkpPublicKey.slice(2), sigName: "sig1" })
        // send the txn to chain
        const rpcUrl = Lit.Actions.getRpcUrl(chain);
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const txn = await provider.sendTransaction(tx);

        // return the txn hash
        const response = {
            functionArgs,
            txnHash: txn.hash,
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
        toAddress: params.toAddress,
        chain: params.chain,
      },
    });

    return result;
  }
}

// Export just the class
export default LitOracleKit;
