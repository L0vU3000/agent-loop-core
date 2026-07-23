import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  description: "Independently evaluates an exact maker commit against the locked rubric.",
  model: mockModel(({ lastUserMessage }) => {
    const message = lastUserMessage ?? "";
    const commit = message.match(/maker commit ([a-f0-9]{7,40})/i)?.[1] ?? "missing";
    const secondAttempt = message.includes("attempt 2");
    return JSON.stringify(secondAttempt
      ? { verdict: "pass", score: 1, commit, tests: "green" }
      : { verdict: "fail", score: 0.4, commit, tests: "regression remains" });
  }),
  modelContextWindowTokens: 100_000,
});
