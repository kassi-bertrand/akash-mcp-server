import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  owner: z.string().min(1),
  dseq: z.number().min(1),
  gseq: z.number().min(1),
  oseq: z.number().min(1),
  provider: z.string().min(1),
});

export const CreateLeaseTool: ToolDefinition<typeof parameters> = {
  name: 'create-lease',
  description:
    'Create a lease on Akash Network by accepting a bid.'
    + ' Requires owner, dseq, gseq, oseq and provider.',
  parameters,
  handler: async (params, context) => {
    const { sdk } = context;

    try {
      await sdk.akash.market.v1beta5.createLease({
        bidId: {
          owner: params.owner,
          dseq: BigInt(params.dseq),
          gseq: params.gseq,
          oseq: params.oseq,
          provider: params.provider,
          bseq: 0,
        },
      });

      return createOutput({ success: true, ...params });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown error creating lease';
      return createOutput({ error: message });
    }
  },
};
