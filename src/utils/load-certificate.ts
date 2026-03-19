import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  certificateManager,
  type CertificatePem,
} from '@akashnetwork/chain-sdk';
import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { ChainSDK } from './load-wallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads an existing certificate from disk, or creates and publishes
 * a new one to the Akash blockchain. Certificates are needed for
 * mTLS communication with providers.
 */
export async function loadCertificate(
  wallet: DirectSecp256k1HdWallet,
  sdk: ChainSDK,
): Promise<CertificatePem> {
  const accounts = await wallet.getAccounts();
  const address = accounts[0].address;
  const certificatesDir = path.resolve(__dirname, './certificates');

  if (!fs.existsSync(certificatesDir)) {
    fs.mkdirSync(certificatesDir, { recursive: true });
  }

  const certificatePath = path.resolve(certificatesDir, `${address}.json`);

  // Return cached certificate if one exists on disk.
  if (fs.existsSync(certificatePath)) {
    return JSON.parse(fs.readFileSync(certificatePath, 'utf8'));
  }

  // Generate a new certificate and publish it to the blockchain.
  const certificate = await certificateManager.generatePEM(address);

  await sdk.akash.cert.v1.createCertificate({
    owner: address,
    cert: Buffer.from(certificate.cert, 'utf-8'),
    pubkey: Buffer.from(certificate.publicKey, 'utf-8'),
  });

  // Cache to disk so we don't recreate on next startup.
  fs.writeFileSync(certificatePath, JSON.stringify(certificate));

  return certificate;
}
