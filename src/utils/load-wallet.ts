import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import {
  createChainNodeSDK,
  createStargateClient,
} from '@akashnetwork/chain-sdk';
import { SERVER_CONFIG } from '../config.js';

/** The main object for interacting with the Akash network. */
export type ChainSDK = ReturnType<typeof createChainNodeSDK>;

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

  // The SDK we use to read from and write to the Akash blockchain.
  // Queries go through the gRPC endpoint, transactions through RPC.
  const sdk = createChainNodeSDK({
    query: { baseUrl: SERVER_CONFIG.grpcEndpoint },
    tx: {
      // Signs and broadcasts transactions using our wallet.
      signer: createStargateClient({
        baseUrl: SERVER_CONFIG.rpcEndpoint,
        signer: wallet,
        defaultGasPrice: '0.025uakt',
      }),
    },
  });

  return { wallet, sdk };
}
