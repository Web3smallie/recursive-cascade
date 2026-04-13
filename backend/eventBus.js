// ============================================================
// EVENTBUS.JS — Recursive Cascade
// ============================================================

const clients = [];
let sequence = 0;

const HEARTBEAT_INTERVAL = 15000;
const SWEEP_INTERVAL = 30000;

// ── PERIODIC SWEEP ─────────────────────────────────────────
setInterval(() => {
  const snapshot = [...clients];

  for (const res of snapshot) {
    try {
      res.write(`: sweep\n\n`);
    } catch {
      removeClient(res);
    }
  }
}, SWEEP_INTERVAL);

// ── REGISTER CLIENT ───────────────────────────────────────
export function registerClient(req, res) {
  if (!req || !res) return;
  if (typeof res.write !== "function") return;

  clients.push(res);

  let heartbeatCleared = false;

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      heartbeatCleared = true;
      removeClient(res);
    }
  }, HEARTBEAT_INTERVAL);

  req.on("close", () => {
    if (!heartbeatCleared) {
      clearInterval(heartbeat);
      heartbeatCleared = true;
    }
    removeClient(res);
  });
}

// ── REMOVE CLIENT ─────────────────────────────────────────
function removeClient(res) {
  const index = clients.indexOf(res);
  if (index !== -1) clients.splice(index, 1);
}

// ── BROADCAST ─────────────────────────────────────────────
export function broadcast(log, traceId = null) {
  const enriched = {
    ...(log || {}),
    timestamp: new Date().toISOString(),
    seq: ++sequence,
    ...(traceId ? { traceId } : {}),
  };

  if (clients.length === 0) return;

  const data = `data: ${JSON.stringify(enriched)}\n\n`;
  const snapshot = [...clients];

  for (const res of snapshot) {
    try {
      if (res && typeof res.write === "function") {
        res.write(data);
      }
    } catch {
      removeClient(res);
    }
  }
}