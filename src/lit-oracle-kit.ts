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

/**
 * Interface for parameters passed to writeToChain and related methods
 */
interface FetchToChainParams {
  /** JavaScript code that fetches data and returns an array of arguments for the smart contract function */
  dataSource: string;
  /** Solidity function signature that will be called with the data */
  functionAbi: string;
  /** Address of the contract to call */
  toAddress: string;
  /** Chain to execute the transaction on (e.g., "yellowstone") */
  chain: string;
}

/**
 * Interface for parameters passed to readLatestDataFromChain
 */
interface ReadFromChainParams {
  /** Solidity function signature that will be called to read data */
  functionAbi: string;
  /** Address of the contract to read from */
  contractAddress: string;
  /** Chain to read from (e.g., "yellowstone") */
  chain: string;
}

/**
 * Information about a minted PKP (Programmable Key Pair)
 */
interface MintedPkpInfo {
  /** Public key of the PKP */
  publicKey: string;
  /** Ethereum address derived from the PKP */
  ethAddress: string;
  /** Token ID of the PKP NFT */
  tokenId: string;
  /** IPFS CID of the Lit Action code bound to this PKP */
  ipfsCid: string;
}

/**
 * LitOracleKit provides functionality to create and manage oracles using Lit Protocol.
 * It allows fetching off-chain data and writing it to blockchain smart contracts using
 * Programmable Key Pairs (PKPs).
 */
export class LitOracleKit {
  private litNodeClient: LitNodeClientNodeJs;
  private ethersWallet: ethers.Signer;
  private litNetwork: LIT_NETWORKS_KEYS;

  /**
   * Creates a new instance of LitOracleKit
   * @param litNetwork - The Lit Network to connect to (e.g., "datil-dev")
   * @param privateKey - Private key used for signing transactions and minting PKPs
   */
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

  /**
   * Connects to the Lit Network
   * @returns Promise that resolves when connection is established
   */
  async connect(): Promise<void> {
    await this.litNodeClient.connect();
  }

  /**
   * Checks if the client is connected to the Lit Network
   * @returns true if connected, false otherwise
   */
  ready(): boolean {
    return this.litNodeClient.ready;
  }

  /**
   * Disconnects from the Lit Network
   * @returns Promise that resolves when disconnection is complete
   */
  disconnect(): Promise<void> {
    return this.litNodeClient.disconnect();
  }

  /**
   * Generates Lit Action code and returns it along with its IPFS CID
   * @param params - Parameters for generating the Lit Action code
   * @returns Object containing the generated code and its IPFS CID
   */
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

  /**
   * Mints a new PKP and binds it to the given Lit Action IPFS CID
   * @param ipfsCid - IPFS CID of the Lit Action to bind to the PKP
   * @returns Information about the minted PKP
   */
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
    await this.fundPkp(pkpEthAddress);

    localStorage.setItem(`pkp-for-ipfsCid-${ipfsCid}`, JSON.stringify(pkpInfo));
    console.log(
      `Minted PKP with address ${pkpInfo.ethAddress} and funded with 0.001 ETH`
    );
    return pkpInfo;
  }

  /**
   * Checks the balance of a PKP and funds it if it's low
   * @param pkpEthAddress - Ethereum address of the PKP
   * @param fundIfLow - Whether to fund the PKP if it's low
   * @returns Balance of the PKP in ETH
   */
  async checkPkpBalance(
    pkpEthAddress: string,
    fundIfLow: boolean = false
  ): Promise<string> {
    let balance = await this.ethersWallet.provider!.getBalance(
      pkpEthAddress,
      "latest"
    );
    let balanceInEth = ethers.utils.formatEther(balance);
    console.log(`PKP balance: ${balanceInEth} ETH`);

    if (fundIfLow && parseFloat(balanceInEth) <= 0.00001) {
      await this.fundPkp(pkpEthAddress);

      return this.checkPkpBalance(pkpEthAddress, false);
    }

    return balanceInEth;
  }

  /**
   * Funds a PKP with 0.001 ETH if the balance is less than 0.00001 ETH
   * @param pkpEthAddress - Ethereum address of the PKP
   * @returns Transaction hash of the funding transaction
   */
  async fundPkp(pkpEthAddress: string): Promise<string> {
    console.log(`Funding PKP with 0.001 ETH`);
    const fundingTxn = await this.ethersWallet.sendTransaction({
      to: pkpEthAddress,
      value: ethers.utils.parseEther("0.001"),
    });
    await fundingTxn.wait();
    console.log(`Funded PKP: ${fundingTxn.hash}`);

    return fundingTxn.hash;
  }

  /**
   * Executes a Lit Action to fetch data and write it to a smart contract
   * @param params - Parameters specifying the data source, contract, and function to call
   * @returns Response from the Lit Action execution
   *
   * @example
   * ```typescript
   * const result = await sdk.writeToChain({
   *   dataSource: `
   *     const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
   *     const response = await fetch(url).then((res) => res.json());
   *     const nearestForecast = response.properties.periods[0];
   *     return [nearestForecast.temperature, nearestForecast.probabilityOfPrecipitation.value || 0];
   *   `,
   *   functionAbi: "function updateWeather(int256 temperature, uint8 precipitationProbability) external",
   *   toAddress: "0xYourContractAddress",
   *   chain: "yellowstone"
   * });
   * ```
   */
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
    } else {
      pkpInfo = JSON.parse(pkpFromLocalStorage);
      await this.checkPkpBalance(pkpInfo.ethAddress, true);
    }
    console.log(`Writing data to chain from PKP address ${pkpInfo.ethAddress}`);
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

  /**
   * Reads data from a smart contract on the blockchain
   * @param params - Parameters specifying the function to call and the contract to read from
   * @returns Response from the read operation
   *
   * @example
   * ```typescript
   * const weatherData = await sdk.readFromChain<WeatherData>({
   *   functionAbi: "function currentWeather() view returns (int256 temperature, uint8 precipitationProbability, uint256 lastUpdated)",
   *   contractAddress: "0xE2c2A8A1f52f8B19A46C97A6468628db80d31673",
   *   chain: "yellowstone"
   * });
   * ```
   */
  async readFromChain<T>(params: ReadFromChainParams): Promise<T> {
    if (!this.litNodeClient.ready) {
      await this.connect();
    }

    const provider = new ethers.providers.JsonRpcProvider(
      LIT_RPC.CHRONICLE_YELLOWSTONE
    );

    // Create contract interface using the provided function ABI
    const contractInterface = new ethers.utils.Interface([params.functionAbi]);

    const contract = new ethers.Contract(
      params.contractAddress,
      contractInterface,
      provider
    );

    // Get the function name from the ABI
    const functionName =
      contractInterface.functions[Object.keys(contractInterface.functions)[0]]
        .name;

    // Call the function and return the result
    const result = await contract[functionName]();
    return result as T;
  }

  /**
   * Tests a data source function without writing to chain
   * @param dataSource - JavaScript code that fetches and returns data
   * @returns Response containing the fetched data
   *
   * @example
   * ```typescript
   * const result = await sdk.testDataSource(`
   *   const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast";
   *   const response = await fetch(url).then((res) => res.json());
   *   return [response.properties.periods[0].temperature];
   * `);
   * ```
   */
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
