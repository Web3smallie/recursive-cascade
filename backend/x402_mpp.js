// ============================================================
// x402_MPP.JS — Recursive Cascade (FINAL FIXED)
// Dual-mode payment challenge generator
// ============================================================

import crypto from "crypto";

// ── SDK LOAD ──────────────────────────────────────────────
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let ChargeMethods = null;
let sdkLoaded = false;

try {
  const mpp = require("@stellar/mpp");
  ChargeMethods = mpp.ChargeMethods || mpp.default || mpp;

  if (ChargeMethods?.charge) {
    sdkLoaded = true;
    console.log("[SDK] @stellar/mpp loaded successfully via createRequire.");
  } else {
    console.log("[SDK] Invalid SDK shape — fallback only.");
  }
} catch (e) {
  console.log(`[SDK] Failed to load: ${e.message}`);
}

// ── CONFIG VALIDATION ─────────────────────────────────────
const hasAll =
  process.env.PM_SECRET_KEY &&
  process.env.USDC_SAC_ADDRESS;

const hasAny =
  process.env.PM_SECRET_KEY ||
  process.env.USDC_SAC_ADDRESS;

if (hasAny && !hasAll) {
  throw new Error(
    "Incomplete Stellar config — set both PM_SECRET_KEY and USDC_SAC_ADDRESS or neither"
  );
}

const USE_REAL_MPP = process.env.USE_REAL_MPP === "true";

// ── REAL CHALLENGE (SAFE IMPLEMENTATION) ───────────────────
async function generateRealChallenge(agentWallet, amount, jobId) {
  try {
    const stellar = await import("@stellar/stellar-sdk");
    const Keypair = stellar.Keypair;

    const source = Keypair.fromSecret(process.env.PM_SECRET_KEY);

    const network =
      (process.env.STELLAR_NETWORK || "testnet").toUpperCase();

    const challenge = await ChargeMethods.charge({
      source,
      destination: agentWallet,
      amount: amount.toString(),
      asset: process.env.USDC_SAC_ADDRESS,
      memo: jobId,
      network,
    });

    return {
      status: 402,
      version: "x402/1.0",
      source: "stellar",
      payload: {
        destination: agentWallet,
        amount: Number(amount).toFixed(7),
        asset: "USDC",
        jobId,
        network,
        raw: challenge,
      },
      header: buildHeader(agentWallet, amount, jobId, "stellar", network),
    };
  } catch (err) {
    throw new Error(`Real MPP failed: ${err.message}`);
  }
}

// ── FALLBACK CHALLENGE (DETERMINISTIC) ─────────────────────
async function generateFallbackChallenge(provider, amount, jobId, network) {
  const safeAmount = Number(amount);

  const nonce = crypto
    .createHash("sha256")
    .update(`${provider}:${safeAmount}:${jobId}:${network}`)
    .digest("hex")
    .slice(0, 16);

  return {
    status: 402,
    version: "x402/1.0",
    source: "fallback",
    payload: {
      network,
      destination: provider,
      amount: safeAmount.toFixed(7),
      asset: "USDC",
      jobId,
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000,
    },
    header: buildHeader(provider, safeAmount, jobId, nonce, network),
  };
}

// ── MAIN WRAPPER ──────────────────────────────────────────
export async function generateChallenge(
  provider,
  amount,
  jobId,
  network = "testnet"
) {
  if (USE_REAL_MPP && sdkLoaded && hasAll) {
    try {
      console.log("[SDK] Using real Stellar MPP...");
      return await generateRealChallenge(provider, amount, jobId);
    } catch (err) {
      console.log(`[SDK] Failed → ${err.message}`);
      console.log("[FALLBACK] Switching to deterministic mode.");
    }
  }

  return generateFallbackChallenge(provider, amount, jobId, network);
}

// ── BUILD HEADER ──────────────────────────────────────────
function buildHeader(provider, amount, jobId, nonce, network) {
  return [
    `version=x402/1.0`,
    `network=${network}`,
    `destination=${provider}`,
    `amount=${Number(amount).toFixed(7)}`,
    `asset=USDC`,
    `jobId=${jobId}`,
    `nonce=${nonce}`,
    `expires=${Date.now() + 5 * 60 * 1000}`,
  ].join(", ");
}

// ── VALIDATE CHALLENGE ────────────────────────────────────
export function validateChallenge(challenge) {
  if (!challenge?.payload) {
    console.log("[x402] Invalid challenge — missing payload");
    return false;
  }

  // Real SDK = trusted
  if (challenge.source === "stellar") {
    console.log(
      `[x402] Real Stellar challenge accepted for job ${challenge.payload.jobId}`
    );
    return true;
  }

  const { destination, amount, jobId, network, nonce } =
    challenge.payload;

  const expectedNonce = crypto
    .createHash("sha256")
    .update(`${destination}:${Number(amount)}:${jobId}:${network}`)
    .digest("hex")
    .slice(0, 16);

  const valid = nonce === expectedNonce;

  if (valid) {
    console.log(
      `[x402] Challenge valid for job ${jobId} → ${destination}`
    );
  } else {
    console.log(
      `[x402] Challenge INVALID for job ${jobId} — nonce mismatch`
    );
  }

  return valid;
}