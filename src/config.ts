export const SERVER_CONFIG = {
  name: 'Akash-MCP-Server',
  version: '1.0.0',
  port: process.env.PORT || 3000,
  environment: process.env.NODE_ENV || 'development',
  // REST endpoint for queries (gRPC Gateway / LCD).
  // Public gRPC endpoints are firewalled on most networks,
  // so we use REST instead — same API, HTTP transport.
  restEndpoint: process.env.REST_ENDPOINT
    || 'https://api.akashnet.net:443',
  // RPC endpoint for signing and broadcasting transactions.
  rpcEndpoint: process.env.RPC_ENDPOINT
    || 'https://rpc.akashnet.net:443',
  mnemonic: process.env.AKASH_MNEMONIC || '',
} as const;

export type ServerConfig = typeof SERVER_CONFIG;
