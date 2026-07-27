import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
export default defineAgent({
  description: "Reproduces a defect and returns root-cause evidence without changing production code.",
  model: mockModel("{\"reproduced\":true,\"rootCause\":\"fixture off-by-one\",\"redTest\":\"fixture.test.ts\"}"),
  modelContextWindowTokens: 100_000,
});
