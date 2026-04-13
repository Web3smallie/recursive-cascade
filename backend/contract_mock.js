// ============================================================
// CONTRACT MOCK — Recursive Cascade
// ============================================================

const state = {
  initialized: false,
  client:      null,
  parentAgent: null,
  token:       "USDC",
  totalDeposit: 0,
  allocated:   0,
  settled:     false,
  deadline:    null,
  jobs:        [],
};

export function initEscrow(client, parentAgent, amount) {
  if (state.initialized) throw new Error("Escrow already initialized");

  state.initialized  = true;
  state.client       = client;
  state.parentAgent  = parentAgent;
  state.totalDeposit = amount;
  state.allocated    = 0;
  state.settled      = false;
  state.deadline     = Date.now() + 7 * 24 * 60 * 60 * 1000;
  state.jobs         = [];

  return { success: true, totalDeposit: amount };
}

export function addSubJob(provider, amount, parentJobId = null) {
  if (!state.initialized) throw new Error("Escrow not initialized");
  if (state.settled)      throw new Error("Escrow already settled");

  const newAllocated = state.allocated + amount;
  if (newAllocated > state.totalDeposit) {
    throw new Error(`Allocation overflow: ${newAllocated} > ${state.totalDeposit}`);
  }

  if (parentJobId !== null) {
    const parentJob = state.jobs.find(j => j.id === parentJobId);
    if (!parentJob) throw new Error(`Parent job ${parentJobId} not found`);
    if (amount > parentJob.amount) {
      throw new Error(`Child allocation ${amount} exceeds parent budget ${parentJob.amount}`);
    }
  }

  const job = {
    id:          state.jobs.length,
    provider,
    amount,
    jobHash:     null,
    submitted:   false,
    verified:    false,
    parentJobId,
    depth:       parentJobId === null
                   ? 0
                   : (state.jobs.find(j => j.id === parentJobId)?.depth ?? 0) + 1,
    completedAt: null,
  };

  state.jobs.push(job);
  state.allocated = newAllocated;

  return { success: true, jobId: job.id, depth: job.depth };
}

export function submitWork(jobId, jobHash, provider) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job)                      throw new Error(`Job ${jobId} not found`);
  if (job.submitted)             throw new Error(`Job ${jobId} already submitted`);
  if (job.provider !== provider) throw new Error(`Wrong provider for job ${jobId}`);

  job.jobHash   = jobHash;
  job.submitted = true;

  return { success: true, jobId, jobHash };
}

export function verifyWork(jobId, caller) {
  if (caller !== state.parentAgent) throw new Error("Unauthorized");

  const job = state.jobs.find(j => j.id === jobId);
  if (!job)           throw new Error(`Job ${jobId} not found`);
  if (!job.submitted) throw new Error(`Job ${jobId} not submitted yet`);
  if (job.verified)   throw new Error(`Job ${jobId} already verified`);

  job.verified    = true;
  job.completedAt = Date.now();

  return { success: true, jobId, depth: job.depth, completedAt: job.completedAt };
}

export function cascadeSettle(caller) {
  if (caller !== state.parentAgent) throw new Error("Unauthorized");
  if (state.settled)                throw new Error("Already settled");

  for (const job of state.jobs) {
    if (!job.verified) {
      throw new Error(`Job ${job.id} (${job.provider}) is not verified`);
    }
  }

  const payouts = state.jobs.map(job => ({
    provider:    job.provider,
    amount:      job.amount,
    jobId:       job.id,
    depth:       job.depth,
    completedAt: job.completedAt,
  }));

  const margin = state.totalDeposit - state.allocated;
  if (margin > 0) {
    payouts.push({
      provider: state.parentAgent,
      amount:   margin,
      jobId:    "margin",
      depth:    0,
    });
  }

  state.settled = true;

  return { success: true, payouts, totalSettled: state.totalDeposit };
}

export function getState() {
  return { ...state };
}

export function isJobFunded(provider) {
  return state.jobs.some(j => j.provider === provider);
}

export function resetEscrow() {
  state.initialized = false;
  state.client      = null;
  state.parentAgent = null;
  state.totalDeposit = 0;
  state.allocated   = 0;
  state.settled     = false;
  state.deadline    = null;
  state.jobs        = [];
}