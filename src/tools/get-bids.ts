import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/index.js';

const parameters = z.object({
  dseq: z.number().int().positive(),
  owner: z.string().min(1),
});

export const GetBidsTool: ToolDefinition<typeof parameters> = {
  name: 'get-bids',
  description:
    'Get bids for a deployment with the given dseq and owner.'
    + ' Multiple calls may be needed if bids arrive over time.',
  parameters,
  handler: async (params, context) => {
    const { dseq, owner } = params;
    const { sdk } = context;

    try {
      // The SDK expects dseq as a string, even though
      // the chain stores it as a number.
      const response = await sdk.akash.market.v1beta5.getBids({
        filters: {
          owner,
          dseq: String(dseq),
          state: 'open',
        },
        pagination: { limit: 100 },
      });

      const bids = response.bids ?? [];

      if (bids.length === 0) {
        return createOutput(
          `No bids found for deployment ${dseq}.`,
        );
      }

      return createOutput(bids);
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to fetch bids';
      return createOutput({ error: message });
    }
  },
};
