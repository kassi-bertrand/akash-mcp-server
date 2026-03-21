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
// UPDATE_SDL bumps memory to 256Mi — used to test update-deployment
// (the chain rejects updates with the same hash).
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

const UPDATE_SDL = `
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
          size: 1Gi
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
  // The tool returns the address as a plain string.
  const address = await callTool(client, 'get-akash-account-addr') as string;

  if (!address || !address.startsWith('akash')) {
    console.error('No address returned, cannot continue.');
    await client.close();
    process.exit(1);
  }

  // Get balances for the wallet.
  await callTool(client, 'get-akash-balances', { address });

  // List SDL templates (may be empty if submodule not initialized).
  await callTool(client, 'get-sdl-templates', { page: 1, limit: 5 });

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

  // The tool returns an array of { bid, escrowAccount } objects.
  // Each bid has an `id` with owner, dseq, gseq, oseq, provider.
  const bidList = await callTool(client, 'get-bids', {
    dseq,
    owner: address,
  }) as { bid?: { id?: {
    provider?: string;
    gseq?: number;
    oseq?: number;
  } } }[];

  if (!Array.isArray(bidList) || bidList.length === 0) {
    console.error('No bids received. Closing deployment and exiting.');
    await callTool(client, 'close-deployment', { dseq });
    await client.close();
    process.exit(1);
  }

  const firstBid = bidList[0].bid?.id;
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

  // Step 5: Poll until all services are ready (like deploy-ability does).
  // Checks every 10s for up to 5 minutes.
  console.log('\n⏳ Waiting for services to become ready...');
  const POLL_INTERVAL = 10_000;
  const MAX_WAIT = 300_000;
  const start = Date.now();
  let services: Record<string, unknown> = {};

  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    services = await callTool(client, 'get-services', {
      owner: address,
      dseq,
      gseq,
      oseq,
      provider,
    }) as Record<string, unknown>;

    // Check if all services have ready_replicas >= total.
    const svcEntries = (services as any)?.services;
    if (svcEntries && typeof svcEntries === 'object') {
      const allReady = Object.entries(svcEntries).every(
        ([, svc]: [string, any]) => {
          const total = Math.max(svc?.total ?? 1, 1);
          return (svc?.ready_replicas ?? 0) >= total;
        },
      );

      // Log readiness summary.
      const summary = Object.entries(svcEntries)
        .map(([name, svc]: [string, any]) =>
          `${name}: ${svc?.ready_replicas ?? 0}/${Math.max(svc?.total ?? 1, 1)}`)
        .join(', ');
      console.log(`   ${summary}`);

      if (allReady) {
        console.log('✅ All services ready.');
        break;
      }
    }
  }

  // Step 6: If we got service URIs, hit one to verify it's live.
  try {
    const svcEntries = (services as any)?.services;
    let serviceUrl: string | null = null;

    if (svcEntries && typeof svcEntries === 'object') {
      for (const [, svc] of Object.entries(svcEntries) as [string, any][]) {
        const uris: string[] = svc?.uris ?? [];
        if (uris.length > 0) {
          serviceUrl = `http://${uris[0]}`;
          break;
        }
      }
    }

    if (serviceUrl) {
      console.log(`\n🌐 Checking deployed service at ${serviceUrl}...`);
      const res = await fetch(serviceUrl);
      const body = await res.text();
      const isNginx = body.includes('nginx') || body.includes('Welcome');
      console.log(`   HTTP ${res.status} — ${isNginx ? 'nginx is live!' : 'got a response'}`);
    } else {
      console.log('\n⚠️  No service URIs found to verify.');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n⚠️  Could not reach deployed service: ${msg}`);
  }

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
    rawSDL: UPDATE_SDL,
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
