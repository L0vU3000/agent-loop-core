import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "eve/client";

const [phase, statePath] = process.argv.slice(2);
const host = process.env.EVE_HOST ?? "http://127.0.0.1:43210";
const client = new Client({ host });

if (phase === "start") {
  const session = client.session();
  const response = await session.send("Run the fixture bug-fix pipeline.");
  const result = await response.result();
  assert.equal(result.status, "waiting");
  assert.match(result.message ?? "", /\"outcome\":\"pass\"/);
  assert.ok(session.state.sessionId);
  assert.ok(session.state.continuationToken);
  await writeFile(statePath, JSON.stringify(session.state));
  console.log(JSON.stringify({ phase, status: result.status, session: session.state }));
} else if (phase === "resume") {
  const saved = JSON.parse(await readFile(statePath, "utf8"));
  const session = client.session(saved);
  const response = await session.send("Inspect the durable run after restart.");
  const result = await response.result();
  assert.equal(result.status, "waiting");
  assert.match(result.message ?? "", /\"runId\":\"run-fixture-001\"/);
  assert.match(result.message ?? "", /\"phase\":\"completed\"/);
  assert.match(result.message ?? "", /\"makerCommit\":\"def5678\"/);
  console.log(JSON.stringify({ phase, status: result.status, message: result.message }));
} else {
  throw new Error("usage: restart-probe.mjs <start|resume> <state-path>");
}
