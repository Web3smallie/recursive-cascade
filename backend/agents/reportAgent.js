// ============================================================
// REPORTAGENT.JS — Recursive Cascade
// Paid report service. Runs on /agent/report route.
// ============================================================

import crypto from "crypto";

const AGENT_ID = "REPORT_WALLET_ADDRESS";
const AGENT_SECRET =
  process.env.REPORT_AGENT_SECRET || "report-agent-secret-phase1";

// ── VERIFY COMPUTE PROOF ──────────────────────────────────
function verifyComputeProof(computeOutput, computeProof) {
  if (!computeProof?.payloadToSign) return false;

  const expectedHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(computeOutput))
    .digest("hex");

  return computeProof.payloadToSign.outputHash === expectedHash;
}

// ── REPORT GENERATOR (UNCHANGED) ──────────────────────────
function generateReport(prompt, researchOutput, computeOutput) {
  const { data, source } = researchOutput;

  const {
    sentiment,
    avgChange,
    dominance,
    signals,
    ranked,
    totalMarketCap,
  } = computeOutput;

  const topPerformer = ranked[0];
  const lastPerformer = ranked[ranked.length - 1];

  const formatUSD = (n) =>
    n >= 1e12
      ? `$${(n / 1e12).toFixed(2)}T`
      : n >= 1e9
      ? `$${(n / 1e9).toFixed(2)}B`
      : `$${n.toFixed(2)}`;

  return {
    title: "Crypto Market Report — BTC | ETH | XLM",
    prompt,
    generatedAt: new Date().toISOString(),
    dataSource: source,
    summary: {
      sentiment,
      avgChange: `${avgChange}%`,
      totalMarketCap: formatUSD(totalMarketCap),
      topPerformer: `${topPerformer.name} (+${topPerformer.change.toFixed(
        2
      )}%)`,
      worstPerformer: `${lastPerformer.name} (${lastPerformer.change.toFixed(
        2
      )}%)`,
    },
    assets: {
      bitcoin: {
        price: `$${data.bitcoin.usd.toLocaleString()}`,
        change24h: `${data.bitcoin.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.bitcoin.usd_market_cap),
        dominance: `${dominance.bitcoin}%`,
        signal: signals.bitcoin,
      },
      ethereum: {
        price: `$${data.ethereum.usd.toLocaleString()}`,
        change24h: `${data.ethereum.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.ethereum.usd_market_cap),
        dominance: `${dominance.ethereum}%`,
        signal: signals.ethereum,
      },
      stellar: {
        price: `$${data.stellar.usd.toLocaleString()}`,
        change24h: `${data.stellar.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.stellar.usd_market_cap),
        dominance: `${dominance.stellar}%`,
        signal: signals.stellar,
      },
    },
    conclusion:
      `Market is ${sentiment}. ` +
      `Average 24h change across tracked assets is ${avgChange}%. ` +
      `${topPerformer.name.toUpperCase()} leads performance. ` +
      `Signals: BTC ${signals.bitcoin} | ETH ${signals.ethereum} | XLM ${signals.stellar}.`,
  };
}

// ── SIGN (UNCHANGED) ──────────────────────────────────────
function signResult(jobId, output) {
  const outputHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex");

  const payloadToSign = { jobId, outputHash };

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

// ── ROUTE HANDLER (FIXED WIRING ONLY) ────────────────────
export async function handleReport(req, res) {
  const {
    prompt,
    jobId,
    traceId,
    challenge,
    researchOutput,
    computeOutput,
    computeProof,
  } = req.body || {};

  // ── BASIC GATE CHECK (UNCHANGED) ──────────────────────
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

  // ── 🔥 NEW SAFE WIRING GUARD (ONLY ADDITION) ───────────
  if (!researchOutput || !computeOutput || !computeProof) {
    return res.status(400).json({
      error: "Invalid pipeline input",
      message:
        "Missing researchOutput / computeOutput / computeProof from PM",
    });
  }

  // ── VERIFY COMPUTE INTEGRITY (UNCHANGED) ──────────────
  if (!verifyComputeProof(computeOutput, computeProof)) {
    return res.status(403).json({
      error: "Invalid upstream data",
      message: "Compute proof verification failed",
    });
  }

  console.log(`[REPORT] Verified compute proof ✓ | Job: ${jobId}`);

  // ── EXECUTE (UNCHANGED) ───────────────────────────────
  const report = generateReport(prompt, researchOutput, computeOutput);

  console.log(
    `[REPORT] Report generated ✓ | Sentiment: ${report.summary.sentiment}`
  );

  // ── SIGN (UNCHANGED) ──────────────────────────────────
  const proof = signResult(jobId, report);

  console.log(`[REPORT] Signed ✓ | ${proof.signature.slice(0, 16)}...`);

  // ── RESPOND ───────────────────────────────────────────
  return res.json({
    agent: "report",
    jobId,
    traceId,
    prompt,
    output: report,
    proof,
    timestamp: new Date().toISOString(),
  });
}