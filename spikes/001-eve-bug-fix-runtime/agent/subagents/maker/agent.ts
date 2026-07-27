import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  description: "Implements an approved plan on a task branch and returns the exact commit artifact.",
  model: mockModel(({ lastUserMessage }) => {
    const secondAttempt = lastUserMessage?.includes("attempt 2") ?? false;
    return JSON.stringify(secondAttempt
      ? { branch: "fixture/eve-run-2", commit: "def5678", changed: ["fixture.ts"] }
      : { branch: "fixture/eve-run-1", commit: "abc1234", changed: ["fixture.ts"] });
  }),
  modelContextWindowTokens: 100_000,
});
