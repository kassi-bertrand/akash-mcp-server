import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  owner: z.string().min(1),
  dseq: z.number().min(1),
});

export const GetDeploymentTool: ToolDefinition<typeof parameters> = {
  name: 'get-deployment',
  description:
    'Get deployment details from Akash Network including status,'
    + ' groups, and escrow account.'
    + ' Requires the owner address and dseq.',
  parameters,
  handler: async (params, context) => {
    const { owner, dseq } = params;
    const { sdk } = context;

    try {
      // The SDK expects dseq as a string, even though
      // the chain stores it as a number.
      const result =
        await sdk.akash.deployment.v1beta4.getDeployment({
          id: { owner, dseq: String(dseq) },
        });

      if (!result.deployment) {
        return createOutput({
          error: `Deployment ${dseq} not found`
            + ` for owner ${owner}`,
        });
      }

      return createOutput({
        deployment: result.deployment,
        groups: result.groups,
        escrowAccount: result.escrowAccount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to fetch deployment';
      return createOutput({ error: message });
    }
  },
};
