import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  dseq: z.number().min(1),
});

export const CloseDeploymentTool: ToolDefinition<typeof parameters> = {
  name: 'close-deployment',
  description:
    'Close a deployment on Akash Network. '
    + 'The dseq is the deployment sequence number.',
  parameters,
  handler: async (params, context) => {
    const { dseq } = params;
    const { wallet, sdk } = context;

    try {
      const accounts = await wallet.getAccounts();
      const address = accounts[0].address;

      await sdk.akash.deployment.v1beta4.closeDeployment({
        id: { owner: address, dseq: BigInt(dseq) },
      });

      return createOutput({ success: true, dseq });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown error closing deployment';
      return createOutput({ error: message });
    }
  },
};
