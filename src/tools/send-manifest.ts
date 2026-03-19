import { z } from 'zod';
import https from 'https';
import {
  generateManifest,
  manifestToSortedJSON,
  yaml,
  type SDLInput,
  type CertificatePem,
} from '@akashnetwork/chain-sdk';
import type {
  ToolDefinition,
  ToolContext,
  CustomLease,
  CustomLeaseID,
} from '../types/index.js';
import { createOutput } from '../utils/create-output.js';

const parameters = z.object({
  sdl: z.string().min(1),
  owner: z.string().min(1),
  dseq: z.number().min(1),
  gseq: z.number().min(1),
  oseq: z.number().min(1),
  provider: z.string().min(1),
});

export const SendManifestTool: ToolDefinition<typeof parameters> = {
  name: 'send-manifest',
  description:
    'Send a manifest to a provider using the provided SDL,'
    + ' owner, dseq, gseq, oseq and provider.',
  parameters,
  handler: async (params, context) => {
    const { certificate } = context;

    // Parse the raw SDL string into a structured object.
    const sdlInput: SDLInput = yaml.raw(params.sdl);

    const lease: CustomLeaseID = {
      owner: params.owner,
      dseq: params.dseq,
      gseq: params.gseq,
      oseq: params.oseq,
      provider: params.provider,
    };

    try {
      await sendManifest(
        sdlInput,
        { id: lease },
        certificate,
        context,
      );
      return createOutput('Manifest sent successfully');
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : String(error);
      return createOutput(`Error sending manifest: ${message}`);
    }
  },
};

/**
 * Sends the deployment manifest to the provider via HTTPS.
 * Uses mTLS with the certificate for authentication.
 */
export async function sendManifest(
  sdlInput: SDLInput,
  lease: CustomLease,
  certificate: CertificatePem,
  context: ToolContext,
) {
  if (!lease.id) {
    throw new Error('Lease ID is undefined');
  }

  const { dseq, provider } = lease.id;

  // Look up the provider's host URI from the chain.
  const providerRes = await context.sdk.akash
    .provider.v1beta4.getProvider({ owner: provider });

  if (!providerRes.provider) {
    throw new Error(`Could not find provider ${provider}`);
  }

  // Generate the manifest and serialize it as sorted JSON.
  const manifest = generateManifest(sdlInput);

  if (!manifest.ok) {
    throw new Error(
      'SDL validation failed: '
      + JSON.stringify(manifest.value),
    );
  }

  const body = manifestToSortedJSON(manifest.value.groups);
  const uri = new URL(providerRes.provider.hostUri);

  // mTLS agent — the provider authenticates us via our certificate.
  const agent = new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    rejectUnauthorized: false,
  });

  return await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: uri.hostname,
        port: uri.port,
        path: `/deployment/${dseq}/manifest`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': body.length,
        },
        agent,
      },
      (res) => {
        res.on('error', reject);
        res.on('data', () => {});

        if (res.statusCode !== 200) {
          return reject(
            new Error(`Could not send manifest: ${res.statusCode}`),
          );
        }

        resolve();
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
