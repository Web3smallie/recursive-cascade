// ============================================================
// SERVER.JS — Recursive Cascade (FIXED FINAL SAFE)
// ============================================================

import "dotenv/config";
import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import { runPMAgent } from "./backend/pmAgent.js";
import { startClientLoop } from "./backend/agents/clientAgent.js";
import { registerClient, broadcast } from "./backend/eventBus.js";

const app = express();
const PORT = 3000;

const DEMO_SECRET = process.env.DEMO_SECRET;

// FIX 1: safe loop interval parsing
const LOOP_INTERVAL_RAW = parseInt(process.env.LOOP_INTERVAL || "30000", 10);
const LOOP_INTERVAL =
  Number.isFinite(LOOP_INTERVAL_RAW) && LOOP_INTERVAL_RAW > 0
    ? LOOP_INTERVAL_RAW
    : 30000;

if (!DEMO_SECRET) {
  console.error("Missing DEMO_SECRET");
  process.exit(1);
}

// FIX 2: proper ESM __dirname safety
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

// ── SSE ─────────────────────────────────────────────
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  registerClient(req, res);
});


// ── INTERNAL LOG ROUTE ────────────────────────────────────
// Receives structured logs from agent processes
// and broadcasts them to the dashboard via SSE
app.post("/internal-log", (req, res) => {
  const log = req.body;
  if (log && log.type) {
    broadcast(log, log.traceId || null);
  }
  res.json({ ok: true });
});

// ── START JOB ────────────────────────────────────────
let jobRunning = false;

app.post("/start-job", async (req, res) => {
  const { prompt, secret } = req.body || {};

  if (secret !== DEMO_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (jobRunning) {
    return res.status(429).json({ error: "Job running" });
  }

  jobRunning = true;
  const traceId = crypto.randomUUID();

  try {
    broadcast(
      { type: "system", message: `[CLIENT] ${String(prompt || "")}` },
      traceId
    );

    const result = await runPMAgent(prompt, broadcast, traceId);

    return res.json({
      success: true,
      result,
      traceId
    });

  } catch (err) {
    broadcast(
      { type: "error", message: err?.message || "Unknown error" },
      traceId
    );

    return res.status(500).json({
      error: err?.message || "Server error",
      traceId
    });

  } finally {
    jobRunning = false;
  }
});

// ── BOOT ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);

  if (process.env.AUTO_CLIENT === "true") {
    startClientLoop(LOOP_INTERVAL);
  }
});