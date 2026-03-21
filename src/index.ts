import { createServer } from 'http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import AkashMCP from './AkashMCP.js';
import { SERVER_CONFIG } from './config.js';

async function main() {
  const server = new AkashMCP();

  await server.initialize();
  server.registerTools();

  if (!server.isInitialized()) {
    throw new Error('Server failed to initialize properly');
  }

  // HTTP mode when TRANSPORT=http (for Akash / remote deployment).
  // Stdio mode otherwise (for local MCP clients like Claude Desktop).
  const mode = process.env.TRANSPORT || 'stdio';

  if (mode === 'http') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    await server.connect(transport);

    const port = Number(SERVER_CONFIG.port);
    const httpServer = createServer((req, res) => {
      void transport.handleRequest(req, res);
    });

    httpServer.listen(port, () => {
      console.log(`Akash MCP server listening on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
