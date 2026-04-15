import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { CertificatePem } from '@akashnetwork/chain-sdk';
import { loadWalletAndSdk, loadCertificate, type ChainSDK } from './utils/index.js';
import { SERVER_CONFIG } from './config.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GetAccountAddrTool,
  GetBidsTool,
  GetSDLsTool,
  GetSDLTool,
  SendManifestTool,
  CreateLeaseTool,
  GetServicesTool,
  CreateDeploymentTool,
  UpdateDeploymentTool,
  AddFundsTool,
  GetBalancesTool,
  CloseDeploymentTool,
  GetDeploymentTool,
} from './tools/index.js';
import type { ToolContext } from './types/index.js';

/** Compact one-line summary of tool params, omitting large values like SDL. */
function summarizeParams(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    if (val == null) continue;
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.length > 80) {
      parts.push(`${key}=<${str.length} chars>`);
    } else {
      parts.push(`${key}=${str}`);
    }
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** Extract key fields from tool results so operators can see what happened without digging into raw responses. */
function summarizeResult(toolName: string, result: any): string {
  try {
    // MCP results wrap content in { content: [{ type, text }] }
    const text = result?.content?.[0]?.text;
    const data = text ? JSON.parse(text) : result;

    switch (toolName) {
      case 'create-deployment':
        return data?.dseq ? `dseq=${data.dseq}` : '';
      case 'get-bids': {
        const bids = Array.isArray(data) ? data : (data?.bids ?? []);
        return `${bids.length} bid(s)`;
      }
      case 'create-lease':
        return data?.provider ? `provider=${data.provider}` : '';
      case 'get-services': {
        const ports = Array.isArray(data?.forwarded_ports) ? data.forwarded_ports : [];
        const services = data?.services ? Object.keys(data.services).length : 0;
        return `${services} service(s), ${ports.length} port(s)`;
      }
      case 'add-funds':
        return data?.amount ? `deposited=${data.amount}` : '';
      case 'get-deployment': {
        const escrow = data?.escrowAccount ?? data?.escrow_account;
        const balance = escrow?.balance?.amount ?? escrow?.funds?.amount;
        const state = data?.deployment?.state ?? data?.deployment?.deploymentState;
        return [
          state != null ? `state=${state}` : '',
          balance != null ? `escrow=${balance}` : '',
        ].filter(Boolean).join(', ');
      }
      case 'get-akash-balances': {
        const balances = Array.isArray(data) ? data : (data?.balances ?? []);
        return balances.map((b: any) => `${b.amount} ${b.denom}`).join(', ');
      }
      case 'close-deployment':
        return 'closed';
      case 'get-akash-account-addr':
        return typeof data === 'string' ? data : (data?.address ?? '');
      default:
        return '';
    }
  } catch {
    return '';
  }
}

class AkashMCP extends McpServer {
  private wallet: DirectSecp256k1HdWallet | null = null;
  private sdk: ChainSDK | null = null;
  private certificate: CertificatePem | null = null;

  constructor() {
    super({
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
    });
  }

  private getToolContext(): ToolContext {
    if (!this.isInitialized()) {
      throw new Error('MCP server not initialized');
    }
    return {
      sdk: this.sdk!,
      wallet: this.wallet!,
      certificate: this.certificate!,
    };
  }

  public async initialize() {
    const { wallet, sdk } = await loadWalletAndSdk();
    this.wallet = wallet;
    this.sdk = sdk;
    this.certificate = await loadCertificate(wallet, sdk);
  }

  /** Copy wallet, SDK, and certificate from another instance. */
  public shareState(source: AkashMCP) {
    this.wallet = source.wallet;
    this.sdk = source.sdk;
    this.certificate = source.certificate;
  }

  public registerTools() {
    const tools = [
      GetAccountAddrTool,
      GetBidsTool,
      CreateDeploymentTool,
      GetSDLsTool,
      GetSDLTool,
      SendManifestTool,
      CreateLeaseTool,
      GetServicesTool,
      UpdateDeploymentTool,
      AddFundsTool,
      GetBalancesTool,
      CloseDeploymentTool,
      GetDeploymentTool,
    ];

    for (const tool of tools) {
      this.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.parameters },
        async (args) => {
          const paramSummary = summarizeParams(args);
          console.log(`[tool] ${tool.name}${paramSummary} ...`);
          const start = Date.now();
          try {
            const result = await tool.handler(args, this.getToolContext());
            const summary = summarizeResult(tool.name, result);
            console.log(`[tool] ${tool.name} done ${Date.now() - start}ms${summary ? ` — ${summary}` : ''}`);
            return result;
          } catch (err: any) {
            console.error(`[tool] ${tool.name} FAIL ${Date.now() - start}ms — ${err.message ?? err}`);
            throw err;
          }
        },
      );
    }
  }

  public isInitialized(): boolean {
    return this.wallet !== null && this.sdk !== null && this.certificate !== null;
  }
}

export default AkashMCP;
