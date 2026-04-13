// ============================================================
// RESEARCHAGENT.JS — Recursive Cascade (FIXED + CLEAN SIGNING)
// ============================================================

import fetch from "node-fetch";
import crypto from "crypto";

const AGENT_ID = "RESEARCH_WALLET_ADDRESS";
const AGENT_SECRET =
  process.env.RESEARCH_AGENT_SECRET || "research-agent-secret-phase1";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price" +
  "?ids=bitcoin,ethereum,stellar" +
  "&vs_currencies=usd" +
  "&include_24hr_change=true" +
  "&include_market_cap=true";

// ── FALLBACK DATA ─────────────────────────────────────────
function getFallbackData() {
  return {
    source: "fallback",
    timestamp: new Date().toISOString(),
    data: {
      bitcoin: {
        usd: 65420.0,
        usd_24h_change: 2.45,
        usd_market_cap: 1284000000000,
      },
      ethereum: {
        usd: 3180.5,
        usd_24h_change: 1.87,
        usd_market_cap: 382000000000,
      },
      stellar: {
        usd: 0.1423,
        usd_24h_change: 3.12,
        usd_market_cap: 4200000000,
      },
    },
  };
}

// ── FETCH COINGECKO ───────────────────────────────────────
async function fetchMarketData() {
  try {
    const response = await fetch(COINGECKO_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}`);
    }

    const raw = await response.json();

    return {
      source: "coingecko",
      timestamp: new Date().toISOString(),
      data: {
        bitcoin: {
          usd: raw.bitcoin?.usd ?? 0,
          usd_24h_change: raw.bitcoin?.usd_24h_change ?? 0,
          usd_market_cap: raw.bitcoin?.usd_market_cap ?? 0,
        },
        ethereum: {
          usd: raw.ethereum?.usd ?? 0,
          usd_24h_change: raw.ethereum?.usd_24h_change ?? 0,
          usd_market_cap: raw.ethereum?.usd_market_cap ?? 0,
        },
        stellar: {
          usd: raw.stellar?.usd ?? 0,
          usd_24h_change: raw.stellar?.usd_24h_change ?? 0,
          usd_market_cap: raw.stellar?.usd_market_cap ?? 0,
        },
      },
    };
  } catch (err) {
    console.log(`[RESEARCH] CoinGecko failed: ${err.message}`);
    return getFallbackData();
  }
}

// ── SIGN RESULT (FIXED: DETERMINISTIC) ───────────────────
// Sign ONLY stable data (no timestamp inside payload)
function signResult(jobId, output) {
  const payloadToSign = {
    jobId,
    outputHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(output))
      .digest("hex"),
  };

  const signature = crypto
    .createHmac("sha256", AGENT_SECRET)
    .update(JSON.stringify(payloadToSign))
    .digest("hex");

  return {
    agentId: AGENT_ID,
    signature,
    payloadToSign,
  };
}

// ── ROUTE HANDLER ─────────────────────────────────────────
export async function handleResearch(req, res) {
  const { prompt, jobId, traceId, challenge } = req.body || {};

  // ── LIGHT GATE CHECK ───────────────────────────────────
  if (!challenge || !challenge.payload) {
    return res.status(402).json({
      error: "Payment required",
      message: "Missing challenge",
    });
  }

  if (challenge.payload.jobId !== jobId) {
    return res.status(402).json({
      error: "Payment required",
      message: "Job mismatch",
    });
  }

  console.log(`[RESEARCH] Gate passed ✓ | Job: ${jobId}`);

  // ── EXECUTE ────────────────────────────────────────────
  const marketData = await fetchMarketData();

  console.log(
    `[RESEARCH] BTC $${marketData.data.bitcoin.usd} | ` +
      `ETH $${marketData.data.ethereum.usd} | ` +
      `XLM $${marketData.data.stellar.usd}`
  );

  // ── SIGN ───────────────────────────────────────────────
  const proof = signResult(jobId, marketData);

  console.log(
    `[RESEARCH] Signed ✓ | ${proof.signature.slice(0, 16)}...`
  );

  // ── RESPONSE ───────────────────────────────────────────
  return res.json({
    agent: "research",
    jobId,
    traceId,
    prompt,
    output: marketData,
    proof,
    timestamp: new Date().toISOString(),
  });
}