---
name: "Orchestrate a bounded work item"
description: Turn a plain-language request into a checked agent-loop item, dispatch its pipeline, and record the outcome.
category: Workflow
tags: [agent-loop, orchestrator, inbox, dispatch]
---

Use this as the single entry point for agent-loop work.

Read `agent-loop/orchestrator/orchestrator.md`, `agent-loop/categories.md`, and
`agent-loop/STACK.md` before acting. `STACK.md` is authoritative for project-specific commands,
services, data stores, and safety boundaries; never invent missing values or copy assumptions from
another project.

Interpret the argument after `/orchestrate` as follows:

- a plain-language request: draft, validate, get one start approval, then dispatch it;
- `plan`: print the current dispatch plan and change nothing;
- no argument: make one tick over already queued work only.

## Request intake

1. Map the request to one pipeline type from `categories.md`. If it spans multiple types, split it.
   Ask only the smallest number of questions needed to choose one type and write a verifiable done
   condition.
2. Draft outside the live inbox at `.context/inbox-drafts/YYYY-MM-DD-<slug>.md`:

   ```markdown
   ---
   category: <category>
   type: <type>
   priority: <low|normal|high>
   created: <YYYY-MM-DD>
   ---

   # <one-line objective>

   "Done" = <a concrete condition a fresh verifier can check>.

   ## Evidence / context
   - <relevant paths, repro steps, or prior run IDs>

   ## Do NOT
   - <scope or safety boundaries that prevent a misleading fix>
   ```

3. Validate the draft and fix it until it passes:

   ```bash
   node agent-loop/orchestrator/check-work-item.mjs .context/inbox-drafts/<file> --json
   ```

4. Show the checked item and ask once for approval to file and run it. Do not file an item that
   fails the checker and do not self-approve an approval-gated pipeline.
5. After approval, move it to `agent-loop/orchestrator/inbox/`, run one tick, and follow the
   `AGENT ACTIONS` block. Run the selected pipeline through the Workflow runtime in its isolated
   worktree; respect its iteration, time, and approval bounds.

   ```bash
   mv .context/inbox-drafts/<file> agent-loop/orchestrator/inbox/<file>
   node agent-loop/orchestrator/tick.mjs
   ```

6. Once the pipeline finishes, record its real outcome from the live workspace:

   ```bash
   node agent-loop/orchestrator/dispatch.mjs --record <inbox-file> <pass|fail> --summary "<one line>"
   ```

7. If a passing run's result is another pipeline's input — research that concludes a change is
   needed, a review that finds a bug worth fixing — draw the edge instead of letting the hand-off
   live only in the conversation. Append `--next <type>[,<type>]` to the `pass`:

   ```bash
   node agent-loop/orchestrator/dispatch.mjs --record <inbox-file> pass --summary "<one line>" --next <type>
   ```

   That drafts the successor under `orchestrator/inbox/next/`. It is inert: the router cannot see
   it, and the checker rejects it until someone writes that node's **own** exit condition — never
   the predecessor's. Arm it exactly like any other item (step 3, then move it into the inbox), and
   only when the successor is actually wanted. Do not chain edges to keep the loop busy.

## Plan or existing inbox

For `/orchestrate plan`, run:

```bash
node agent-loop/orchestrator/dispatch.mjs
```

For `/orchestrate` with no argument, run one `tick.mjs` pass. Correct invalid work items rather
than guessing a repair. Do not run a tick merely as a smoke test when live inbox work could be
dispatched.

## Guardrails

- One bounded item maps to one pipeline.
- The router routes; the isolated workflow does the work.
- Never use production data or destructive commands unless the project-specific `STACK.md` and an
  explicit user approval permit it.
- Keep project knowledge notes in `agent-loop/vault/project/`; only routable work items belong in
  `agent-loop/orchestrator/inbox/`.
- Surface every required plan, migration, merge, deploy, rollback, or release approval to the user.
