"use strict";

const assert = require("node:assert/strict");

(async () => {
  const bridgeModule = await import("./index.mjs");

  assert.equal(typeof bridgeModule.createBridgeClient, "function");

  const client = bridgeModule.createBridgeClient({ autoStart: false });
  assert.equal(typeof client.start, "function");
  assert.equal(typeof client.stop, "function");

  console.log("bridge interop test passed: CJS dynamic import() loaded ESM bridge module");
})().catch((error) => {
  console.error("bridge interop test failed");
  console.error(error);
  process.exitCode = 1;
});
