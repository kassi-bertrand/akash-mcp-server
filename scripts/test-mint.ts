/**
 * Test script for MsgMintACT via the TypeScript chain-sdk.
 *
 * Tests Zeke's theory: "you need to mint at least 10 act."
 * Tries two amounts — a small one (5 AKT) and a large one (50 AKT) —
 * to see if a minimum mint threshold explains the epoch revert.
 *
 * Output is formatted for easy copy-paste into Discord.
 *
 * Usage:
 *   AKASH_MNEMONIC="$(kadi secret get AKASH_WALLET -v global)" npx tsx scripts/test-mint.ts
 */

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { createChainNodeWebSDK } from '@akashnetwork/chain-sdk/web';
import { createStargateClient } from '@akashnetwork/chain-sdk';

// Two test amounts: below and above the suspected 10 ACT minimum.
// AKT→ACT rate is oracle-based, so we overshoot to be safe.
const SMALL_AMOUNT = '5000000';   //  5 AKT (previously failed)
const LARGE_AMOUNT = '50000000';  // 50 AKT (should be well above 10 ACT)

async function main() {
  const mnemonic = process.env.AKASH_MNEMONIC;
  if (!mnemonic) {
    console.error('Set AKASH_MNEMONIC env var.');
    process.exit(1);
  }

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'akash' });
  const accounts = await wallet.getAccounts();
  const address = accounts[0].address;

  const sdk = createChainNodeWebSDK({
    query: { baseUrl: 'https://api.akashnet.net' },
    tx: {
      signer: createStargateClient({
        baseUrl: 'https://rpc.akashnet.net',
        signer: wallet,
        defaultGasPrice: '0.025uakt',
        gasMultiplier: 1.6,
      }),
    },
  });

  console.log('═══════════════════════════════════════════');
  console.log(' MsgMintACT — TypeScript chain-sdk test');
  console.log('═══════════════════════════════════════════');
  console.log(`Wallet:  ${address}`);
  console.log(`SDK:     @akashnetwork/chain-sdk@1.0.0-alpha.27`);
  console.log(`Chain:   akashnet-2 (mainnet)`);
  console.log(`RPC:     https://rpc.akashnet.net`);
  console.log(`API:     https://api.akashnet.net`);

  // Show starting balances
  const before = await getBalances(sdk, address);
  console.log(`\n── Starting balances ──`);
  printBalances(before);

  // Test 1: Small amount (5 AKT) — previously reverted
  console.log(`\n── Test 1: Mint ${SMALL_AMOUNT} uakt (5 AKT) ──`);
  await testMint(sdk, address, SMALL_AMOUNT);

  // Wait for epoch before second test
  console.log('\n⏳ Waiting 90s for epoch to process test 1...');
  await sleep(90_000);

  const midBalances = await getBalances(sdk, address);
  console.log('\n── Balances after epoch (test 1) ──');
  printBalances(midBalances);

  // Test 2: Large amount (50 AKT) — above suspected minimum
  console.log(`\n── Test 2: Mint ${LARGE_AMOUNT} uakt (50 AKT) ──`);
  await testMint(sdk, address, LARGE_AMOUNT);

  // Wait for epoch
  console.log('\n⏳ Waiting 90s for epoch to process test 2...');
  await sleep(90_000);

  const finalBalances = await getBalances(sdk, address);
  console.log('\n── Final balances after epoch (test 2) ──');
  printBalances(finalBalances);

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log(' Summary');
  console.log('═══════════════════════════════════════════');
  const aktDiff = (before.uakt ?? 0) - (finalBalances.uakt ?? 0);
  const actDiff = (finalBalances.uact ?? 0) - (before.uact ?? 0);
  console.log(`  AKT spent:  ${aktDiff} uakt`);
  console.log(`  ACT gained: ${actDiff} uact`);
  if (actDiff === 0) {
    console.log('  ❌ No ACT minted — both amounts reverted.');
  } else {
    console.log('  ✅ ACT was minted.');
  }
}

// ── Helpers ──────────────────────────────────────────

async function testMint(sdk: any, address: string, amount: string) {
  const call = {
    owner: address,
    to: address,
    coinsToBurn: { denom: 'uakt', amount },
  };
  console.log('Call:', JSON.stringify(call, null, 2));

  try {
    const result = await sdk.akash.bme.v1.mintACT(call);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('Error:', error.message ?? error);
    if (error.response?.data) {
      console.error('Chain error:', JSON.stringify(error.response.data, null, 2));
    }
  }

  // Check balance immediately after tx
  const after = await getBalances(sdk, address);
  console.log('Balances (immediate):');
  printBalances(after);
}

interface Balances {
  uakt: number;
  uact: number;
  [key: string]: number;
}

async function getBalances(sdk: any, address: string): Promise<Balances> {
  const result = await sdk.cosmos.bank.v1beta1.getAllBalances({ address });
  const balances: Balances = { uakt: 0, uact: 0 };
  for (const b of result.balances ?? []) {
    balances[b.denom] = Number(b.amount);
  }
  return balances;
}

function printBalances(b: Balances) {
  console.log(`  uakt: ${b.uakt}`);
  console.log(`  uact: ${b.uact}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
