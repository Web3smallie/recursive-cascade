// ============================================================
// PMAGENT.JS — FINAL STABLE AUTONOMOUS VERSION (FIXED)
// ============================================================

import "dotenv/config";
import fetch  from "node-fetch";
import crypto from "crypto";

import {
  initEscrow,
  addSubJob,
  submitWork,
  verifyWork,
  cascadeSettle,
} from "./soroban_client.js";

import { generateChallenge, validateChallenge } from "./x402_mpp.js";
import { broadcast } from "./eventBus.js";

const RESEARCH_URL = `http://localhost:${process.env.RESEARCH_PORT || 3001}`;

// 🔥 FIXED AMOUNTS
const RESEARCH_FEE = 0.01;
const COMPUTE_FEE  = 0.01;
const REPORT_FEE   = 0.01;

const PM_WALLET    = "GA3XRESRXJJYL7EB6IOA2FQF32X7NVCTEWVW566HWH7JTLERO6CQYCRS";
const TOTAL_BUDGET = 0.05;

const WALLETS = {
  research: "GBGNI276S2UV5VOGDJGNVNKMKU2UNQYLNE56JBLTQDDRHLP2NIOS5OHX",
  compute:  "GAE2GF2ZFG4DTJB62W45AMOTPLX7U3XWCLE7SOXBOYSA6DLK73SVNG65",
  report:   "GCYGPJFCW2SND4GAG5KAONPC3QWEH2VB7NRZ264QXUORFF35FZV3MIP6",
};

function emit(broadcastFn, traceId, payload) {
  const fn = broadcastFn || broadcast;
  fn({ ...payload, timestamp: new Date().toISOString() }, traceId);
}

export async function runPMAgent(prompt, broadcastFn, traceId) {

  try {
    // ── INIT ESCROW ──
    emit(broadcastFn, traceId, {
      type: "pm",
      agent: "pm",
      status: "init",
      message: "[PM] Initializing Escrow...",
    });

    // 🔥 FIXED (NO TRY/CATCH)
    await initEscrow(PM_WALLET, PM_WALLET, TOTAL_BUDGET);

    // ── CREATE JOBS ──
    const researchJob = await addSubJob(WALLETS.research, RESEARCH_FEE, null);
    const researchJobId = researchJob.jobId;

    const computeJob = await addSubJob(WALLETS.compute, COMPUTE_FEE, researchJobId);
    const computeJobId = computeJob.jobId;

    const reportJob = await addSubJob(WALLETS.report, REPORT_FEE, computeJobId);
    const reportJobId = reportJob.jobId;

    // ── RESEARCH AGENT ──
    const challenge = await generateChallenge(
      WALLETS.research,
      RESEARCH_FEE,
      researchJobId,
      "testnet"
    );

    if (!validateChallenge(challenge)) {
      throw new Error("Invalid challenge");
    }

    const response = await fetch(`${RESEARCH_URL}/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        jobId: researchJobId,
        computeJobId,
        reportJobId,
        traceId,
        challenge,
      }),
    });

    if (!response.ok) {
      throw new Error(`Research failed`);
    }

    const researchResult = await response.json();

    // ── VERIFY WORK ──
    const allResults = [
      { jobId: researchJobId, result: researchResult.output, wallet: WALLETS.research },
      { jobId: computeJobId,  result: researchResult.computeResult?.output, wallet: WALLETS.compute },
      { jobId: reportJobId,   result: researchResult.computeResult?.reportResult?.output, wallet: WALLETS.report },
    ];

    for (const item of allResults) {
      if (!item.result) continue;

      const hash = crypto
        .createHash("sha256")
        .update(JSON.stringify(item.result))
        .digest("hex");

      await submitWork(item.jobId, hash, item.wallet);
      await verifyWork(item.jobId, PM_WALLET);

      await new Promise(r => setTimeout(r, 200));
    }

    // ── SETTLEMENT ──
    await cascadeSettle(PM_WALLET);

    return { traceId, success: true };

  } catch (err) {
    broadcast({
      type: "error",
      agent: "pm",
      message: err.message,
      timestamp: new Date().toISOString(),
    }, traceId);

    throw err;
  }
}