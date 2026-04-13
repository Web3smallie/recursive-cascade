// ============================================================
// REPORT-SERVER.JS — Recursive Cascade
// ============================================================

import "dotenv/config";
import express from "express";
import crypto  from "crypto";
import { validateChallenge } from "./backend/x402_mpp.js";

const app  = express();
const PORT = process.env.REPORT_PORT || 3003;

const AGENT_ID     = "REPORT_WALLET_ADDRESS";
const AGENT_SECRET = process.env.REPORT_AGENT_SECRET || "report-agent-secret-phase1";

app.use(express.json());

// ── VERIFY COMPUTE PROOF ──────────────────────────────────
function verifyComputeProof(computeOutput, computeProof) {
  if (!computeProof?.payloadToSign) return false;

  const expectedHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(computeOutput))
    .digest("hex");

  return computeProof.payloadToSign.outputHash === expectedHash;
}

// ── GENERATE REPORT ───────────────────────────────────────
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

  const topPerformer  = ranked[0];
  const lastPerformer = ranked[ranked.length - 1];

  const formatUSD = (n) =>
    n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` :
    n >= 1e9  ? `$${(n / 1e9).toFixed(2)}B`  :
    `$${n.toFixed(2)}`;

  return {
    title:       "Crypto Market Report — BTC | ETH | XLM",
    prompt,
    generatedAt: new Date().toISOString(),
    dataSource:  source,
    summary: {
      sentiment,
      avgChange:      `${avgChange}%`,
      totalMarketCap: formatUSD(totalMarketCap),
      topPerformer:   `${topPerformer.name} (+${topPerformer.change.toFixed(2)}%)`,
      worstPerformer: `${lastPerformer.name} (${lastPerformer.change.toFixed(2)}%)`,
    },
    assets: {
      bitcoin: {
        price:     `$${data.bitcoin.usd.toLocaleString()}`,
        change24h: `${data.bitcoin.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.bitcoin.usd_market_cap),
        dominance: `${dominance.bitcoin}%`,
        signal:    signals.bitcoin,
      },
      ethereum: {
        price:     `$${data.ethereum.usd.toLocaleString()}`,
        change24h: `${data.ethereum.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.ethereum.usd_market_cap),
        dominance: `${dominance.ethereum}%`,
        signal:    signals.ethereum,
      },
      stellar: {
        price:     `$${data.stellar.usd.toLocaleString()}`,
        change24h: `${data.stellar.usd_24h_change.toFixed(2)}%`,
        marketCap: formatUSD(data.stellar.usd_market_cap),
        dominance: `${dominance.stellar}%`,
        signal:    signals.stellar,
      },
    },
    conclusion:
      `Market is ${sentiment}. ` +
      `Average 24h change: ${avgChange}%. ` +
      `${topPerformer.name.toUpperCase()} leads. ` +
      `Signals: BTC ${signals.bitcoin} | ETH ${signals.ethereum} | XLM ${signals.stellar}.`,
  };
}

// ── SIGN RESULT ───────────────────────────────────────────
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

  return { agentId: AGENT_ID, signature, payloadToSign };
}

// ── ROUTE: POST /report ───────────────────────────────────
app.post("/report", async (req, res) => {
  const {
    prompt,
    jobId,
    traceId = "no-trace",
    challenge,
    researchOutput,
    computeOutput,
    computeProof,
  } = req.body || {};

  // ── x402 GATE ─────────────────────────────────────────
  if (!challenge || !challenge.payload) {
    console.log(JSON.stringify({
      type: "error",
      agent: "report",
      status: "no_challenge",
      traceId,
      message: "Missing x402 challenge",
    }));

    return res.status(402).json({
      error: "Payment required",
      agent: "report",
      amount: 0.7,
    });
  }

  // ✅ FIX: FULL VALIDATION
  if (!validateChallenge(challenge)) {
    console.log(JSON.stringify({
      type: "error",
      agent: "report",
      status: "invalid_challenge",
      traceId,
      message: "Invalid x402 challenge",
    }));

    return res.status(402).json({
      error: "Invalid payment challenge",
    });
  }

  if (challenge.payload.jobId !== jobId) {
    return res.status(402).json({
      error: "Challenge jobId mismatch",
    });
  }

  // ── PIPELINE GUARD ────────────────────────────────────
  if (!researchOutput || !computeOutput || !computeProof) {
    return res.status(400).json({
      error: "Missing pipeline data",
    });
  }

  // ── VERIFY COMPUTE PROOF ──────────────────────────────
  if (!verifyComputeProof(computeOutput, computeProof)) {
    return res.status(403).json({
      error: "Compute proof invalid",
    });
  }

  console.log(JSON.stringify({
    type: "agent",
    agent: "report",
    status: "executing",
    traceId,
    message: "Report agent executing",
  }));

  // ── EXECUTE ───────────────────────────────────────────
  const report = generateReport(prompt, researchOutput, computeOutput);

  // ── SIGN ──────────────────────────────────────────────
  const proof = signResult(jobId, report);

  console.log(JSON.stringify({
    type: "agent",
    agent: "report",
    status: "done",
    traceId,
    message: "Report generated and signed",
  }));

  return res.json({
    agent:     "report",
    jobId,
    traceId,
    prompt,
    output:    report,
    proof,
    timestamp: new Date().toISOString(),
  });
});

// ── BOOT ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[REPORT AGENT] Running on http://localhost:${PORT}`);
});