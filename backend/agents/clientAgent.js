// ============================================================
// CLIENTAGENT.JS — FINAL STABLE AUTONOMOUS LOOP (5 MIN SAFE)
// ============================================================

import fetch from "node-fetch";

const BASE_URL    = "http://localhost:3000";
const DEMO_SECRET = process.env.DEMO_SECRET || "recursive-cascade-demo";

const PROMPT =
  "Generate a crypto market report on Bitcoin, Ethereum and Stellar";

// 🔥 PREVENT OVERLAP
let isRunning = false;

// ── FIRE JOB ─────────────────────────────────────────────
async function fireJob() {
  if (isRunning) {
    console.log("[CLIENT] Still running — skipping...");
    return;
  }

  isRunning = true;

  console.log(`[CLIENT] Autonomous run → "${PROMPT}"`);

  try {
    const response = await fetch(`${BASE_URL}/start-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: PROMPT,
        secret: DEMO_SECRET,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || `Server error`);
    }

    console.log(`[CLIENT] Job completed ✓ | TraceId: ${data.traceId}`);

  } catch (err) {
    console.log(`[CLIENT] Job failed: ${err.message}`);
  }

  isRunning = false;
}

// ── START LOOP ───────────────────────────────────────────
export function startClientLoop() {
  console.log("[CLIENT] Autonomous loop started (5 minutes)");

  fireJob(); // run immediately

  setInterval(() => {
    fireJob();
  }, 300000); // 5 minutes
}

// ── STOP LOOP ────────────────────────────────────────────
export function stopClientLoop() {
  console.log("[CLIENT] Loop stopped.");
}