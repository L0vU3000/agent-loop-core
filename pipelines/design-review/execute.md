# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only writes are the findings
report, its screenshots, and any drafted fix tickets under `runs/<run-id>/`. Do not edit product
source, styles, schema, migrations, seed data, or the live orchestrator inbox. The installed
`design-review` gstack skill is your reviewing engine, used in observe-only mode.

## Review the surface

Observe only the surface, states, and viewports the plan named as in scope. Drive the surface
with the `design-review` gstack skill through its headless browser: navigate to the route, render
each in-scope state and viewport, and observe — do not submit forms, trigger mutations, or edit
anything the surface renders. Use `graphify query`/`path` to orient on the component tree behind
the surface before you cite an element. Hunt for four classes of issue:

- **Visual inconsistency** — components that drift from the Tailwind + shadcn/ui system,
  mismatched typography, color, or control styling, elements that ignore the established pattern.
- **Spacing and hierarchy** — crowded or uneven rhythm, misaligned elements, a visual hierarchy
  that buries the primary action or misleads the eye.
- **Accessibility gaps** — insufficient contrast, controls with no label, no visible focus or
  keyboard path, content lost or overflowing at a supported viewport.
- **AI-slop patterns** — generic filler copy, the wording in `vault/resources/words-to-avoid.md`,
  placeholder or dummy values leaking into the product, cookie-cutter layout with no considered
  design.

Do not report personal taste as if it were a defect, and do not stray into correctness, security,
or architecture findings — those route to other pipelines.

## Write `runs/<run-id>/findings.md`

State the **review scope** you covered (the exact surface, states, and viewports), then list each
finding as:

- **Severity** — high / medium / low, graded against the plan's severity definitions.
- **Location** — the surface plus the specific element or region (name the route and the element,
  and the component path where it lives).
- **Evidence** — the screenshot filename you captured under `runs/<run-id>/` and, for an
  accessibility gap, the check result (contrast ratio, missing label, focus trace). A reader must
  be able to re-observe it from what you wrote.
- **Why it matters** — one sentence on the impact.

Order findings most-severe first. If the surface is clean, say so explicitly and report zero
findings — do not manufacture findings to look productive. A false positive is worse than a miss.

## Write `runs/<run-id>/proposed-tickets.md`

For each **confirmed high-severity** finding, draft the downstream building ticket that would fix
it, in that pipeline's expected shape, with frontmatter `approved: false` so it cannot be
dispatched until the owner approves. Include the target `category`/`type` and exactly the fields
that pipeline's scope gate requires. Low-severity nits need no ticket unless the plan asked for one.

If the plan's scope is wrong or the surface cannot be reviewed as described (it does not render,
or the seed state is missing), stop and report in `execute.md` — do not improvise scope or invent
findings.
