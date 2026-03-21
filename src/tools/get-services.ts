import { z } from 'zod';
import https from 'https';
import type { CertificatePem } from '@akashnetwork/chain-sdk';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  owner: z.string().min(1),
  dseq: z.number().min(1),
  gseq: z.number().min(1),
  oseq: z.number().min(1),
  provider: z.string().min(1),
});

export const GetServicesTool: ToolDefinition<typeof parameters> = {
  name: 'get-services',
  description:
    'Get the services and their URIs for a lease on Akash Network.'
    + ' Requires owner, dseq, gseq, oseq, and provider.',
  parameters,
  handler: async (params, context) => {
    const { sdk, certificate } = context;

    try {
      // Look up the provider's host URI from the chain.
      const providerRes = await sdk.akash
        .provider.v1beta4.getProvider({ owner: params.provider });

      if (!providerRes.provider) {
        return createOutput({
          error: `Could not find provider ${params.provider}`,
        });
      }

      // Query the provider's REST endpoint for lease status.
      const status = await queryLeaseStatus(
        params,
        providerRes.provider.hostUri,
        certificate,
      );

      return createOutput(status);
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to fetch services';
      return createOutput({ error: message });
    }
  },
};

/**
 * Queries the provider's HTTPS endpoint for lease status.
 * Uses mTLS with the certificate for authentication.
 */
async function queryLeaseStatus(
  leaseId: { dseq: number; gseq: number; oseq: number },
  providerUri: string,
  certificate: CertificatePem,
) {
  const { dseq, gseq, oseq } = leaseId;
  const uri = new URL(providerUri);

  // mTLS agent — the provider authenticates us via our certificate.
  // servername must be empty to disable SNI, which some providers require.
  const agent = new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    rejectUnauthorized: false,
    servername: '',
  });

  return await new Promise<unknown>((resolve, reject) => {
    const req = https.request(
      {
        hostname: uri.hostname,
        port: uri.port || '8443',
        path: `/lease/${dseq}/${gseq}/${oseq}/status`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        agent,
      },
      (res) => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `Could not query lease status: ${res.statusCode}`,
            ),
          );
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(JSON.parse(data)));
      },
    );

    req.on('error', reject);
    req.end();
  });
}
