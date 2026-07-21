# Agent Loop — Resource Library

Curated primary sources on agent loops / "loop engineering," organized by author.
Each entry: who they are, the one idea to take, and the link(s). Read in this order.

---

## 1. Simon Willison — the clearest *definition*

**Who:** Independent researcher, creator of Datasette, one of the most-read writers on
practical LLM engineering. His definition of "agent" is now the de-facto industry standard.

**The idea:** *"An LLM agent runs tools in a loop to achieve a goal."* Curate a small set of
well-chosen shell tools, lean on real test suites, and know that "YOLO mode" (auto-approve)
is fast but dangerous — isolate it. Good loop candidates have a **clear success criterion**.

- **Designing agentic loops** (Sep 30, 2025) — the practical how-to, YOLO mode, credentials/safety
  https://simonwillison.net/2025/Sep/30/designing-agentic-loops/
- **"Agent" finally has a useful definition** (Sep 2025)
  https://simonwillison.net/2025/Sep/18/agents/  ·  https://simonw.substack.com/p/i-think-agent-may-finally-have-a
- **Building effective agents (his notes on the Anthropic paper)**
  https://simonwillison.net/2024/Dec/20/building-effective-agents/

---

## 2. Andrej Karpathy — the *strategy* (Software 3.0 + autonomy slider)

**Who:** Founding member of OpenAI, ex-Sr. Director of AI at Tesla, "Software 1.0/2.0/3.0"
framing. The most influential voice on where this is all heading.

**The idea:** LLMs are **Software 3.0** — natural language *is* the program. Don't chase full
autonomy; build **partial-autonomy co-pilots with an autonomy slider**. Work runs as a
**generation–verification loop** (it writes, you check, you re-prompt) and **throughput is
capped by verification speed** — so make checking fast, not prompts long.

- **Software Is Changing (Again) / Software 3.0** — talk (Latent Space writeup)
  https://www.latent.space/p/s3
- **Loop Engineering, Karpathy-Style: the Gen–Verify Loop**
  https://www.aibuilderclub.com/blog/loop-engineering-karpathy
- **autoresearch** — his repo of AI agents auto-running research loops on nanochat training
  https://github.com/karpathy/autoresearch
- On code agents & the "self-improvement loopy era" (Mar 2026 interview writeup)
  https://www.nextbigfuture.com/2026/03/andrej-karpathy-on-code-agents-autoresearch-and-the-self-improvement-loopy-era-of-ai.html

---

## 3. Boris Cherny (& Cat Wu) — the *practitioner* who built Claude Code

**Who:** Boris Cherny built Claude Code at Anthropic; Cat Wu is on the product team. They
coined "loop engineering" as the successor to prompting.

**The idea:** *"I don't prompt Claude anymore. I have loops running that prompt Claude."*
A loop is a **recursive goal**: give a purpose, the agent iterates until done. The core moves:
**(1)** split the writer agent from a **verifier** agent, **(2)** write lessons into
**`CLAUDE.md`** so corrections propagate to every future session, **(3)** put discovery/triage
on a **schedule**, **(4)** run parallel agents in **isolated worktrees**, keep context lean.

- **The New Stack — "he ditched prompting, now he just writes loops"**
  https://thenewstack.io/loop-engineering/
- **The Neuron — Cherny & Wu explain agent loops**
  https://www.theneuron.ai/explainer-articles/claude-code-creators-boris-cherny-and-cat-wu-explain-how-to-use-agent-loops/
- **Addy Osmani — Loop Engineering** (excellent structured writeup)
  https://addyosmani.com/blog/loop-engineering/

---

## 4. Anthropic (Erik Schluntz & Barry Zhang) — the *patterns* reference

**Who:** Anthropic engineers; authored the canonical guide teams cite when building agents.

**The idea:** Start with the **augmented LLM** (an LLM + retrieval + tools + memory) as the
building block. Distinguish **workflows** (LLMs orchestrated on *predefined* paths — use real
control flow) from **agents** (LLMs that *dynamically* direct their own tools). Prefer simple,
composable patterns over heavy frameworks. Manager/orchestrator–worker patterns for fan-out.

- **Building Effective Agents** (Dec 19, 2024) — the reference doc
  https://www.anthropic.com/research/building-effective-agents  ·  https://www.anthropic.com/engineering/building-effective-agents

---

## 5. Dex (Dexter) Horthy — the *reliability* engineering (12-Factor Agents)

**Who:** Founder of HumanLayer; analyzed 100k+ dev agent sessions. The "12-Factor Agents"
framework ports the classic 12-Factor App discipline to LLM agents.

**The idea:** Reliability comes from **owning your context window** (Factor 3). The "dumb zone"
is the middle 40–60% of a large context — recall degrades there, so *use less context*. Don't
use prompts for **control flow**: if you know the workflow, use real code (classify → route to
small focused prompts). Make agents **stateless** and serialize the context so runs are
interruptible/resumable.

- **12-Factor Agents (GitHub)** — the canonical repo
  https://github.com/humanlayer/12-factor-agents
- **Talk — Agents in Production 2025 (MLOps Community)**
  https://home.mlops.community/public/videos/12-factor-agents-patterns-of-reliable-llm-applications-dexter-horthy-agents-in-production-2025-2025-08-06
- **Practical framework writeup**
  https://dev.to/bredmond1019/the-12-factor-agent-a-practical-framework-for-building-production-ai-systems-3oo8

---

## 6. Official vendor guides — Claude & OpenAI Codex

**Who:** The teams shipping the loop-running tools themselves. Read these for the *exact
commands and primitives* your harness already has.

**Claude — Getting Started with Loops.** Defines a loop as *"agents repeating cycles of work
until a stop condition is met"* and names **four loop types** (see the main doc): **turn-based**,
**goal-based (`/goal`)**, **time-based (`/loop`, `/schedule`)**, and **proactive** (event-triggered).
Getting-started recipe: find a bottleneck task → pick one element to automate (the verification
check, the stop condition, or the trigger) → start simple → iterate.
- https://claude.com/blog/getting-started-with-loops

**OpenAI — Unrolling the Codex Agent Loop.** How the Codex loop actually runs *under the hood*
— the mechanical view. *(The openai.com page is JS/Cloudflare-gated and won't auto-fetch;
open it in a browser. Details below are from OpenAI's text + a faithful deep-dive.)*
- https://openai.com/index/unrolling-the-codex-agent-loop/
- Deep-dive mirror: https://codex.danielvaughan.com/2026/03/28/codex-agent-loop-deep-dive/
- Also good: https://cohorte.co/blog/unrolling-the-codex-agent-loop-without-losing-your-mind

  Key mechanics to internalize:
  - **One "turn" = many iterations.** A single user message can fire *50+ tool calls* before
    the final assistant message. Each lap: build prompt → infer → parse → maybe run a tool →
    add result to history → loop.
  - **The final assistant message is a *termination signal, not the deliverable*.** The real
    output is the code/files the agent changed on your machine; the prose ("I added X") just
    means the loop has exited and control is back to you.
  - **Prompt = system prompt + history + tool schemas + current message**, all re-tokenized
    every turn — so verbose history gets expensive fast. Hence **context control**: `/compact`
    (summarize), **subagent delegation** (fresh context), `codex fork --last` (branch a state),
    and **prefix caching** (reuse KV state for the stable prefix).
  - **Tool permissions gate the loop.** "Smart Approvals" route risky actions through a
    guardian subagent that enforces policy *before* execution — how you get unattended runs
    without a human clicking "approve" every step.

**Daniel Vaughan — Loop Engineering with Codex CLI.** The best *hands-on* Codex writeup.
"Designing systems that prompt agents on your behalf, rather than prompting them yourself."
**Five building blocks:** **Automations** (cron + TOML + persistent memory files),
**Goal Mode** (runs for hours/days with a *separate* verifier model = "maker–verifier separation"),
**Worktrees** (parallel git isolation), **Subagents** (read-only reviewers vs. write-enabled
implementers), **Skills** (encoded project conventions). Names three failure modes to design
against: *verification weakness*, *comprehension debt*, *cognitive surrender*.
- https://codex.danielvaughan.com/2026/06/11/loop-engineering-codex-cli-autonomous-agent-loops-automations-subagents-goal-mode/

---

## 7. IndyDevDan (Dan Eisler) — the *counterpoint*: "it's not a loop, it's a workflow"

**Who:** 15-yr software engineer, runs agenticengineer.com, weekly build-focused YouTube.
His whole pitch is a pushback on the "loop engineering" rebrand.

**The idea:** *"Forget loop engineering — build AI Developer Workflows (ADWs) inside a software
factory."* A loop is just **one control-flow node** (the pass/fail route back to the build
agent). Calling the whole thing "loop engineering" is like naming it "if-engineering" or
"exception-engineering" — it's just the software development life cycle with AI bolted on.
The real unit is a **workflow**: prompts go in → a mix of **code + agents** runs → results come out.

**The framework worth stealing:**
- **Three actors of value creation: engineers, agents, code.** Placing each in the right spot is
  the game. **Code is the unsung hero** — fast, deterministic, reliable, and *zero token cost*.
  Reliability rank: code > engineers > agents. Don't over-leverage agents for what code does better.
- **You (the human) show up at exactly two constraints: planning (start) and reviewing (end).**
  The system handles everything in between. Slide those two inward only as trust grows.
- **Scale compute to scale impact / "add compute to add confidence."** Collapse all your
  validation (lint, format, typecheck, tests) into a dedicated **test agent** that routes failures
  back to the build agent.
- **Separate code from agents — do NOT bury lint inside a skill.** Anti-pattern: one giant skill
  where the agent calls the lint step itself. Correct: an agent SDK runs a **build agent**, then
  *code* runs the linter, and a failure feeds back into the build agent (same session ID). Real
  separation of concerns → testable nodes + proper guardrails.
- **Isolation ladder: worktrees → agent sandboxes.** Worktrees are "a great place to start, not to
  end"; the upgrade is giving each agent its own sandbox/computer you can jump into, review, merge.
- **The software factory.** A Kanban ticket lands → a **factory router agent** reads the codebase
  and picks the right ADW (chore vs. bug vs. feature vs. hotfix) at the best price/perf/speed →
  scout → plan → build → test agents run in sandboxes → CI/CD → human review → ship. Advanced teams
  skip translating tickets into prompts and kick the factory off the moment a ticket lands.
- **Build the system that builds the system.** Your effort moves to the **agentic layer**, not the
  app layer. That's the opposite of vibe coding: *"vibe coding is not knowing how your system works;
  agentic engineering is knowing it works so well you don't have to look."*
- **How to build good ADWs:** (1) keep it simple, start with the smallest workflow; (2) **do it by
  hand first** — step through every node yourself, then encode it (he sketches with **Mermaid**);
  (3) make sure you're **not just using agents** — move skill work into real code as you productionize.

- Video: *"FORGET Loop Engineering. Agentic Engineering is about THIS"* (Jul 13, 2026)
  https://www.youtube.com/watch?v=VQy50fuxI34
- Tactical Agentic Coding (course): https://agenticengineer.com/tactical-agentic-coding
- Thinking in Threads (free blog): https://agenticengineer.com/thinking-in-threads
- Referenced in the video: Peter Steinberger's loop tweet · Boris Cherny's loop tweet ·
  Anthropic's loops post (§6 above) · Mermaid (https://mermaid.live)

> **How to hold this next to §1–6:** everyone above is describing the *loop* (one node).
> IndyDevDan zooms out to the *graph the loop sits inside*. Both are right — build a solid loop
> first (§1–6), then wire loops together into workflows (§7) as the work gets bigger.

---

## 8. Foundations — ReAct (the original loop)

**Who:** Shunyu Yao et al., Princeton + Google (2022). The paper that formalized
**Reason → Act → Observe** for language models.

**The idea:** Reasoning and acting **reinforce each other** — the model reasons about what to
do, acts, reads the result, and reasons again. This interleaving beat action-only and
reasoning-only baselines (+34% ALFWorld, +10% WebShop). Every modern agent loop is a
descendant of this.

- **ReAct: Synergizing Reasoning and Acting in Language Models** (paper)
  https://arxiv.org/abs/2210.03629  ·  project page: https://react-lm.github.io/

---

## Also worth a look (secondary, well-written syntheses)

- **From ReAct to Loop Engineering (2026 guide)** — Data Science Dojo
  https://datasciencedojo.com/blog/agentic-loops-explained-from-react-to-loop-engineering-2026-guide/
- **Loop Engineering** — The New Stack's original coverage (Addy Osmani cross-post above)
- **The Agentic Loop: Think / Act / Observe** — Stackviv
  https://stackviv.ai/blog/agentic-loop-think-act-observe
- **What Is the AI Agent Loop?** — Oracle Developers
  https://blogs.oracle.com/developers/what-is-the-ai-agent-loop-the-core-architecture-behind-autonomous-ai-systems

---

### The lineage in one line

**ReAct (2022, the loop)** → **Anthropic patterns (2024, workflows vs agents)** →
**Karpathy (2025, autonomy slider + gen/verify)** → **Willison (2025, the definition)** →
**Horthy 12-Factor (2025, reliability)** → **Cherny "loop engineering" (2026, stop prompting)** →
**vendor guides (2026, Claude 4 loop types + Codex 5 building blocks)** →
**IndyDevDan (2026, the counterpoint: loops are one node of an AI Developer Workflow)**.
