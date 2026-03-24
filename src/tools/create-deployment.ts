import { z } from 'zod';
import {
  generateManifest,
  generateManifestVersion,
  yaml,
  type SDLInput,
} from '@akashnetwork/chain-sdk';
import type { ToolDefinition, ToolContext } from '../types/index.js';
import type { ChainSDK } from '../utils/load-wallet.js';
import { createOutput } from '../utils/create-output.js';

// ── Constants ───────────────────────────────────────────
//
// After the BME (Burn-Mint Equilibrium) upgrade (March 2026),
// deployments require ACT (denom: uact) instead of AKT.
// AKT (denom: uakt) is still used for gas fees.
//
// When the wallet's uact balance is below the deposit amount,
// we automatically mint ACT by burning AKT. The mint is
// epoch-based (~1 minute), so we poll until the balance arrives.

const UACT_DENOM = 'uact';
const UAKT_DENOM = 'uakt';

// The chain silently reverts mints below ~10 ACT at epoch
// processing (tx still returns status 0). We enforce a floor
// of 20M uakt (~$11 at current prices) to stay safely above.
const MIN_MINT_UAKT = 20_000_000;

// Mint 1.2x the deposit so we have a small buffer without
// over-burning AKT. Since AKT→ACT is oracle-priced (~2 AKT
// per 1 ACT at $0.55/AKT), large multipliers waste AKT.
const MINT_BUFFER_MULTIPLIER = 1.2;

// After minting, ACT arrives at the next epoch (~10 blocks / ~1 min).
// Poll every 5s for up to 2 minutes.
const MINT_POLL_INTERVAL_MS = 5_000;
const MINT_POLL_MAX_ATTEMPTS = 24;

const parameters = z.object({
  rawSDL: z.string().min(1),
  deposit: z.number().min(1),
  currency: z.string().min(1),
});

export const CreateDeploymentTool: ToolDefinition<typeof parameters> = {
  name: 'create-deployment',
  description:
    'Create a new deployment on Akash Network using the provided'
    + ' SDL string, deposit amount and currency.'
    + ' Automatically mints ACT from AKT if the wallet has insufficient ACT.',
  parameters,
  handler: async (params, context) => {
    const { rawSDL } = params;
    const { wallet, sdk } = context;

    try {
      const accounts = await wallet.getAccounts();
      const address = accounts[0].address;

      // ── Ensure sufficient ACT balance ─────────────────
      //
      // The BME model requires uact for deployment deposits.
      // If the caller requests uact and the balance is too low,
      // we burn AKT to mint ACT automatically.

      if (params.currency === UACT_DENOM) {
        await ensureActBalance(sdk, address, params.deposit);
      }

      // ── Parse SDL and generate manifest ───────────────

      const sdlInput: SDLInput = yaml.raw(rawSDL);
      const manifest = generateManifest(sdlInput);

      if (!manifest.ok) {
        return createOutput({
          error: 'SDL validation failed: '
            + JSON.stringify(manifest.value),
        });
      }

      const hash = await generateManifestVersion(
        manifest.value.groups,
      );

      // Use current block height as the deployment sequence number.
      const block = await sdk.cosmos.base.tendermint.v1beta1
        .getLatestBlock({});
      const dseq = Number(block.block?.header?.height ?? 0);

      // ── Create the deployment on-chain ────────────────

      await sdk.akash.deployment.v1beta4.createDeployment({
        id: { owner: address, dseq: BigInt(dseq) },
        groups: manifest.value.groupSpecs,
        hash,
        deposit: {
          amount: {
            denom: params.currency,
            amount: params.deposit.toString(),
          },
          sources: [1], // Pay from the wallet's own balance.
        },
      });

      return createOutput({ success: true, dseq });
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown error creating deployment';
      return createOutput({ error: message });
    }
  },
};

// ── Auto-mint helper ──────────────────────────────────────
//
// Checks the wallet's uact balance. If it's below the required
// deposit, burns enough AKT to mint ACT (with a 2x buffer).
// Then polls until the minted ACT appears in the balance.
//
// ACT minting is epoch-based: the burn tx succeeds immediately,
// but the ACT balance only updates at the next epoch (~1 min).

async function ensureActBalance(
  sdk: ChainSDK,
  address: string,
  requiredAmount: number,
): Promise<void> {
  const currentBalance = await getBalance(sdk, address, UACT_DENOM);

  if (currentBalance >= requiredAmount) {
    return; // Already have enough ACT.
  }

  // Mint enough ACT to cover this deposit plus a buffer,
  // but never less than the chain's minimum mint threshold.
  const mintAmount = Math.max(
    requiredAmount * MINT_BUFFER_MULTIPLIER,
    MIN_MINT_UAKT,
  );

  // Check we have enough AKT to burn.
  const aktBalance = await getBalance(sdk, address, UAKT_DENOM);
  if (aktBalance < mintAmount) {
    throw new Error(
      `Insufficient AKT to mint ACT. Need ${mintAmount} ${UAKT_DENOM}`
      + ` but wallet only has ${aktBalance} ${UAKT_DENOM}.`,
    );
  }

  // Burn AKT → mint ACT.
  console.error(`[mint-act] Minting ${mintAmount} uact from uakt for ${address}...`);
  await sdk.akash.bme.v1.mintACT({
    owner: address,
    to: address,
    coinsToBurn: { denom: UAKT_DENOM, amount: mintAmount.toString() },
  });
  console.error('[mint-act] Burn tx succeeded. Waiting for ACT to arrive...');

  // Poll until the ACT balance reflects the mint.
  // The chain processes mints at epoch boundaries (~10 blocks).
  for (let attempt = 0; attempt < MINT_POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(MINT_POLL_INTERVAL_MS);

    const newBalance = await getBalance(sdk, address, UACT_DENOM);
    if (newBalance >= requiredAmount) {
      console.error(`[mint-act] ACT balance: ${newBalance} uact. Ready.`);
      return;
    }

    console.error(
      `[mint-act] Waiting for epoch... (${attempt + 1}/${MINT_POLL_MAX_ATTEMPTS})`
      + ` balance: ${newBalance} uact`,
    );
  }

  throw new Error(
    'Timed out waiting for minted ACT to appear in balance.'
    + ' The mint tx succeeded but the epoch has not processed it yet.',
  );
}

/** Get the balance for a specific denomination. Returns 0 if not found. */
async function getBalance(
  sdk: ChainSDK,
  address: string,
  denom: string,
): Promise<number> {
  const result = await sdk.cosmos.bank.v1beta1
    .getAllBalances({ address });

  const coin = result.balances?.find(
    (b: { denom: string }) => b.denom === denom,
  );

  return coin ? Number(coin.amount) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
