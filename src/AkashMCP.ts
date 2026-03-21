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
    this.registerTool(
      GetAccountAddrTool.name,
      { description: GetAccountAddrTool.description, inputSchema: GetAccountAddrTool.parameters },
      async (args) => GetAccountAddrTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetBidsTool.name,
      { description: GetBidsTool.description, inputSchema: GetBidsTool.parameters },
      async (args) => GetBidsTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      CreateDeploymentTool.name,
      { description: CreateDeploymentTool.description, inputSchema: CreateDeploymentTool.parameters },
      async (args) => CreateDeploymentTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetSDLsTool.name,
      { description: GetSDLsTool.description, inputSchema: GetSDLsTool.parameters },
      async (args) => GetSDLsTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetSDLTool.name,
      { description: GetSDLTool.description, inputSchema: GetSDLTool.parameters },
      async (args) => GetSDLTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      SendManifestTool.name,
      { description: SendManifestTool.description, inputSchema: SendManifestTool.parameters },
      async (args) => SendManifestTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      CreateLeaseTool.name,
      { description: CreateLeaseTool.description, inputSchema: CreateLeaseTool.parameters },
      async (args) => CreateLeaseTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetServicesTool.name,
      { description: GetServicesTool.description, inputSchema: GetServicesTool.parameters },
      async (args) => GetServicesTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      UpdateDeploymentTool.name,
      { description: UpdateDeploymentTool.description, inputSchema: UpdateDeploymentTool.parameters },
      async (args) => UpdateDeploymentTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      AddFundsTool.name,
      { description: AddFundsTool.description, inputSchema: AddFundsTool.parameters },
      async (args) => AddFundsTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetBalancesTool.name,
      { description: GetBalancesTool.description, inputSchema: GetBalancesTool.parameters },
      async (args) => GetBalancesTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      CloseDeploymentTool.name,
      { description: CloseDeploymentTool.description, inputSchema: CloseDeploymentTool.parameters },
      async (args) => CloseDeploymentTool.handler(args, this.getToolContext())
    );

    this.registerTool(
      GetDeploymentTool.name,
      { description: GetDeploymentTool.description, inputSchema: GetDeploymentTool.parameters },
      async (args) => GetDeploymentTool.handler(args, this.getToolContext())
    );
  }
  public isInitialized(): boolean {
    return this.wallet !== null && this.sdk !== null && this.certificate !== null;
  }
}

export default AkashMCP;
