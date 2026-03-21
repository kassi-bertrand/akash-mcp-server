import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { createChainNodeWebSDK } from '@akashnetwork/chain-sdk/web';
import { createStargateClient } from '@akashnetwork/chain-sdk';
import { SERVER_CONFIG } from '../config.js';

/** The main object for interacting with the Akash network. */
export type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;

export async function loadWalletAndSdk(): Promise<{
  wallet: DirectSecp256k1HdWallet;
  sdk: ChainSDK;
}> {
  // Our Akash wallet — created from the mnemonic seed phrase.
  // Holds the private key used to sign transactions on the network.
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    SERVER_CONFIG.mnemonic,
    { prefix: 'akash' },
  );

  // We use the "Web" SDK variant because public Akash infrastructure
  // exposes REST (gRPC Gateway) endpoints, not raw gRPC.
  // Both SDK variants have the same API — only the transport differs.
  const sdk = createChainNodeWebSDK({
    query: { baseUrl: SERVER_CONFIG.restEndpoint },
    tx: {
      // Signs and broadcasts transactions using our wallet.
      signer: createStargateClient({
        baseUrl: SERVER_CONFIG.rpcEndpoint,
        signer: wallet,
        defaultGasPrice: '0.025uakt',
        gasMultiplier: 1.6,
      }),
    },
  });

  return { wallet, sdk };
}
