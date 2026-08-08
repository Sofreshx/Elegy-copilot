'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPerformanceDiagnostics, classifyPath } = require('./performanceDiagnostics');

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.writeHead = (statusCode) => {
    res.statusCode = statusCode;
    res.headersSent = true;
  };
  res.end = () => res.emit('finish');
  return res;
}

test('emits redacted Server-Timing and aggregates only fixed API areas', () => {
  const diagnostics = createPerformanceDiagnostics({
    processService: { getDiagnostics: () => ({ inFlight: 0, byCommand: { git: 1 } }) },
  });
  const res = createResponse();
  diagnostics.beginRequest({}, res, '/api/sessions/private-session-id?token=secret');
  res.writeHead(200);
  res.end();

  assert.match(res.headers['Server-Timing'], /^app;dur=\d+\.\d$/);
  assert.equal(res.headers['Server-Timing'].includes('private'), false);
  const snapshot = diagnostics.getSnapshot();
  assert.equal(snapshot.requests.total, 1);
  assert.equal(snapshot.requests.byArea['api.sessions'], 1);
  assert.equal(JSON.stringify(snapshot).includes('private-session-id'), false);
  assert.equal(snapshot.redaction.commandsAndArguments, true);
});

test('unknown and non-api paths collapse to safe categories', () => {
  assert.equal(classifyPath('/api/dashboard/harness-sessions/summary'), 'api.dashboard');
  assert.equal(classifyPath('/api/customer-name/record-id'), 'api.other');
  assert.equal(classifyPath('/workspace/customer-name'), 'static');
});
