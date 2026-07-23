import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Runs one deterministic bug-fix pipeline through Eve's real harness.",
  async test(t) {
    await t.send("Run the fixture bug-fix pipeline.");

    t.succeeded();
    t.noFailedActions();
    t.calledTool("start_run");
    t.calledSubagent("explorer");
    t.calledSubagent("planner");
    t.calledTool("lock_rubric", { input: { sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", passThreshold: 0.9 } });
    t.calledSubagent("maker");
    t.calledTool("record_maker_artifact", { input: { branch: "fixture/eve-run-1", commit: "abc1234" } });
    t.calledSubagent("verifier");
    t.calledTool("apply_verification", { input: { verifier: "verifier", verdict: "fail", score: 0.4, commit: "abc1234" } });
    t.calledTool("record_maker_artifact", { input: { branch: "fixture/eve-run-2", commit: "def5678" } });
    t.calledTool("apply_verification", { input: { verifier: "verifier", verdict: "pass", score: 1, commit: "def5678" } });
    t.calledTool("objective_gate");
    t.toolOrder(["start_run", "lock_rubric", "record_maker_artifact", "apply_verification", "record_maker_artifact", "apply_verification", "objective_gate"]);
    t.check(t.reply, includes('"outcome":"pass"'));
    t.check(t.reply, includes('"runId":"run-fixture-001"'));
  },
});
