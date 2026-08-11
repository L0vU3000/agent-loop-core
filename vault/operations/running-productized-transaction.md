---
type: operation
status: active
created: 2026-07-30
updated: 2026-07-30
tags:
  - agent-loop
  - transaction
---

# Running a productized transaction

The supported CLI runs one bounded `bug-fix` work item against a clean external Git repository. It
claims the item once, gives a dedicated maker worktree to Hermes, verifies the exact maker commit in
a separate worktree, applies deterministic gates, and records digest-bound evidence. It never
changes the original checkout to the maker commit.

## Ownership boundary

| Target-owned configuration and source | External mutable state |
|---|---|
| `.agent-loop/config.json` | `inbox/pending`, `inbox/in-progress`, `inbox/done`, and `inbox/failed` |
| The original clean checkout and base commit | Permanent digest claims under `claims/` |
| The target's existing Git object database | Run identities under `runs/` and normalized evidence under `evidence/` |
| Local linked-worktree registrations and the runtime-owned maker branch | Maker/verifier checkout contents under `worktrees/<run-id>/` and `logs/dispatch.jsonl` |

The state root must be an absolute path disjoint from the target checkout and its Git metadata.
Linked worktrees live under that external root, although Git necessarily records their
administrative registrations in the target repository's common Git directory. A successful run
leaves the maker branch and retained worktrees available for independent inspection.

## Prepare a bounded work item

The work-item body must be non-empty and its frontmatter must select the only supported pipeline:

```markdown
---
pipeline: bug-fix
---
Repair the failing bounded test. Change only the paths allowed by target configuration.
```

Do not include credentials, tokens, provider output, or production data. Reusing content with the
same digest fails closed instead of creating duplicate evidence.

## Preflight

Run doctor from outside the target. It checks Node, Git, the repository HEAD and cleanliness, target
configuration, state-root separation/writability, and the trusted Hermes executable without
invoking a maker:

```bash
AGENT_LOOP=/absolute/path/to/agent-loop-tools/node_modules/.bin/agent-loop
$AGENT_LOOP doctor --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state --json
```

Target configuration must declare the bug-fix pipeline, the bounded test command, allowed paths,
and the required maker route:

```json
{
  "schemaVersion": 1,
  "pipeline": "bug-fix",
  "test": {
    "executable": "node",
    "args": ["--test"]
  },
  "allowedPaths": ["src/add.mjs"],
  "maker": {
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "timeoutMs": 300000
  }
}
```

Do not continue unless `healthy` is `true`. Doctor may report `sandbox.deferred` as a warning; that
warning is not a readiness failure and is not a claim that containment exists.

The maker is bounded by the configured wall-clock `timeoutMs`, not an exact turn cap. Successful
runs bind the Hermes usage-file evidence described below into canonical transaction evidence.

## Credential and sandbox boundary

The Hermes maker is not an OS sandbox. It receives an allowlisted process environment that may
include the configured Hermes credential home. Target tests also execute target-controlled code;
environment filtering reduces inherited data but does not contain that code.

Use a disposable or trusted non-production repository and development-scoped credentials only.
Review `.agent-loop/config.json` and the work item for secrets before running. Explicitly accepting
this limitation is mandatory through `--acknowledge-unsandboxed-credential-access`; omission fails
before claim or maker work.

## Run

```bash
$AGENT_LOOP run --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state \
  --work-item /absolute/path/to/bug-fix.md \
  --acknowledge-unsandboxed-credential-access \
  --json
```

The normalized JSON result identifies the run, immutable base commit, one non-merge maker commit,
exact verifier commit, decision, evidence path/digest, and state root. Persisted evidence uses
schemaVersion 2 and includes a bounded `makerRuntime` provenance object:

- `runtime: "hermes"` and `exitCode: 0`
- `outputSha256` (lowercase sha256 hex) and `outputBytes` (bounded safe integer)
- `usage` containing exactly `model`, `provider`, `apiCalls`, `totalTokens`,
  `estimatedCostUsd`, `completed: true`, and `failed: false`

It never contains raw model output, raw command errors, credentials, prompts, workspace paths, or
maker stderr/stdout. Unknown fields are rejected at both `makerRuntime` and `usage` levels.

The maintained transaction performs no push, fetch, pull, clone, or merge. It configures no remote,
does not install target dependencies, and never lands the maker commit in the original checkout.
It does create local linked worktrees, one local `agent-loop/<run-id>-maker` branch, and one maker
commit when the repair succeeds. Landing that commit is a separate human-owned operation outside
this runtime.

After a pass, independently check the base failure, one-child commit ancestry, approved changed
paths, exact verifier HEAD/test/cleanliness, original checkout HEAD/cleanliness, state-root
separation, and evidence digest before trusting the result.

## Recover a recorded interruption

If the process stops after canonical evidence and its dispatch-ledger row are persisted but before
the in-progress work item reaches `done` or `failed`, recover that final deterministic transition:

```bash
$AGENT_LOOP recover --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state \
  --run-id <immutable-run-id> \
  --json
```

The run ID is the directory name under `runs/`. Recovery does not require the unsandboxed maker
acknowledgment because it never invokes Hermes, runs target code, creates commits, or accesses maker
credentials. It re-reads the immutable run identity and canonical evidence without following
symlinks. Canonical evidence must be schemaVersion 2 and include the complete normalized
`makerRuntime` provenance. Recovery requires the dispatch ledger's complete normalized row and
evidence digest to match, then resolves only the work-item digest bound into that run. schemaVersion
1 evidence, missing or tampered `makerRuntime`, and conflicting ledger rows remain fail-closed for
human inspection.

An exact retry returns the same terminal result. Recovery also reconciles interruption after the
terminal hard link was created but before the `in-progress` link was removed. Missing evidence,
partial ledger persistence, conflicting decisions, mismatched digests, and interruptions from any
earlier transaction phase remain fail-closed for human inspection; this command does not rerun or
repair those phases.

## Upgrade

Build and test a new tarball from the intended core revision, then install it into the same tools
prefix:

```bash
npm install --prefix /absolute/path/to/agent-loop-tools \
  /absolute/path/to/agent-loop-core/agent-loop-core-0.1.0.tgz
$AGENT_LOOP --version
$AGENT_LOOP doctor --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state --json
```

An upgrade replaces tool code only. It does not migrate or delete target configuration, claims,
worktrees, evidence, branches, or logs. Review release changes before reusing existing state.

## Uninstall

```bash
npm uninstall --prefix /absolute/path/to/agent-loop-tools agent-loop-core
```

Uninstalling the tool leaves target source and `.agent-loop/config.json` unchanged. It also leaves
external evidence, claims, logs, worktrees, and the maker branch unchanged so an uninstall cannot
silently destroy audit material.

Remove external state separately only after every retained transaction has been reviewed or
archived and no run is active. Use `git -C /absolute/path/to/target worktree list` to identify linked
maker/verifier worktrees, remove those registrations with `git worktree remove`, and delete an
`agent-loop/<run-id>-maker` branch only when its commit is no longer needed. Then remove the external
state root. Never delete the target checkout or its `.git` directory as part of uninstall.

For the distinct legacy template lifecycle, see [[vault/architecture/distribution-model]] and
[[vault/operations/installing-in-a-project]].
