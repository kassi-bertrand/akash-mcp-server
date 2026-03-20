/**
 * Integration test for all MCP tools against the Akash sandbox network.
 *
 * Spawns the MCP server as a child process, connects as a client,
 * and calls every tool in a realistic deployment flow.
 *
 * Usage:
 *   npm run test:sandbox
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// A minimal SDL that deploys an nginx container.
const TEST_SDL = `
version: "2.0"
services:
  web:
    image: nginx
    expose:
      - port: 80
        as: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 1Gi
  placement:
    dcloud:
      pricing:
        web:
          denom: uakt
          amount: 1000
deployment:
  web:
    dcloud:
      profile: web
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

function fail(tool: string, error: unknown) {
  console.error(`\n❌ ${tool}`);
  console.error(error);
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
  console.log('🚀 Starting MCP server...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env as Record<string, string>,
    },
    stderr: 'inherit',
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  });

  await client.connect(transport);
  console.log('Connected to MCP server.\n');

  // List available tools
  const tools = await client.listTools();
  console.log(`📋 Available tools (${tools.tools.length}):`);
  for (const tool of tools.tools) {
    console.log(`   - ${tool.name}`);
  }

  // ── Phase 1: Read-only queries ───────────────────

  console.log('\n━━━ Phase 1: Read-only queries ━━━');

  // Get account address from the server wallet.
  const account = await callTool(client, 'get-account-addr') as {
    address?: string;
  };
  const address = account.address ?? '';

  if (!address) {
    console.error('No address returned, cannot continue.');
    await client.close();
    process.exit(1);
  }

  // Get balances for the wallet.
  await callTool(client, 'get-akash-balances', { address });

  // List SDL templates (may be empty if submodule not initialized).
  await callTool(client, 'get-sdls', { page: 1, limit: 5 });

  // ── Phase 2: Full deployment flow ────────────────

  console.log('\n━━━ Phase 2: Deployment flow ━━━');

  // Step 1: Create deployment.
  const deployment = await callTool(client, 'create-deployment', {
    rawSDL: TEST_SDL,
    deposit: 5000000,
    currency: 'uakt',
  }) as { dseq?: number; error?: string };

  if (deployment.error || !deployment.dseq) {
    console.error('Deployment creation failed, skipping remaining flow.');
    await client.close();
    process.exit(1);
  }

  const dseq = deployment.dseq;
  console.log(`\n📦 Deployment created: dseq=${dseq}`);

  // Step 2: Wait for bids (providers need time to respond).
  console.log('\n⏳ Waiting 15s for bids...');
  await new Promise((r) => setTimeout(r, 15_000));

  const bids = await callTool(client, 'get-bids', {
    dseq,
    owner: address,
  }) as { bids?: { bid?: { bidId?: {
    provider?: string;
    gseq?: number;
    oseq?: number;
  } } }[] };

  const bidList = bids.bids ?? [];
  if (bidList.length === 0) {
    console.error('No bids received. Closing deployment and exiting.');
    await callTool(client, 'close-deployment', { dseq });
    await client.close();
    process.exit(1);
  }

  const firstBid = bidList[0].bid?.bidId;
  const provider = firstBid?.provider ?? '';
  const gseq = firstBid?.gseq ?? 1;
  const oseq = firstBid?.oseq ?? 1;
  console.log(`\n🏷️  Got ${bidList.length} bid(s). Using provider: ${provider}`);

  // Step 3: Create lease (accept bid).
  await callTool(client, 'create-lease', {
    owner: address,
    dseq,
    gseq,
    oseq,
    provider,
  });

  // Step 4: Send manifest to provider.
  await callTool(client, 'send-manifest', {
    sdl: TEST_SDL,
    owner: address,
    dseq,
    gseq,
    oseq,
    provider,
  });

  // Step 5: Wait for provider to start services.
  console.log('\n⏳ Waiting 10s for services to start...');
  await new Promise((r) => setTimeout(r, 10_000));

  // Step 6: Get service status.
  await callTool(client, 'get-services', {
    owner: address,
    dseq,
    gseq,
    oseq,
    provider,
  });

  // Step 7: Get deployment details.
  await callTool(client, 'get-deployment', {
    owner: address,
    dseq,
  });

  // Step 8: Add funds to deployment.
  await callTool(client, 'add-funds', {
    address,
    dseq,
    amount: '1000000',
  });

  // Step 9: Update deployment with same SDL (just to test the flow).
  await callTool(client, 'update-deployment', {
    rawSDL: TEST_SDL,
    provider,
    dseq,
  });

  // Step 10: Close deployment (cleanup).
  await callTool(client, 'close-deployment', { dseq });

  // ── Done ─────────────────────────────────────────

  console.log('\n━━━ All tools tested ━━━');
  console.log('🎉 Integration test complete.\n');

  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
