import { z } from 'zod';
import {
  generateManifest,
  generateManifestVersion,
  yaml,
  type SDLInput,
} from '@akashnetwork/chain-sdk';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  rawSDL: z.string().min(1),
  deposit: z.number().min(1),
  currency: z.string().min(1),
});

export const CreateDeploymentTool: ToolDefinition<typeof parameters> = {
  name: 'create-deployment',
  description:
    'Create a new deployment on Akash Network using the provided'
    + ' SDL string, deposit amount and currency.'
    + ' Minimum deposit amount is 500000 uakt.',
  parameters,
  handler: async (params, context) => {
    const { rawSDL } = params;
    const { wallet, sdk } = context;

    try {
      const accounts = await wallet.getAccounts();
      const address = accounts[0].address;

      // Parse the SDL and generate the manifest.
      const sdlInput: SDLInput = yaml.raw(rawSDL);
      const manifest = generateManifest(sdlInput);

      if (!manifest.ok) {
        return createOutput({
          error: 'SDL validation failed: '
            + JSON.stringify(manifest.value),
        });
      }

      // Manifest version hash, needed by the chain.
      const hash = await generateManifestVersion(
        manifest.value.groups,
      );

      // Use current block height as the deployment sequence number.
      const block = await sdk.cosmos.base.tendermint.v1beta1
        .getLatestBlock({});
      const dseq = Number(block.block?.header?.height ?? 0);

      await sdk.akash.deployment.v1beta4.createDeployment({
        id: { owner: address, dseq: BigInt(dseq) },
        groups: manifest.value.groupSpecs,
        hash,
        deposit: {
          amount: {
            denom: params.currency,
            amount: params.deposit.toString(),
          },
          sources: [1], // Pay from the server wallet's own balance.
        },
      });

      return createOutput({ success: true, dseq });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown error creating deployment';
      return createOutput({ error: message });
    }
  },
};
