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
    packagedDependencyRoots: [],
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
    packagedDependencyRoots: [],
    platform: "win32",
  });

  assert.equal(state.status, "ready");
  assert.equal(state.approved, true);
  assert.equal(state.source, "seeded-install");
  assert.equal(state.cliPath, cliPath);
});

test("desktop CLI manager seeds a managed Windows install from the packaged Copilot dependency when no payload exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ie-cli-manager-"));
  const bundleRoot = path.join(root, "copilot-ui", "resources", "copilot-cli");
  const packagedCliRoot = path.join(root, "copilot-ui", "node_modules", "@github", "copilot-win32-x64");
  const copilotHome = path.join(root, ".copilot");
  const seededCliPath = path.join(copilotHome, "managed-cli", "stable", "bin", "copilot.exe");

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
  writeJson(path.join(packagedCliRoot, "package.json"), {
    name: "@github/copilot-win32-x64",
    version: "1.4.5",
  });
  fs.mkdirSync(packagedCliRoot, { recursive: true });
  fs.writeFileSync(path.join(packagedCliRoot, "copilot.exe"), "seeded-cli", "utf8");

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
  assert.equal(state.cliPath, seededCliPath);
  assert.equal(fs.existsSync(seededCliPath), true);
  const seededManifest = JSON.parse(fs.readFileSync(path.join(copilotHome, "managed-cli", "stable", "manifest.json"), "utf8"));
  assert.equal(seededManifest.executableRelativePath, "bin/copilot.exe");
  assert.equal(seededManifest.version, "1.4.5");
});

test("desktop CLI manager refreshes a stale seeded Windows install from the packaged Copilot dependency", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ie-cli-manager-"));
  const bundleRoot = path.join(root, "copilot-ui", "resources", "copilot-cli");
  const packagedCliRoot = path.join(root, "copilot-ui", "node_modules", "@github", "copilot-win32-x64");
  const copilotHome = path.join(root, ".copilot");
  const installRoot = path.join(copilotHome, "managed-cli", "stable");
  const seededCliPath = path.join(installRoot, "bin", "copilot.exe");

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
    version: "1.0.0",
    sdkVersion: "0.1.8",
    executableRelativePath: "bin/copilot.exe",
  });
  fs.mkdirSync(path.dirname(seededCliPath), { recursive: true });
  fs.writeFileSync(seededCliPath, "old-seeded-cli", "utf8");
  writeJson(path.join(packagedCliRoot, "package.json"), {
    name: "@github/copilot-win32-x64",
    version: "1.4.5",
  });
  fs.mkdirSync(packagedCliRoot, { recursive: true });
  fs.writeFileSync(path.join(packagedCliRoot, "copilot.exe"), "fresh-packaged-cli", "utf8");

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
  assert.equal(fs.readFileSync(seededCliPath, "utf8"), "fresh-packaged-cli");
  const refreshedManifest = JSON.parse(fs.readFileSync(path.join(installRoot, "manifest.json"), "utf8"));
  assert.equal(refreshedManifest.version, "1.4.5");
  assert.equal(refreshedManifest.sdkVersion, "0.1.9");
});
