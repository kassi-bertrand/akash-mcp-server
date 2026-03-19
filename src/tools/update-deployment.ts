import { z } from 'zod';
import {
  generateManifest,
  generateManifestVersion,
  yaml,
  type SDLInput,
} from '@akashnetwork/chain-sdk';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';
import { sendManifest } from './send-manifest.js';

const parameters = z.object({
  rawSDL: z.string().min(1),
  provider: z.string().min(1),
  dseq: z.number().min(1),
});

export const UpdateDeploymentTool: ToolDefinition<typeof parameters> = {
  name: 'update-deployment',
  description:
    'Update a deployment on Akash Network using the provided SDL string. '
    + 'Also sends the updated manifest to the provider. '
    + 'The dseq is the deployment sequence number. '
    + 'The provider is the provider of the lease.',
  parameters,
  handler: async (params, context) => {
    const { rawSDL, provider, dseq } = params;
    const { wallet, sdk, certificate } = context;

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

      // Generate the manifest version hash for the update message.
      const hash = await generateManifestVersion(
        manifest.value.groups,
      );

      // Update the deployment on chain.
      await sdk.akash.deployment.v1beta4.updateDeployment({
        id: { owner: address, dseq: BigInt(dseq) },
        hash,
      });

      // Find the active lease so we can send the manifest to the provider.
      const leases = await sdk.akash.market.v1beta5.getLeases({
        filters: {
          owner: address,
          dseq: BigInt(dseq),
          provider,
        },
      });

      if (leases.leases.length === 0) {
        return createOutput({
          error: 'No leases found for deployment',
        });
      }

      const lease = leases.leases[0].lease;
      const leaseId = {
        id: {
          owner: lease?.id?.owner ?? '',
          dseq: Number(lease?.id?.dseq ?? 0),
          gseq: lease?.id?.gseq ?? 0,
          oseq: lease?.id?.oseq ?? 0,
          provider: lease?.id?.provider ?? '',
        },
      };

      // Send the updated manifest to the provider.
      // sendManifest still uses the old SDL type — will be migrated separately.
      await sendManifest(sdlInput as any, leaseId, certificate);

      return createOutput({ success: true, dseq });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown error updating deployment';
      return createOutput({ error: message });
    }
  },
};
