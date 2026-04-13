#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    symbol_short, Address, Bytes, Env, Symbol, Vec,
    token::Client as TokenClient,
};

// ── Storage ─────────────────────────────────────────────
const ESCROW_KEY: Symbol = symbol_short!("ESCROW");
const JOBS_KEY:   Symbol = symbol_short!("JOBS");
const JOB_CNT:    Symbol = symbol_short!("JOBCNT");
const TOKEN_KEY:  Symbol = symbol_short!("TOKEN");

// 🔥 NEW: Cycle Counter
const CYCLE_KEY:  Symbol = symbol_short!("CYCLE");

// ── Types ───────────────────────────────────────────────
#[contracttype]
#[derive(Clone)]
pub struct EscrowState {
    pub client:        Address,
    pub parent_agent:  Address,
    pub total_deposit: i128,
    pub allocated:     i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub id:        u32,
    pub provider:  Address,
    pub amount:    i128,
    pub job_hash:  Bytes,
    pub submitted: bool,
    pub verified:  bool,
    pub parent_id: i64,
    pub depth:     u32,
}

// ── Contract ────────────────────────────────────────────
#[contract]
pub struct RecursiveCascade;

#[contractimpl]
impl RecursiveCascade {

    // 🔥 INIT — now tracks cycle
    pub fn init_escrow(
        env:           Env,
        client:        Address,
        parent_agent:  Address,
        token:         Address,
        total_deposit: i128,
    ) {
        client.require_auth();

        let contract_addr = env.current_contract_address();
        let token_client  = TokenClient::new(&env, &token);

        let balance = token_client.balance(&contract_addr);

        if balance < total_deposit {
            token_client.transfer(&client, &contract_addr, &total_deposit);
        }

        // 🔥 INCREMENT CYCLE
        let mut cycle: u32 = env.storage().instance().get(&CYCLE_KEY).unwrap_or(0);
        cycle += 1;
        env.storage().instance().set(&CYCLE_KEY, &cycle);

        env.storage().instance().set(&TOKEN_KEY, &token);
        env.storage().instance().set(&ESCROW_KEY, &EscrowState {
            client,
            parent_agent,
            total_deposit,
            allocated: 0,
        });

        env.storage().instance().set(&JOB_CNT, &0u32);
        env.storage().instance().set(&JOBS_KEY, &Vec::<Job>::new(&env));
    }

    pub fn add_sub_job(
        env:           Env,
        provider:      Address,
        amount:        i128,
        parent_job_id: i64,
    ) -> u32 {

        let mut escrow: EscrowState =
            env.storage().instance().get(&ESCROW_KEY).unwrap();

        let mut jobs: Vec<Job> =
            env.storage().instance().get(&JOBS_KEY).unwrap_or(Vec::new(&env));

        let depth: u32 = if parent_job_id < 0 {
            0
        } else {
            let mut parent_depth = 0;

            for i in 0..jobs.len() {
                let j = jobs.get(i).unwrap();
                if j.id == parent_job_id as u32 {
                    parent_depth = j.depth;
                    break;
                }
            }

            parent_depth + 1
        };

        let job_cnt: u32 =
            env.storage().instance().get(&JOB_CNT).unwrap_or(0);

        jobs.push_back(Job {
            id: job_cnt,
            provider,
            amount,
            job_hash: Bytes::new(&env),
            submitted: false,
            verified: false,
            parent_id: parent_job_id,
            depth,
        });

        escrow.allocated += amount;

        env.storage().instance().set(&JOBS_KEY, &jobs);
        env.storage().instance().set(&ESCROW_KEY, &escrow);
        env.storage().instance().set(&JOB_CNT, &(job_cnt + 1));

        job_cnt
    }

    pub fn submit_work(
        env: Env,
        job_id: u32,
        job_hash: Bytes,
        _provider: Address,
    ) {

        let mut jobs: Vec<Job> =
            env.storage().instance().get(&JOBS_KEY).unwrap_or(Vec::new(&env));

        for i in 0..jobs.len() {
            let mut job = jobs.get(i).unwrap();

            if job.id == job_id {
                job.job_hash  = job_hash;
                job.submitted = true;
                jobs.set(i, job);
                break;
            }
        }

        env.storage().instance().set(&JOBS_KEY, &jobs);
    }

    pub fn verify_work(
        env: Env,
        job_id: u32,
        caller: Address,
    ) {

        caller.require_auth();

        let mut jobs: Vec<Job> =
            env.storage().instance().get(&JOBS_KEY).unwrap_or(Vec::new(&env));

        for i in 0..jobs.len() {
            let mut job = jobs.get(i).unwrap();

            if job.id == job_id {
                job.verified = true;
                jobs.set(i, job);
                break;
            }
        }

        env.storage().instance().set(&JOBS_KEY, &jobs);
    }

    pub fn cascade_settle(
        env: Env,
        caller: Address,
    ) {

        caller.require_auth();

        let escrow: EscrowState =
            env.storage().instance().get(&ESCROW_KEY).unwrap();

        let mut jobs: Vec<Job> =
            env.storage().instance().get(&JOBS_KEY).unwrap_or(Vec::new(&env));

        let token: Address =
            env.storage().instance().get(&TOKEN_KEY).unwrap();

        let token_client = TokenClient::new(&env, &token);
        let contract_addr = env.current_contract_address();

        for i in 0..jobs.len() {
            let job = jobs.get(i).unwrap();

            if job.verified && job.amount > 0 {
                token_client.transfer(&contract_addr, &job.provider, &job.amount);

                let mut updated = job.clone();
                updated.amount = 0;
                jobs.set(i, updated);
            }
        }

        env.storage().instance().set(&JOBS_KEY, &jobs);

        let margin = escrow.total_deposit - escrow.allocated;
        if margin > 0 {
            token_client.transfer(&contract_addr, &escrow.parent_agent, &margin);
        }
    }
}