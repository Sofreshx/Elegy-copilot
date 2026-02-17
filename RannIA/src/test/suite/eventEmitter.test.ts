import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExtensionEventEmitter } from '../../eventEmitter';

suite('ExtensionEventEmitter', () => {
  test('emits only to matching subscriptions', () => {
    const output = vscode.window.createOutputChannel('Test Output');
    const emitter = new ExtensionEventEmitter(output);
    const received: Array<{ clientId: string; type: string }> = [];

    emitter.setBroadcastCallback((clientId, event) => {
      received.push({ clientId, type: event.type });
    });

    emitter.subscribe('client-1', ['session_started'], ['session-1']);
    emitter.emitSessionStarted('session-1', 'agent', 'prompt');
    emitter.emitSessionProgress('session-1', 'working');

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].clientId, 'client-1');
    assert.strictEqual(received[0].type, 'session_started');

    emitter.dispose();
    output.dispose();
  });

  test('filters event history by type and session', () => {
    const output = vscode.window.createOutputChannel('Test Output');
    const emitter = new ExtensionEventEmitter(output);

    emitter.emitSessionStarted('session-a', 'agent', 'prompt');
    emitter.emitSessionProgress('session-b', 'step');

    const history = emitter.getEventHistory(['session_started'], ['session-a']);

    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].type, 'session_started');

    emitter.dispose();
    output.dispose();
  });
});
