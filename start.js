// ============================================================
// START.JS — Recursive Cascade Launcher (FORK VERSION)
// Starts all 4 servers. Forwards agent logs to PM dashboard.
// ============================================================

import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SERVICES = [
  { name: "PM",       file: "server.js",          color: "\x1b[36m", isPM: true  },
  { name: "RESEARCH", file: "research-server.js",  color: "\x1b[32m", isPM: false },
  { name: "COMPUTE",  file: "compute-server.js",   color: "\x1b[35m", isPM: false },
  { name: "REPORT",   file: "report-server.js",    color: "\x1b[33m", isPM: false },
];

const RESET   = "\x1b[0m";
const PM_PORT = process.env.PM_PORT || 3000;

// ── FORWARD LOG TO PM DASHBOARD ───────────────────────────
async function forwardLog(logData) {
  try {
    await fetch(`http://localhost:${PM_PORT}/internal-log`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(logData),
    });
  } catch {
    // PM not ready yet — ignore
  }
}

// ── START SERVICE ─────────────────────────────────────────
function startService({ name, file, color, isPM }) {
  const fullPath = path.join(__dirname, file);

  const proc = fork(fullPath, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  proc.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);

    for (const line of lines) {
      process.stdout.write(`${color}[${name}]${RESET} ${line}\n`);

      // Try to parse as structured log and forward to dashboard
      if (!isPM) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type && parsed.message) {
            forwardLog(parsed);
          }
        } catch {
          // Not JSON — ignore
        }
      }
    }
  });

  proc.stderr.on("data", (data) => {
    process.stderr.write(`\x1b[31m[${name} ERROR]\x1b[0m ${data}`);
  });

  proc.on("exit", (code) => {
    console.log(`\x1b[31m[${name}] exited with code ${code}\x1b[0m`);
  });

  return proc;
}

// ── START ALL ─────────────────────────────────────────────
console.log("\n🚀 Starting Recursive Cascade (Fork Mode)...\n");

const processes = SERVICES.map(startService);

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────
function shutdown() {
  console.log("\n🛑 Shutting down all services...\n");
  processes.forEach((proc) => {
    if (proc && !proc.killed) proc.kill("SIGINT");
  });
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);