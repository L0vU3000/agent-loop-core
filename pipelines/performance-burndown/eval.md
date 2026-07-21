# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, configuration, measurement fixtures, tests, or
run notes other than `runs/<run-id>/eval.md`. Apply the approved scorecard through
[`../EVAL.md`](../EVAL.md).

Independently verify:

1. The metric contract, command/browser recipe, tool version, environment, fixture, cache state, sample
   count, outlier rule, and minimum detectable improvement are byte-for-byte consistent with Explore.
2. Run the locked recipe for exactly the planned sample count. Record every raw sample and compute the median.
   Do not add samples after seeing a bad result or exclude a value outside the predefined rule.
3. Compare the median with the last accepted best in the target direction. Require strict improvement and
   any predefined minimum. Separately report whether the approved target is met.
4. Run the locked behavior command or browser flow and compare it with the behavior baseline. Observable
   content, response, and interactions must remain unchanged.
5. Run `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components`; ESLint may not exceed
   Explore's baseline.
6. Inspect the complete diff from the last accepted checkpoint. It must contain one approved lever, no
   instrumentation or test edits, no behavior/UX changes, and no unrelated work.
7. For query work, re-confirm an approved Neon development endpoint and a read-only measurement query.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
metric: <name> <direction> <target> <unit>
samples: [<all raw samples>]
median: <last accepted best> → <current>
minimum-improvement-met: yes/no
target-met: yes/no
measurement-comparable: yes/no
behavior: unchanged | CHANGED
vitest: <passed>/<total>
tsc: <error-count>
eslint: <start> → <current>
one-lever-diff: yes/no
evidence: <commands and relevant output>
reason: <one sentence>
next: done | return-to-plan | human-review
```

Pass an attempt only when the score reaches the approved threshold, the rubric and fingerprint are unchanged,
critical failures are zero, the median is comparable and improves beyond the planned minimum, and every
behavior/regression/scope gate passes. `target-met: no` may still accept a real gain and return it to Plan for
the next lever. A tie, noisier-than-threshold movement, regression, or incomparable measurement fails and
returns to Plan; do not prescribe a repair or send it directly to Execute.
