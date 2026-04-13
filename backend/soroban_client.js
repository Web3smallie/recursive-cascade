// ============================================================
// SOROBAN_CLIENT.JS — Replaces contract_mock.js
// Real USDC transfer on Stellar testnet (FINAL FINAL FIXED)
// ============================================================

import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";

// ── Config ────────────────────────────────────────────────────────
const RPC_URL      = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID  = process.env.CONTRACT_ID;
const USDC_SAC     = process.env.USDC_CONTRACT_ID || "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const NETWORK      = Networks.TESTNET;
const PM_KEYPAIR   = Keypair.fromSecret(process.env.PM_SECRET_KEY);
const server       = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// ── Debug ─────────────────────────────────────────────────────────
console.log(`[DEBUG] CONTRACT_ID → ${CONTRACT_ID}`);

// ── Core invoke ───────────────────────────────────────────────────
async function invoke(method, args = []) {
  const account  = await server.getAccount(PM_KEYPAIR.publicKey());
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed [${method}]: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(PM_KEYPAIR);

  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submit failed [${method}]: ${JSON.stringify(sendResult.errorResult)}`);
  }

  console.log(`[TX] ${method}: https://stellar.expert/explorer/testnet/tx/${sendResult.hash}`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));

    const status = await server.getTransaction(sendResult.hash);
    console.log(`[TX STATUS] ${method}:`, status.status);

    if (status.status === "SUCCESS") {
      return status.returnValue ? scValToNative(status.returnValue) : true;
    }

    if (status.status === "FAILED") {
      throw new Error(`Transaction failed [${method}]: ${JSON.stringify(status)}`);
    }
  }

  throw new Error(`Transaction timeout [${method}]`);
}

// ── i128 helper ───────────────────────────────────────────
function i128(amount) {
  const stroops = BigInt(Math.round(amount * 1e7));
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: xdr.Int64.fromString("0"),
    lo: xdr.Uint64.fromString(stroops.toString()),
  }));
}

// ── Safe hash helper ──────────────────────────────────────
function safeHashToBytes(hash) {
  const padded = hash.padStart(64, "0");
  return Buffer.from(padded, "hex");
}

// ── USDC APPROVAL (FINAL FIX) ─────────────────────────────
async function approveUSDC(amount) {
  const account = await server.getAccount(PM_KEYPAIR.publicKey());

  // ✅ FIX: dynamic expiry
  const latestLedger = await server.getLatestLedger();
  const liveUntil = latestLedger.sequence + 1000;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      new Contract(USDC_SAC).call(
        "approve",
        nativeToScVal(PM_KEYPAIR.publicKey(), { type: "address" }),
        nativeToScVal(CONTRACT_ID,            { type: "address" }),
        i128(amount),
        xdr.ScVal.scvU32(liveUntil) // ✅ FIXED
      )
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`USDC approve failed: ${sim.error}`);
  }

  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(PM_KEYPAIR);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    throw new Error(`USDC approve submit failed`);
  }

  console.log(`[TX] approve: https://stellar.expert/explorer/testnet/tx/${sendResult.hash}`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));

    const status = await server.getTransaction(sendResult.hash);
    console.log(`[TX STATUS] approve:`, status.status);

    if (status.status === "SUCCESS") {
      console.log(`[TX] approve confirmed ✅`);
      return;
    }

    if (status.status === "FAILED") {
      throw new Error(`USDC approve transaction failed`);
    }
  }

  throw new Error(`USDC approve timeout`);
}

// ── Local mirror ──────────────────────────────────────────
const _state = {
  jobs:         [],
  totalDeposit: 0,
  allocated:    0,
  parentAgent:  null,
};

// ── EXPORTS ───────────────────────────────────────────────
export async function initEscrow(client, parentAgent, amount) {

  await approveUSDC(amount);

  _state.jobs         = [];
  _state.totalDeposit = amount;
  _state.allocated    = 0;
  _state.parentAgent  = parentAgent;

  await invoke("init_escrow", [
    nativeToScVal(client,      { type: "address" }),
    nativeToScVal(parentAgent, { type: "address" }),
    nativeToScVal(USDC_SAC,    { type: "address" }),
    i128(amount),
  ]);

  return { success: true, totalDeposit: amount };
}

export async function addSubJob(provider, amount, parentJobId = null) {
  const parentId = parentJobId === null ? -1 : parentJobId;

  const jobId = await invoke("add_sub_job", [
    nativeToScVal(provider, { type: "address" }),
    i128(amount),
    xdr.ScVal.scvI64(xdr.Int64.fromString(String(parentId))),
  ]);

  let depth = 0;
  if (parentJobId !== null) {
    const parent = _state.jobs.find(j => j.jobId === parentJobId);
    depth = parent ? parent.depth + 1 : 0;
  }

  _state.jobs.push({ jobId, provider, amount, depth });
  _state.allocated += amount;

  return { success: true, jobId, depth };
}

export async function submitWork(jobId, jobHash, provider) {
  const hashBytes = safeHashToBytes(jobHash);

  await invoke("submit_work", [
    xdr.ScVal.scvU32(jobId),
    xdr.ScVal.scvBytes(hashBytes),
    nativeToScVal(provider, { type: "address" }),
  ]);

  return { success: true, jobId, jobHash };
}

export async function verifyWork(jobId, caller) {
  await invoke("verify_work", [
    xdr.ScVal.scvU32(jobId),
    nativeToScVal(PM_KEYPAIR.publicKey(), { type: "address" }),
  ]);

  return { success: true, jobId };
}

export async function cascadeSettle(caller) {
  await invoke("cascade_settle", [
    nativeToScVal(PM_KEYPAIR.publicKey(), { type: "address" }),
  ]);

  const payouts = _state.jobs.map(j => ({
    provider:    j.provider,
    amount:      j.amount,
    jobId:       j.jobId,
    depth:       j.depth,
    completedAt: Date.now(),
  }));

  const margin = _state.totalDeposit - _state.allocated;
  if (margin > 0) {
    payouts.push({
      provider:    _state.parentAgent,
      amount:      margin,
      jobId:       "margin",
      depth:       0,
      completedAt: Date.now(),
    });
  }

  return { success: true, payouts, totalSettled: _state.totalDeposit };
}

export function resetEscrow() {
  _state.jobs         = [];
  _state.totalDeposit = 0;
  _state.allocated    = 0;
  _state.parentAgent  = null;
}