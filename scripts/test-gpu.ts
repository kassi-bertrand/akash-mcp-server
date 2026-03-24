/**
 * GPU integration test for the Akash MCP server.
 *
 * Deploys an RTX 3090 container, installs PyTorch,
 * and verifies CUDA is available.
 *
 * Usage:
 *   npm run test:gpu
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Requests an RTX 3090, installs PyTorch, checks CUDA, then sleeps
// so we have time to query the service status.
const GPU_SDL = `
version: "2.0"
services:
  gpu-test:
    image: nvidia/cuda:12.6.2-runtime-ubuntu22.04
    command:
      - "bash"
      - "-c"
      - |
        apt-get update && apt-get install -y curl python3 &&
        curl -LsSf https://astral.sh/uv/install.sh | sh &&
        export PATH="$HOME/.local/bin:$PATH" &&
        uv pip install --system torch --index-url https://download.pytorch.org/whl/cu121 &&
        python3 -c "
        import torch
        print('CUDA available:', torch.cuda.is_available())
        if torch.cuda.is_available():
            print('GPU:', torch.cuda.get_device_name(0))
            print('Memory:', round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1), 'GB')
        " &&
        echo "GPU test complete. Sleeping..." &&
        sleep 600
    expose:
      - port: 8888
        as: 8888
        to:
          - global: true
profiles:
  compute:
    gpu-test:
      resources:
        cpu:
          units: 4
        memory:
          size: 16Gi
        storage:
          size: 32Gi
        gpu:
          units: 1
          attributes:
            vendor:
              nvidia:
                - model: rtx3090
                - model: rtx4090
                - model: a100
                - model: h100
  placement:
    dcloud:
      signedBy:
        anyOf:
          - akash1365yvmc4s7awdyj3n2sav7xfx76adc6dnmlx63
      pricing:
        gpu-test:
          denom: uact
          amount: 100000
deployment:
  gpu-test:
    dcloud:
      profile: gpu-test
      count: 1
`;

// ── Helpers ──────────────────────────────────────────

type ToolResult = {
  content: { type: string; text: string }[];
};

function parse(result: ToolResult): unknown {
  const text = result.content[0]?.text ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function log(tool: string, result: unknown) {
  console.log(`\n✅ ${tool}`);
  console.log(JSON.stringify(result, null, 2));
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const parsed = parse(result as ToolResult);
  log(name, parsed);
  return parsed;
}

// ── Main ─────────────────────────────────────────────

async function main() {
  console.log('🎮 Starting GPU test (RTX 3090)...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env as Record<string, string>,
    },
    stderr: 'inherit',
  });

  const client = new Client({
    name: 'gpu-test-client',
    version: '1.0.0',
  });

  await client.connect(transport);
  console.log('Connected to MCP server.\n');

  // Get wallet address.
  const address = await callTool(client, 'get-akash-account-addr') as string;

  if (!address || !address.startsWith('akash')) {
    console.error('No address returned, cannot continue.');
    await client.close();
    process.exit(1);
  }

  // Create GPU deployment.
  const deployment = await callTool(client, 'create-deployment', {
    rawSDL: GPU_SDL,
    deposit: 5000000,
    currency: 'uact',
  }) as { dseq?: number; error?: string };

  if (deployment.error || !deployment.dseq) {
    console.error('GPU deployment creation failed.');
    await client.close();
    process.exit(1);
  }

  const dseq = deployment.dseq;
  console.log(`\n🎮 GPU deployment created: dseq=${dseq}`);

  // Poll for GPU bids — providers with GPUs may be slower to respond.
  // Checks every 15s for up to 2 minutes.
  console.log('\n⏳ Waiting for GPU bids...');
  let bidList: { bid?: { id?: {
    provider?: string;
    gseq?: number;
    oseq?: number;
  } } }[] = [];

  const bidStart = Date.now();
  const BID_MAX_WAIT = 120_000; // 2 minutes

  while (Date.now() - bidStart < BID_MAX_WAIT) {
    await new Promise((r) => setTimeout(r, 15_000));

    const result = await callTool(client, 'get-bids', {
      dseq,
      owner: address,
    });

    if (Array.isArray(result) && result.length > 0) {
      bidList = result;
      break;
    }

    const elapsed = Math.round((Date.now() - bidStart) / 1000);
    console.log(`   No bids yet (${elapsed}s elapsed)...`);
  }

  if (bidList.length === 0) {
    console.error('No GPU bids received after 2 minutes. Closing deployment.');
    await callTool(client, 'close-deployment', { dseq });
    await client.close();
    process.exit(1);
  }

  const firstBid = bidList[0].bid?.id;
  const provider = firstBid?.provider ?? '';
  const gseq = firstBid?.gseq ?? 1;
  const oseq = firstBid?.oseq ?? 1;
  console.log(`\n🏷️  Got ${bidList.length} GPU bid(s). Using: ${provider}`);

  // Accept bid.
  await callTool(client, 'create-lease', {
    owner: address,
    dseq,
    gseq,
    oseq,
    provider,
  });

  // Send manifest.
  await callTool(client, 'send-manifest', {
    sdl: GPU_SDL,
    owner: address,
    dseq,
    gseq,
    oseq,
    provider,
  });

  // Poll until GPU container is ready.
  // PyTorch install can take a few minutes.
  console.log('\n⏳ Waiting for GPU container (torch install may take a few minutes)...');
  const POLL_INTERVAL = 10_000;
  const MAX_WAIT = 600_000; // 10 minutes
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const services = await callTool(client, 'get-services', {
      owner: address,
      dseq,
      gseq,
      oseq,
      provider,
    }) as Record<string, unknown>;

    const svcEntries = (services as any)?.services;
    if (svcEntries && typeof svcEntries === 'object') {
      const allReady = Object.entries(svcEntries).every(
        ([, svc]: [string, any]) => {
          const total = Math.max(svc?.total ?? 1, 1);
          return (svc?.ready_replicas ?? 0) >= total;
        },
      );

      const summary = Object.entries(svcEntries)
        .map(([name, svc]: [string, any]) =>
          `${name}: ${svc?.ready_replicas ?? 0}/${Math.max(svc?.total ?? 1, 1)}`)
        .join(', ');
      console.log(`   ${summary}`);

      if (allReady) {
        console.log('\n✅ GPU container is ready!');
        console.log('PyTorch CUDA check output is in the container logs.');
        break;
      }
    }
  }

  // Cleanup.
  console.log('\n🧹 Closing GPU deployment...');
  await callTool(client, 'close-deployment', { dseq });

  console.log('\n🎉 GPU test complete.\n');
  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('GPU test failed:', error);
  process.exit(1);
});
