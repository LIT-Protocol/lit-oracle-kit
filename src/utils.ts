import { ethers } from "ethers";
import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";
import { LIT_ABILITY } from "@lit-protocol/constants";
import {
  LitActionResource,
  LitPKPResource,
  createSiweMessage,
  generateAuthSig,
  LitResourceAbilityRequest,
} from "@lit-protocol/auth-helpers";

export async function getSessionSigs(
  litNodeClient: LitNodeClientNodeJs,
  ethersWallet: ethers.Signer
) {
  // get session sigs
  // get session sigs
  const sessionSigs = await litNodeClient.getSessionSigs({
    chain: "ethereum",
    expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10 minutes
    resourceAbilityRequests: [
      {
        resource: new LitActionResource("*"),
        ability: LIT_ABILITY.LitActionExecution,
      },
      {
        resource: new LitPKPResource("*"),
        ability: LIT_ABILITY.PKPSigning,
      },
    ],
    authNeededCallback: async ({
      uri,
      expiration,
      resourceAbilityRequests,
    }: {
      uri?: string | undefined;
      expiration?: string | undefined;
      resourceAbilityRequests?: LitResourceAbilityRequest[] | undefined;
    }) => {
      const toSign = await createSiweMessage({
        uri,
        expiration,
        resources: resourceAbilityRequests,
        walletAddress: await ethersWallet.getAddress(),
        nonce: await litNodeClient.getLatestBlockhash(),
        litNodeClient,
      });

      return await generateAuthSig({
        signer: ethersWallet,
        toSign,
      });
    },
  });
  return sessionSigs;
}
