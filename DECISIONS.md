# Decision Log

## 2026-03-19: Add certificate query and revoke tools

**Context**: During the chain-sdk migration, we noticed that `load-certificate.ts` only handles creating and caching certs. The chain-sdk also supports querying and revoking certificates via `sdk.akash.cert.v1`.

**Decision**: Add two new MCP tools after the migration is complete:

1. **query-certificates** — Check certificate status (valid/revoked/expired) for a given owner. Useful for diagnosing mTLS failures and verifying cert health before deploying.
   - API: `sdk.akash.cert.v1.getCertificates({ filter: { owner, state } })`

2. **revoke-certificate** — Revoke a certificate by owner and serial. Useful for key rotation and cleanup.
   - API: `sdk.akash.cert.v1.revokeCertificate({ id: { owner, serial } })`

**Status**: Deferred until chain-sdk migration is complete.

## 2026-03-19: Multi-wallet support and tool access control

**Context**: The server currently uses a single wallet (`AKASH_MNEMONIC`). Agents connecting via MCP cannot bring their own wallet. WalletConnect-style external signing was considered and rejected — too much complexity for the value.

**Decision**:

1. **Single server wallet** — The MCP server is powered by one wallet (`AKASH_MNEMONIC`). Agents don't bring their own wallets — they invoke tools through the server's identity.

2. **Tool access tiers** — Not all tools are callable by every agent. Admin-related tools (certificate revocation, closing deployments, etc.) are protected behind auth. Read-only query tools can be open.

3. **No WalletConnect** — External signing flows are out of scope.

**Status**: Design needed — define which tools are admin vs open, and the access control mechanism.
