// ============================================================
// RESEARCH-SERVER.JS — TRUE RECURSIVE CASCADE
// ============================================================

import "dotenv/config";
import express from "express";
import crypto  from "crypto";
import fetch   from "node-fetch";

import { generateChallenge, validateChallenge } from "./backend/x402_mpp.js";

const app  = express();
const PORT = process.env.RESEARCH_PORT || 3001;

const AGENT_ID     = "RESEARCH_WALLET_ADDRESS";
const AGENT_SECRET = process.env.RESEARCH_AGENT_SECRET || "research-agent-secret-phase1";

const COMPUTE_URL  = `http://localhost:${process.env.COMPUTE_PORT || 3002}`;
const COMPUTE_FEE  = 1.0;
const RESEARCH_FEE = 1.5;

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price" +
  "?ids=bitcoin,ethereum,stellar" +
  "&vs_currencies=usd" +
  "&include_24hr_change=true" +
  "&include_market_cap=true";

app.use(express.json());

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Compute call timed out")), ms)
    ),
  ]);
}

function slog(type, status, message, traceId, extra = {}) {
  console.log(JSON.stringify({
    type, agent: "research", status, traceId, message,
    timestamp: new Date().toISOString(), ...extra,
  }));
}

async function fetchMarketData(traceId) {
  try {
    slog("agent", "fetching", "[RESEARCH] Calling CoinGecko API...", traceId);

    const response = await fetch(COINGECKO_URL, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);

    const raw = await response.json();

    const data = {
      source: "coingecko",
      timestamp: new Date().toISOString(),
      data: {
        bitcoin:  { usd: raw.bitcoin?.usd ?? 0,  usd_24h_change: raw.bitcoin?.usd_24h_change ?? 0,  usd_market_cap: raw.bitcoin?.usd_market_cap ?? 0  },
        ethereum: { usd: raw.ethereum?.usd ?? 0, usd_24h_change: raw.ethereum?.usd_24h_change ?? 0, usd_market_cap: raw.ethereum?.usd_market_cap ?? 0 },
        stellar:  { usd: raw.stellar?.usd ?? 0,  usd_24h_change: raw.stellar?.usd_24h_change ?? 0,  usd_market_cap: raw.stellar?.usd_market_cap ?? 0  },
      },
    };

    slog("agent", "fetched",
      `[RESEARCH] BTC $${data.data.bitcoin.usd} | ETH $${data.data.ethereum.usd} | XLM $${data.data.stellar.usd}`,
      traceId
    );

    return data;

  } catch (err) {
    slog("agent", "fallback", `[RESEARCH] CoinGecko failed: ${err.message}`, traceId);

    return {
      source: "fallback",
      timestamp: new Date().toISOString(),
      data: {
        bitcoin:  { usd: 65420, usd_24h_change: 2.45, usd_market_cap: 1284000000000 },
        ethereum: { usd: 3180,  usd_24h_change: 1.87, usd_market_cap: 382000000000  },
        stellar:  { usd: 0.142, usd_24h_change: 3.12, usd_market_cap: 4200000000    },
      },
    };
  }
}

function signResult(jobId, output) {
  const outputHash = crypto.createHash("sha256").update(JSON.stringify(output)).digest("hex");
  const payloadToSign = { jobId, outputHash };
  const signature = crypto.createHmac("sha256", AGENT_SECRET).update(JSON.stringify(payloadToSign)).digest("hex");
  return { agentId: AGENT_ID, signature, payloadToSign };
}

app.post("/research", async (req, res) => {
  const {
    prompt,
    jobId,
    computeJobId, // ← passed from PM
    reportJobId,  // ← passed from PM, forwarded to Compute
    traceId = crypto.randomUUID(),
    challenge,
  } = req.body || {};

  if (!challenge || !challenge.payload) {
    slog("error", "no_challenge", `[RESEARCH] 402 Payment Required → ${RESEARCH_FEE} USDC`, traceId);
    return res.status(402).json({ error: "Payment required", agent: "research", amount: RESEARCH_FEE });
  }

  if (!validateChallenge(challenge)) {
    slog("error", "invalid_challenge", "[RESEARCH] Invalid x402 challenge", traceId);
    return res.status(402).json({ error: "Invalid payment challenge" });
  }

  if (challenge.payload.jobId !== jobId) {
    return res.status(402).json({ error: "Challenge jobId mismatch" });
  }

  slog("agent", "executing", `[RESEARCH] Gate passed ✓ | Job: ${jobId}`, traceId);

  const marketData = await fetchMarketData(traceId);
  const proof = signResult(jobId, marketData);

  slog("agent", "signed", `[RESEARCH] Proof signed ✓`, traceId);
  slog("agent", "hiring", `[RESEARCH] Hiring Compute Agent...`, traceId);

  // Generate challenge for Compute using PM-registered jobId
  const computeChallenge = await generateChallenge(
    process.env.COMPUTE_WALLET, COMPUTE_FEE, computeJobId, "testnet"
  );

  if (!validateChallenge(computeChallenge)) {
    throw new Error("Invalid challenge for Compute");
  }

  slog("x402", "challenge_valid", "[x402] Challenge valid for Compute ✓", traceId);

  const response = await withTimeout(
    fetch(`${COMPUTE_URL}/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        jobId:          computeJobId, // ← use PM-registered ID
        reportJobId,                  // ← forward to Compute
        traceId,
        challenge:      computeChallenge,
        researchOutput: marketData,
        researchProof:  proof,
      }),
    })
  );

  if (!response.ok) throw new Error(`Compute failed (${response.status})`);

  const computeResult = await response.json();

  slog("agent", "done", `[RESEARCH] Compute result received ✓`, traceId);

  return res.json({
    agent: "research",
    jobId,
    traceId,
    output: marketData,
    proof,
    computeResult,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`[RESEARCH AGENT] Running on http://localhost:${PORT}`);
});