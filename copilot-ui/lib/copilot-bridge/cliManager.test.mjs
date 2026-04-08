import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateDesktopCliManagerState } from "./cliManager.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("desktop CLI manager fails closed when no managed payload exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ie-cli-manager-"));
  const bundleRoot = path.join(root, "copilot-cli");
  const copilotHome = path.join(root, ".copilot");

  writeJson(path.join(bundleRoot, "channel-contract.json"), {
    schemaVersion: 1,
    defaultAcquisition: "bundle_or_seeded_install_only",
    channels: {
      stable: {
        sdkChannel: "stable",
        cliChannel: "stable",
      },
    },
  });

  const state = evaluateDesktopCliManagerState({
    channel: "stable",
    sdkVersion: "0.1.9",
    bundleRoot,
    copilotHome,
    env: {},
    platform: "win32",
  });

  assert.equal(state.status, "blocked");
  assert.equal(state.reason, "managed_cli_missing");
});

test("desktop CLI manager approves a seeded managed payload that matches the active lane", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ie-cli-manager-"));
  const bundleRoot = path.join(root, "copilot-cli");
  const copilotHome = path.join(root, ".copilot");
  const installRoot = path.join(copilotHome, "managed-cli", "stable");
  const cliPath = path.join(installRoot, "bin", "copilot.cmd");

  writeJson(path.join(bundleRoot, "channel-contract.json"), {
    schemaVersion: 1,
    defaultAcquisition: "bundle_or_seeded_install_only",
    channels: {
      stable: {
        sdkChannel: "stable",
        cliChannel: "stable",
      },
    },
  });
  writeJson(path.join(installRoot, "manifest.json"), {
    schemaVersion: 1,
    channel: "stable",
    version: "1.2.3",
    sdkVersion: "0.1.9",
    executableRelativePath: "bin/copilot.cmd",
  });
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, "@echo off\r\n", "utf8");

  const state = evaluateDesktopCliManagerState({
    channel: "stable",
    sdkVersion: "0.1.9",
    bundleRoot,
    copilotHome,
    env: {},
    platform: "win32",
  });

  assert.equal(state.status, "ready");
  assert.equal(state.approved, true);
  assert.equal(state.source, "seeded-install");
  assert.equal(state.cliPath, cliPath);
});
