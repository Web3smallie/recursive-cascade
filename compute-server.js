// ============================================================
// COMPUTE-SERVER.JS — TRUE RECURSIVE CASCADE
// ============================================================

import "dotenv/config";
import express from "express";
import crypto  from "crypto";
import fetch   from "node-fetch";

import { generateChallenge, validateChallenge } from "./backend/x402_mpp.js";

const app  = express();
const PORT = process.env.COMPUTE_PORT || 3002;

const AGENT_ID     = "COMPUTE_WALLET_ADDRESS";
const AGENT_SECRET = process.env.COMPUTE_AGENT_SECRET || "compute-agent-secret-phase1";

const REPORT_URL  = `http://localhost:${process.env.REPORT_PORT || 3003}`;
const REPORT_FEE  = 0.7;

app.use(express.json());

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Report call timed out")), ms)
    ),
  ]);
}

function slog(type, status, message, traceId, extra = {}) {
  console.log(JSON.stringify({
    type, agent: "compute", status, traceId, message,
    timestamp: new Date().toISOString(), ...extra,
  }));
}

function verifyResearchProof(researchOutput, researchProof) {
  if (!researchProof?.payloadToSign) return false;
  const expectedHash = crypto.createHash("sha256").update(JSON.stringify(researchOutput)).digest("hex");
  return researchProof.payloadToSign.outputHash === expectedHash;
}

function analyzeMarket(marketData) {
  const { bitcoin, ethereum, stellar } = marketData.data;

  const totalMarketCap = bitcoin.usd_market_cap + ethereum.usd_market_cap + stellar.usd_market_cap;

  const dominance = {
    bitcoin:  ((bitcoin.usd_market_cap  / totalMarketCap) * 100).toFixed(2),
    ethereum: ((ethereum.usd_market_cap / totalMarketCap) * 100).toFixed(2),
    stellar:  ((stellar.usd_market_cap  / totalMarketCap) * 100).toFixed(2),
  };

  const assets = [
    { name: "bitcoin",  change: bitcoin.usd_24h_change  },
    { name: "ethereum", change: ethereum.usd_24h_change },
    { name: "stellar",  change: stellar.usd_24h_change  },
  ];

  const ranked = [...assets].sort((a, b) => b.change - a.change);

  function getSignal(change) {
    if (change > 3)  return "STRONG BUY";
    if (change > 1)  return "BUY";
    if (change > -1) return "HOLD";
    if (change > -3) return "SELL";
    return "STRONG SELL";
  }

  const signals = {
    bitcoin:  getSignal(bitcoin.usd_24h_change),
    ethereum: getSignal(ethereum.usd_24h_change),
    stellar:  getSignal(stellar.usd_24h_change),
  };

  const avgChange = (bitcoin.usd_24h_change + ethereum.usd_24h_change + stellar.usd_24h_change) / 3;

  const sentiment =
    avgChange > 2  ? "BULLISH" :
    avgChange > 0  ? "CAUTIOUSLY BULLISH" :
    avgChange > -2 ? "CAUTIOUSLY BEARISH" : "BEARISH";

  return { totalMarketCap, dominance, ranked, signals, sentiment, avgChange: avgChange.toFixed(2) };
}

function signResult(jobId, output) {
  const outputHash = crypto.createHash("sha256").update(JSON.stringify(output)).digest("hex");
  const payloadToSign = { jobId, outputHash };
  const signature = crypto.createHmac("sha256", AGENT_SECRET).update(JSON.stringify(payloadToSign)).digest("hex");
  return { agentId: AGENT_ID, signature, payloadToSign };
}

app.post("/compute", async (req, res) => {
  const {
    prompt,
    jobId,
    reportJobId, // ← passed from Research (originally from PM)
    traceId = crypto.randomUUID(),
    challenge,
    researchOutput,
    researchProof,
  } = req.body || {};

  if (!challenge || !challenge.payload) {
    slog("error", "no_challenge", `[COMPUTE] 402 Payment Required → 1.0 USDC`, traceId);
    return res.status(402).json({ error: "Payment required", agent: "compute", amount: 1.0 });
  }

  if (!validateChallenge(challenge)) {
    slog("error", "invalid_challenge", "[COMPUTE] Invalid x402 challenge", traceId);
    return res.status(402).json({ error: "Invalid payment challenge" });
  }

  if (challenge.payload.jobId !== jobId) {
    return res.status(402).json({ error: "Challenge jobId mismatch" });
  }

  if (!researchOutput || !researchProof) {
    return res.status(400).json({ error: "Missing research data" });
  }

  if (!verifyResearchProof(researchOutput, researchProof)) {
    return res.status(403).json({ error: "Research proof invalid" });
  }

  slog("agent", "executing", `[COMPUTE] Gate passed ✓ | Job: ${jobId}`, traceId);
  slog("chain", "verified",  `[COMPUTE] Verified research proof ✓`, traceId);

  const analysis = analyzeMarket(researchOutput);

  slog("agent", "analyzed",
    `[COMPUTE] Sentiment: ${analysis.sentiment} | Avg: ${analysis.avgChange}%`, traceId
  );

  const proof = signResult(jobId, analysis);

  slog("agent", "hiring", `[COMPUTE] Hiring Report Agent...`, traceId);

  // Generate challenge for Report using PM-registered jobId
  const reportChallenge = await generateChallenge(
    process.env.REPORT_WALLET, REPORT_FEE, reportJobId, "testnet"
  );

  if (!validateChallenge(reportChallenge)) {
    throw new Error("Invalid challenge for Report");
  }

  slog("x402", "challenge_valid", "[x402] Challenge valid for Report ✓", traceId);

  const response = await withTimeout(
    fetch(`${REPORT_URL}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        jobId:         reportJobId, // ← use PM-registered ID
        traceId,
        challenge:     reportChallenge,
        researchOutput,
        computeOutput: analysis,
        computeProof:  proof,
      }),
    })
  );

  if (!response.ok) throw new Error(`Report failed (${response.status})`);

  const reportResult = await response.json();

  slog("agent", "done",   `[COMPUTE] Report received ✓`, traceId);
  slog("agent", "signed", `[COMPUTE] Proof signed ✓`, traceId);

  return res.json({
    agent: "compute",
    jobId,
    traceId,
    prompt,
    output:       analysis,
    proof,
    reportResult,
    timestamp:    new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`[COMPUTE AGENT] Running on http://localhost:${PORT}`);
});