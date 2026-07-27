import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  description: "Produces the minimal repair plan and a locked evaluation rubric.",
  model: mockModel("{\"plan\":\"adjust one boundary condition\",\"rubricSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"passThreshold\":0.9}"),
  modelContextWindowTokens: 100_000,
});
