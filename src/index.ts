import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import AkashMCP from './AkashMCP.js';
import { SERVER_CONFIG } from './config.js';

// Shared state initialized once at startup.
let server: AkashMCP;

// One transport per session — the official MCP pattern.
const sessions = new Map<string, StreamableHTTPServerTransport>();

async function handlePost(req: import('http').IncomingMessage, res: import('http').ServerResponse) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Continuation request — reuse existing transport.
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  // New session — create a fresh transport and connect it.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  // Each session gets its own server instance connected to its transport.
  const sessionServer = new AkashMCP();
  sessionServer.shareState(server);
  sessionServer.registerTools();
  await sessionServer.connect(transport);
  await transport.handleRequest(req, res);
}

async function handleGet(req: import('http').IncomingMessage, res: import('http').ServerResponse) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(400).end('Missing or invalid session ID');
    return;
  }
  const transport = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
}

async function handleDelete(req: import('http').IncomingMessage, res: import('http').ServerResponse) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(400).end('Missing or invalid session ID');
    return;
  }
  const transport = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
}

async function main() {
  server = new AkashMCP();

  console.log('Initializing wallet, SDK, and certificate...');
  await server.initialize();

  if (!server.isInitialized()) {
    throw new Error('Server failed to initialize properly');
  }

  console.log('Server initialized successfully');

  // HTTP mode when TRANSPORT=http (for Akash / remote deployment).
  // Stdio mode otherwise (for local MCP clients like Claude Desktop).
  const mode = process.env.TRANSPORT || 'stdio';

  if (mode === 'http') {
    const port = Number(SERVER_CONFIG.port);
    const httpServer = createServer(async (req, res) => {
      console.log(`${req.method} ${req.url}`);

      try {
        if (req.method === 'POST') await handlePost(req, res);
        else if (req.method === 'GET') await handleGet(req, res);
        else if (req.method === 'DELETE') await handleDelete(req, res);
        else res.writeHead(405).end('Method not allowed');
      } catch (err) {
        console.error('Request error:', err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    });

    httpServer.listen(port, () => {
      console.log(`Akash MCP server listening on port ${port} (HTTP mode)`);
    });
  } else {
    const transport = new StdioServerTransport();
    server.registerTools();
    await server.connect(transport);
  }

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
