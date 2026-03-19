import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  address: z.string().min(1, 'Akash account address is required'),
  dseq: z.number().int().positive(),
  amount: z.string().min(1, 'Amount of uakt to add is required'),
});

export const AddFundsTool: ToolDefinition<typeof parameters> = {
  name: 'add-funds',
  description:
    'Deposit additional AKT (uakt) into a deployment escrow account.',
  parameters,
  handler: async (params, context) => {
    const { address, dseq, amount } = params;
    try {
      // Verify the deployment exists before depositing.
      const deploymentRes = await context.sdk.akash
        .deployment.v1beta4.getDeployment({
          id: { owner: address, dseq: BigInt(dseq) },
        });

      if (!deploymentRes.deployment) {
        return createOutput({
          error: `Deployment with owner ${address} and dseq ${dseq} not found.`,
        });
      }

      // Deposit funds into the deployment's escrow account.
      // scope=1 means "deployment", xid is "owner/dseq".
      // sources=[1] means funds come from the signer's balance.
      await context.sdk.akash.escrow.v1.accountDeposit({
        signer: address,
        id: {
          scope: 1,
          xid: `${address}/${dseq}`,
        },
        deposit: {
          amount: { denom: 'uakt', amount },
          sources: [1],
        },
      });

      return createOutput({ success: true, dseq, amount });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to add funds to deployment.';
      return createOutput({ error: message });
    }
  },
};
