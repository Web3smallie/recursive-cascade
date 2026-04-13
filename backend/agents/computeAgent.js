// ============================================================
// COMPUTEAGENT.JS — Recursive Cascade (FIXED + VERIFIED PIPELINE)
// ============================================================

import crypto from "crypto";

const AGENT_ID = "COMPUTE_WALLET_ADDRESS";
const AGENT_SECRET =
  process.env.COMPUTE_AGENT_SECRET || "compute-agent-secret-phase1";

// ── VERIFY RESEARCH PROOF ────────────────────────────────
function verifyResearchProof(researchOutput, researchProof) {
  if (!researchProof?.payloadToSign) return false;

  const expectedHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(researchOutput))
    .digest("hex");

  return researchProof.payloadToSign.outputHash === expectedHash;
}

// ── ANALYSIS ENGINE ───────────────────────────────────────
function analyzeMarket(marketData) {
  const { bitcoin, ethereum, stellar } = marketData.data;

  const totalMarketCap =
    bitcoin.usd_market_cap +
    ethereum.usd_market_cap +
    stellar.usd_market_cap;

  const dominance = {
    bitcoin: ((bitcoin.usd_market_cap / totalMarketCap) * 100).toFixed(2),
    ethereum: ((ethereum.usd_market_cap / totalMarketCap) * 100).toFixed(2),
    stellar: ((stellar.usd_market_cap / totalMarketCap) * 100).toFixed(2),
  };

  const assets = [
    { name: "bitcoin", change: bitcoin.usd_24h_change },
    { name: "ethereum", change: ethereum.usd_24h_change },
    { name: "stellar", change: stellar.usd_24h_change },
  ];

  const ranked = [...assets].sort((a, b) => b.change - a.change);

  function getSignal(change) {
    if (change > 3) return "STRONG BUY";
    if (change > 1) return "BUY";
    if (change > -1) return "HOLD";
    if (change > -3) return "SELL";
    return "STRONG SELL";
  }

  const signals = {
    bitcoin: getSignal(bitcoin.usd_24h_change),
    ethereum: getSignal(ethereum.usd_24h_change),
    stellar: getSignal(stellar.usd_24h_change),
  };

  const avgChange =
    (bitcoin.usd_24h_change +
      ethereum.usd_24h_change +
      stellar.usd_24h_change) /
    3;

  const sentiment =
    avgChange > 2
      ? "BULLISH"
      : avgChange > 0
      ? "CAUTIOUSLY BULLISH"
      : avgChange > -2
      ? "CAUTIOUSLY BEARISH"
      : "BEARISH";

  return {
    totalMarketCap,
    dominance,
    ranked,
    signals,
    sentiment,
    avgChange: avgChange.toFixed(2),
  };
}

// ── SIGN RESULT (FIXED: STABLE PAYLOAD ONLY) ──────────────
function signResult(jobId, output) {
  const outputHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex");

  const payloadToSign = {
    jobId,
    outputHash,
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
export async function handleCompute(req, res) {
  const {
    prompt,
    jobId,
    traceId,
    challenge,
    researchOutput,
    researchProof,
  } = req.body || {};

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

  // ── VERIFY RESEARCH INTEGRITY (FIXED CRITICAL GAP) ────
  if (!verifyResearchProof(researchOutput, researchProof)) {
    return res.status(403).json({
      error: "Invalid upstream data",
      message: "Research proof verification failed",
    });
  }

  console.log(`[COMPUTE] Verified research proof ✓ | Job: ${jobId}`);

  // ── EXECUTE ────────────────────────────────────────────
  const analysis = analyzeMarket(researchOutput);

  console.log(
    `[COMPUTE] Sentiment: ${analysis.sentiment} | Avg: ${analysis.avgChange}%`
  );

  // ── SIGN ───────────────────────────────────────────────
  const proof = signResult(jobId, analysis);

  console.log(
    `[COMPUTE] Signed ✓ | ${proof.signature.slice(0, 16)}...`
  );

  // ── RESPONSE ───────────────────────────────────────────
  return res.json({
    agent: "compute",
    jobId,
    traceId,
    prompt,
    output: analysis,
    proof,
  });
}