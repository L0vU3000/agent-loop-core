# Spike 002: Real Git claim-to-record transaction

## Question

**Given** the canonical `agent-loop-core` dispatcher and the state contracts validated in Spike 001, **when** one disposable `bug-fix` item is executed against a real broken Git repository, **then** can the system atomically claim it, reproduce the defect, create a repair commit in an isolated maker worktree, verify that exact commit in a separate clean worktree, require objective gates, and record the canonical outcome with immutable evidence identities?

## Verdict: PARTIAL

The complete host transaction is validated for a deterministic repair fixture:

```text
canonical planDispatch()
  -> canonical claimItem()
  -> immutable run identity + work-item digest
  -> failing base-commit preflight
  -> isolated maker Git worktree
  -> real repair commit
  -> detached verifier Git worktree at the exact maker commit
  -> independent test result
  -> exact run/artifact/commit binding
  -> objective test, then post-test exact-HEAD + clean-tree gates
  -> append-only JSON evidence + SHA-256 binding
  -> canonical recordOutcome()
```

This closes the integration gap identified by Spike 001: claim, execution evidence, and record now happen in one transaction harness rather than in separately tested halves.

It is still **PARTIAL**, not production-ready, because the repair is performed by a deterministic fixture driver rather than an Eve session or real model. The two filesystem sandboxes are separate Git worktrees in one disposable repository, not independently provisioned security sandboxes. Crash/restart and retry behavior are not exercised here.

## Scope and safety

The spike:

- creates only temporary repositories under the operating system's temporary directory;
- uses the canonical dispatcher functions against a copied, disposable control-plane fixture;
- never modifies the live orchestrator inbox;
- creates no remote and the harness performs no fetch, push, merge, deployment, or intentional network call;
- uses no credentials and passes only an explicit environment allowlist into repository commands;
- disables global/system Git configuration, hooks, fsmonitor, signing, and interactive credential prompts for host-owned Git commands;
- bounds every Git/test subprocess to 30 seconds and 1 MiB of captured output;
- canonicalizes symlink aliases and rejects non-absolute, equal, or nested transaction roots before claim;
- rejects a pre-existing workspace root before claim;
- leaves the existing `spike/eve-bug-fix-runtime` branch untouched;
- keeps the VPS system Node runtime unchanged;
- uses only Node built-ins and Git.

## Files

```text
spikes/002-real-git-transaction/
├── README.md
├── package.json
├── demo.mjs
├── lib/
│   ├── fixture.mjs
│   └── run-transaction.mjs
└── tests/
    └── transaction.test.mjs
```

`lib/fixture.mjs` creates a disposable repository whose `add()` function subtracts and whose existing test expects addition. `lib/run-transaction.mjs` owns the host transaction and imports the Spike 001 reducer contracts rather than creating a second state machine.

## Immutable evidence model

The transaction returns deeply frozen evidence:

- **run:** schema version, run ID, item filename, pipeline, work-item SHA-256, base commit, and retry bound;
- **maker:** run ID, iteration, branch, commit, parent commit, artifact ID, and maker workspace;
- **verification:** run ID, artifact ID, exact commit, verifier identity/workspace, verdict, score, command, and exit code;
- **objective gate:** run ID, artifact ID, exact commit, plus exact-HEAD, clean-tree, and test checks;
- **record:** final outcome, canonical archive path, evidence path, and evidence SHA-256.

The artifact ID is SHA-256 over the immutable maker handoff fields. Before recording, `assertEvidenceBinding()` rejects any run-ID, artifact-ID, or commit mismatch. The complete evidence object is written once with exclusive-create semantics under `orchestrator/evidence/`; its digest is included in the canonical dispatch-log summary. The existing Spike 001 reducer separately requires verifier evidence to name the exact maker commit and requires both verifier and objective-gate pass before a pass may be recorded.

Unexpected failures after claim are recorded as `fail`, receive a separate failure-evidence file, and trigger forced removal/pruning of registered maker/verifier worktrees plus deletion of the disposable maker branch. This is compensation, not crash-atomicity: `recordOutcome()` still moves the archive and appends the log as two filesystem operations.

## Run

From this directory:

```bash
npm test
npm run demo
```

The demo deliberately preserves its temporary root and prints it as `demoRoot`, allowing inspection of both worktrees and the copied dispatcher archive. Remove that temporary directory after inspection.

## Verified evidence

A live demo run produced:

- run ID: `run-spike-002-1784870049323`;
- base commit: `59be5a832c7f21fe3d2d7045a047565cf5e094e9`;
- preflight: expected failure, exit code `1`;
- maker commit: `6efecbd0b745a10b0d96b6203614adc61193a46b`;
- artifact ID: `f453fa067300af4a432f4555089475d4fcd43ca656e71b98c350a3b5196cc83e`;
- verifier commit: exactly the maker commit;
- verifier result: pass, score `1`, exit code `0`;
- objective gates: exact HEAD, clean tree, and tests all passed;
- canonical record: `inbox/done/10-fix-add.md`, outcome `pass`;
- persisted evidence: `orchestrator/evidence/run-spike-002-1784870049323.json` with SHA-256 `dbac09aa99d4df1714e096e0345926da70fb436abc32c578ca42534eeadbe206`.

Automated verification:

- Spike 002 tests: **9/9 passed**;
- mismatch coverage: wrong run, artifact, and commit evidence are rejected;
- path-safety coverage: lexical nesting, symlink aliases, and filesystem-root ancestry are rejected before claim;
- environment-boundary coverage: a parent secret sentinel is absent from maker/verifier test processes;
- hostile-Git coverage: checked-in and inherited global configs plus pre-commit hooks are ignored during both fixture setup and transaction execution;
- adversarial objective-gate coverage: a passing test that dirties the verifier worktree records `fail`;
- failure-compensation coverage: unexpected errors record failure evidence and remove worktrees/branch;
- JavaScript syntax checks: passed for the demo and both library modules;
- complete host machinery suite: **all good**.

## Important implementation observation

Node's test runner exports a private `NODE_TEST_CONTEXT` marker to test processes. If a runtime launches a nested `node --test` while inheriting that marker, the child can return success without discovering tests. More broadly, passing the full parent environment into repository tests could expose provider credentials. The command boundary therefore uses a small allowlist; disables global/system Git configuration, hooks, fsmonitor, signing, and prompts; and bounds execution time/output. Repository-local filters and similar mechanisms are not a hardened sandbox. The end-to-end test caught the original false-green behavior because it requires the broken base commit to fail before any repair may proceed.

The independent review also demonstrated that checking worktree cleanliness *before* an objective test is unsafe: a passing test can dirty the tree afterward. The gate now runs the test first and only then re-reads HEAD and status immediately before evidence binding and recording.

## What worked

- One real work item crossed the canonical claim and record boundaries.
- The base commit demonstrably failed before repair.
- The maker produced a real child commit in an isolated worktree.
- The verifier used a different detached worktree at that exact commit.
- Both worktrees were clean after execution.
- Structured evidence remained bound to one run and artifact.
- Canonical records are bound to persisted evidence by SHA-256.
- Objective checks gated the recorded pass.

## What remains

- Replace the deterministic repair mutation with a real Eve maker session.
- Have Eve return terminal evidence through the host bridge rather than calling the driver directly.
- Use stronger sandbox separation than sibling Git worktrees before untrusted model execution.
- Add an actual network/filesystem sandbox before running untrusted repository tests; the current fixture is trusted, and environment/Git isolation is not a security boundary.
- Exercise a failed first maker/verifier attempt and bounded second attempt with distinct real commits.
- Test process interruption after claim and after maker commit, including idempotent resume and exactly-once archive/log recovery.
- Retest against the intended persistent Eve workflow world.
- Run against a disposable clone of a realistic application only after the fixture path remains green.

## Recommendation

Treat this as validation of the **host/Git transaction boundary**, not agent repair capability. The next experiment should insert Eve between claim and terminal evidence while preserving this exact transaction contract. Keep the repository disposable and the mutation narrowly scoped; do not move directly to Valgate or production credentials.
