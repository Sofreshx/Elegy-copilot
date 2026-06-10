'use strict';

/**
 * Moon Bridge bootstrap worker.
 *
 * This module is forked as a child process to run the synchronous
 * bootstrapMoonBridge() pipeline without blocking the main event loop.
 *
 * Expected to receive via process.send():
 *   { elegyHome: string, forceRebuild: boolean }
 *
 * Sends back via process.send():
 *   { ok: true, result: bootstrapMoonBridge result }
 *   or
 *   { ok: false, error: string }
 */

const { bootstrapMoonBridge } = require('./moonBridgeBootstrap');

process.on('message', (msg) => {
  try {
    const { elegyHome, forceRebuild } = msg;
    const result = bootstrapMoonBridge({ elegyHome, forceRebuild });
    process.send({ ok: true, result });
  } catch (err) {
    process.send({ ok: false, error: err.message || String(err) });
  } finally {
    // Give the IPC message time to flush, then exit
    setTimeout(() => process.exit(0), 100);
  }
});
