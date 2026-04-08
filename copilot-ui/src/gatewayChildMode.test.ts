import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPackagedGatewayChildArgs,
  GATEWAY_CHILD_FLAG,
  hasGatewayChildFlag,
  stripGatewayChildFlag,
} from './gatewayChildMode';

test('gateway child mode is detected from process args', () => {
  assert.equal(hasGatewayChildFlag(['desktop-shell.exe', '.', GATEWAY_CHILD_FLAG]), true);
  assert.equal(hasGatewayChildFlag(['desktop-shell.exe', '.']), false);
});

test('gateway child spawn args contain only the dedicated child flag', () => {
  assert.deepEqual(buildPackagedGatewayChildArgs(), [GATEWAY_CHILD_FLAG]);
});

test('gateway child flag is stripped before handing argv to the gateway cli', () => {
  assert.deepEqual(
    stripGatewayChildFlag(['desktop-shell.exe', '.', GATEWAY_CHILD_FLAG, '--mode=disconnected']),
    ['desktop-shell.exe', '.', '--mode=disconnected'],
  );
});
