# Spike 003: Real agent repair transaction

## Question

**Given** the host/Git transaction proven by Spike 002, **when** a real configured Hermes model receives one bounded bug-fix item inside the maker worktree, **then** can the model inspect, edit, test, and commit the repair while the host independently verifies that exact commit, applies objective gates, persists digest-bound evidence, and records the canonical outcome without changing the original checkout?

## Verdict: PARTIAL

The first real provider-backed vertical slice succeeded:

```text
canonical claim
  -> failing base-commit preflight
  -> isolated maker Git worktree
  -> Hermes one-shot maker using the configured provider/model
  -> model-authored edit, tests, and one Git commit
  -> host verifies the commit is one child of the base and the maker tree is clean
  -> separate detached verifier worktree at that exact commit
  -> independent test plus post-test exact-HEAD and clean-tree gates
  -> digest-bound JSON evidence
  -> canonical pass record
```

This is the first proof in `agent-loop-core` that a real model can complete the approved claim-to-record transaction. It remains **PARTIAL**, not production-ready, because the target is still a small disposable fixture, the agent process is not filesystem/network sandboxed, interruption recovery and a real failed-first-attempt retry are unproved, and the implementation still lives under `spikes/` rather than a supported installable runtime.

## Runtime boundary

`lib/hermes-maker-runtime.mjs` invokes Hermes one-shot mode in the assigned maker worktree:

```text
hermes -z <bounded work item and invariants>
  --toolsets terminal,file
  --ignore-rules
  --usage-file <external temporary path>
```

The adapter:

- passes a small environment allowlist rather than inheriting the parent environment;
- intentionally preserves `HOME`/optional `HERMES_HOME` so Hermes can use its configured OAuth/provider credentials;
- refuses to start unless the caller explicitly acknowledges this unsandboxed credential access;
- excludes arbitrary parent secrets such as the test sentinel;
- stores usage evidence outside the target worktree;
- bounds execution to five minutes and 1 MiB of captured output;
- requires a zero exit status and a bounded, schema-validated usage report;
- persists only a digest and byte count for model output, not raw stdout/stderr.

The host—not the model—then requires tests to pass, exactly one non-merge child commit, an approved changed-path allowlist, a clean maker worktree, exact-commit verification in a separate worktree, post-test original-checkout integrity, objective gates, and canonical evidence/recording. It rejects pre-existing maker branches before claim, deletes only a branch created by the current run, and sanitizes untrusted failure text before evidence or dispatch logging.

`HOME` access means the agent process can read user-level configuration and credentials required for inference. This is not a security sandbox. Use only disposable repositories and non-production credentials until a stronger filesystem/network boundary exists.

## Files

```text
spikes/003-real-agent-repair/
├── README.md
├── package.json
├── demo.mjs
├── lib/
│   └── hermes-maker-runtime.mjs
└── tests/
    └── hermes-maker-runtime.test.mjs
```

Spike 002's transaction harness now accepts an optional `makerExecutor`. With no executor it retains the deterministic Spike 002 path; with the Hermes executor the real agent must create the commit itself. The host still owns every trusted transaction boundary.

## Run

From this directory:

```bash
npm test
npm run demo
```

`npm run demo` preserves its disposable root and prints it as `demoRoot` for independent inspection. It uses the currently configured Hermes model/provider unless these optional environment values are set:

```bash
AGENT_LOOP_MAKER_MODEL=<model>
AGENT_LOOP_MAKER_PROVIDER=<provider>
```

The demo performs no push, merge, deployment, or remote Git operation.

## Verified live evidence

A final live run against the exact current code produced:

- demo root: `/tmp/agent-loop-spike-003-live-g7Zkkp`;
- run ID: `run-spike-003-1785146453732`;
- provider/model: `openai-codex` / `gpt-5.6-sol`;
- provider calls: `9`;
- base commit: `78b2e86b85d990149fd46c6934d7da89174f468f`;
- preflight: expected failure, exit code `1`;
- maker branch: `agent-loop/run-spike-003-1785146453732-maker`;
- maker commit: `d3fd6884861781b206a981f35126d609863456e4`;
- maker parent: exactly the base commit;
- maker commit shape: one non-merge child and one reachable commit after base;
- changed paths: exactly approved `src/add.mjs`;
- artifact ID: `6aecb923436fea0e06b0c1c8fb7ef60eba85caa98ff4f484efa3fdf9ab834e8d`;
- verifier identity: `independent-git-worktree`;
- verifier commit: exactly the maker commit;
- verifier result: pass, score `1`, exit code `0`;
- objective gates: exact verifier HEAD, clean verifier tree, original HEAD, original clean tree, and tests all passed;
- original checkout: remained clean at the broken base commit;
- canonical outcome: `pass`;
- evidence: `orchestrator/evidence/run-spike-003-1785146453732.json`;
- evidence SHA-256: `a3764c6ba18c611bbce77f1ecd7e66f9fd9d72ebb0ebe780e6cb30fa0f022eb5`.

Automated verification:

- Spike 003 tests: **10/10 passed**;
- Spike 002 regression tests: **9/9 passed**;
- Spike 001 reducer tests: **5/5 passed**;
- complete host machinery suite: **all good**.

## What remains

1. Move the validated transaction and runtime adapter out of `spikes/` into supported product code.
2. Separate versioned runtime, target-repository configuration, mutable state/evidence, and maker/verifier workspaces.
3. Run a supervised repair against a more realistic disposable application.
4. Exercise a failed first real attempt followed by a distinct second maker commit.
5. Add idempotent interruption recovery after claim, maker commit, verification, evidence persistence, and canonical recording.
6. Add a real filesystem/network sandbox before executing untrusted repositories or tests.
7. Add runtime/provider capability checks to an `agent-loop doctor` command.

Do not add more pipeline types, automatic push/merge, deployment, or production credentials before this vertical slice is productized and recovery-tested.
