import type { z } from 'zod';
import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { CertificatePem } from '@akashnetwork/chain-sdk';
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChainSDK } from '../utils/load-wallet.js';

// Tool related types
export interface ToolContext {
  sdk: ChainSDK;
  wallet: DirectSecp256k1HdWallet;
  certificate: CertificatePem;
}

export interface ToolDefinition<P extends z.ZodType> {
  name: string;
  description: string;
  parameters: P;
  handler: (params: z.infer<P>, context: ToolContext) => Promise<any>;
}

export interface ResourceDefinition {
  name: string;
  uri: string;
  readCallback: ReadResourceCallback;
}

export interface CustomLease {
  id: CustomLeaseID;
}

export interface CustomLeaseID {
  owner: string;
  dseq: number;
  gseq: number;
  oseq: number;
  provider: string;
}

// Configuration types
export interface ServerConfiguration {
  port: number;
  apiKey?: string;
  environment: 'development' | 'production' | 'test';
}
