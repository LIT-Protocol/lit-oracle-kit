import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";
import { ethers } from "ethers";
import {
  LIT_NETWORK,
  LIT_RPC,
  AUTH_METHOD_TYPE,
  AUTH_METHOD_SCOPE,
} from "@lit-protocol/constants";
import { LIT_NETWORKS_KEYS, ExecuteJsResponse } from "@lit-protocol/types";
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

interface MintedPkpInfo {
  publicKey: string;
  ethAddress: string;
  tokenId: string;
  ipfsCid: string;
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
        const txData = iface.encodeFunctionData(iface.functions[Object.keys(iface.functions)[0]].name, functionArgs);
        
        const fromAddress = ethers.utils.computeAddress(pkpPublicKey);

        const rpcUrl = await Lit.Actions.getRpcUrl({ chain });
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

        // Get the network's current values and check for EIP-1559 support
        const [
            feeData,
            nonce,
            chainId,
            estimatedGas,
            block
        ] = await Promise.all([
            provider.getFeeData(),
            provider.getTransactionCount(fromAddress),
            provider.getNetwork().then(network => network.chainId),
            provider.estimateGas({
                from: fromAddress,
                to: toAddress,
                data: txData,
            }),
            provider.getBlock('latest')
        ]);

        // Check if network supports EIP-1559
        const supportsEIP1559 = block.baseFeePerGas != null;

        // Prepare the unsigned transaction
        let unsignedTx;
        
        if (supportsEIP1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            // EIP-1559 transaction
            unsignedTx = {
                to: toAddress,
                nonce: nonce,
                gasLimit: estimatedGas,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                data: txData,
                chainId: chainId,
                type: 2, // EIP-1559
                value: ethers.BigNumber.from(0),
                accessList: [],
            };
            // console.log("EIP-1559 Tx:", unsignedTx);
        } else {
            // Legacy transaction
            unsignedTx = {
                to: toAddress,
                nonce: nonce,
                gasLimit: estimatedGas,
                gasPrice: feeData.gasPrice,
                data: txData,
                chainId: chainId,
                value: ethers.BigNumber.from(0),
            };
            // console.log("Legacy Tx:", unsignedTx);
        }
        const serializedTx = ethers.utils.serializeTransaction(unsignedTx);

        const hashedTxToSign = ethers.utils.arrayify(ethers.utils.keccak256(serializedTx));
        // sign the txn
        const sig = await Lit.Actions.signAndCombineEcdsa({ toSign: hashedTxToSign, publicKey: pkpPublicKey.slice(2), sigName: "sig1" })

        const jsonSignature = JSON.parse(sig);
        jsonSignature.r = "0x" + jsonSignature.r.substring(2);
        jsonSignature.s = "0x" + jsonSignature.s;
        const hexSignature = ethers.utils.joinSignature(jsonSignature);

        // craft the final txn with the signature attached
        const signedTx = ethers.utils.serializeTransaction(unsignedTx, hexSignature);
        // send the txn to chain
        const txHash = await Lit.Actions.runOnce({waitForResponse: true, name: "txSender"}, async () => {
            const txn = await provider.sendTransaction(signedTx);
            return txn.hash;
        });

        // return the txn hash
        const response = {
            functionArgs,
            txnHash: txHash,
        }
        Lit.Actions.setResponse({ response: JSON.stringify(response) });
      })();
    `;
    // get the ipfs cid
    const ipfsCid = await Hash.of(litActionCode);
    return { litActionCode, ipfsCid };
  }

  async mintAndBindPkp(ipfsCid: string): Promise<MintedPkpInfo> {
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
    const pkpPubkeyInfo = await litContracts.pubkeyRouterContract.read.pubkeys(
      ethers.BigNumber.from(pkpId)
    );
    // console.log("PKP Info:", pkpPubkeyInfo);
    const pkpPublicKey = pkpPubkeyInfo.pubkey;
    // console.log("PKP Public Key:", pkpPublicKey);

    // save the pkp info to local storage, keyed by ipfs hash
    const pkpEthAddress = ethers.utils.computeAddress(pkpPublicKey);
    const pkpInfo = {
      publicKey: pkpPublicKey,
      ethAddress: pkpEthAddress,
      tokenId: pkpId,
      ipfsCid,
    };

    // let's fund the pkp with some gas
    const fundingTxn = await this.ethersWallet.sendTransaction({
      to: pkpInfo.ethAddress,
      value: ethers.utils.parseEther("0.001"),
    });
    await fundingTxn.wait();
    console.log("Funded PKP!", fundingTxn.hash);
    return pkpInfo;
  }

  async writeToChain(params: FetchToChainParams): Promise<ExecuteJsResponse> {
    if (!this.litNodeClient.ready) {
      await this.connect();
    }

    const { litActionCode, ipfsCid } = await this.generateLitActionCode(params);

    // save the code to localstorage, so we can audit in the future
    localStorage.setItem(`lit-action-code-${ipfsCid}`, litActionCode);

    // check if we need to mint a pkp for this ipfs cid
    let pkpFromLocalStorage = localStorage.getItem(
      `pkp-for-ipfsCid-${ipfsCid}`
    );
    let pkpInfo: MintedPkpInfo;
    if (!pkpFromLocalStorage) {
      pkpInfo = await this.mintAndBindPkp(ipfsCid);
      localStorage.setItem(
        `pkp-for-ipfsCid-${ipfsCid}`,
        JSON.stringify(pkpInfo)
      );
    } else {
      pkpInfo = JSON.parse(pkpFromLocalStorage);
    }
    const pkpPublicKey = pkpInfo.publicKey;

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

  async testDataSource(dataSource: string): Promise<ExecuteJsResponse> {
    // console.log(`Running code: ${litActionCode}`);
    const sessionSigs = await getSessionSigs(
      this.litNodeClient,
      this.ethersWallet
    );

    const litActionCode = `        
      (async () => {
        // fetch the data
        const functionArgs = await (async () => {
            ${dataSource}
        })();
        Lit.Actions.setResponse({ response: JSON.stringify(functionArgs) });
      })();
       `;

    const result = await this.litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs,
    });

    return result;
  }
}

// Export just the class
export default LitOracleKit;
