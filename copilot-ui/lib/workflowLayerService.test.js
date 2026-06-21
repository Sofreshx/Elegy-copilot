'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkflowLayerService } = require('./workflowLayerService');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

async function run() {
  await test('workflow automation stays disabled after local dispatch retirement', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-layer-'));
    try {
      const service = await createWorkflowLayerService({ elegyHome: tmpRoot }).init();
      const health = service.getHealth();

      assert.equal(health.enabled, false);
      assert.equal(health.automationReason, 'local_workflow_automation_retired');
      assert.deepEqual(health.dispatchTarget, {
        state: 'retired',
        reason: 'local_workflow_automation_retired',
      });
      await assert.rejects(
        async () => service.setAutomationEnabled(true, { source: 'api' }),
        (error) => error && error.statusCode === 409
          && /dispatch is retired/i.test(String(error.message || ''))
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('workflow automation cannot be re-enabled through retired manager configuration', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-layer-'));
    try {
      const service = await createWorkflowLayerService({
        elegyHome: tmpRoot,
        legacyDispatchManager: {
          getPublicState: () => ({
            contractVersion: '1',
            state: 'ready',
          }),
          getDispatchTarget: () => ({
            triggerUrl: 'http://127.0.0.1:4111/api/triggers',
            bearerToken: 'token',
          }),
        },
      }).init();

      assert.throws(
        () => service.setAutomationEnabled(true, { source: 'api' }),
        (error) => error && error.statusCode === 409
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('environment kill switch remains explicit after dispatch retirement', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-layer-'));
    try {
      await withEnv('INSTRUCTION_ENGINE_DISABLE_LOCAL_WORKFLOW_AUTOMATION', '1', async () => {
        const service = await createWorkflowLayerService({
          elegyHome: tmpRoot,
          legacyDispatchManager: {
            getPublicState: () => ({
              contractVersion: '1',
              state: 'ready',
            }),
            getDispatchTarget: () => ({
              triggerUrl: 'http://127.0.0.1:4111/api/triggers',
              bearerToken: 'token',
            }),
          },
        }).init();

        await assert.rejects(
          async () => service.setAutomationEnabled(true, { source: 'api' }),
          (error) => error && error.statusCode === 409
            && /disabled by INSTRUCTION_ENGINE_DISABLE_LOCAL_WORKFLOW_AUTOMATION/i.test(String(error.message || ''))
        );
      });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('trigger records bind workflowId and existing-session sessionId before automation dispatch', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-layer-'));
    try {
      const service = await createWorkflowLayerService({ elegyHome: tmpRoot }).init();
      const trigger = service._buildTriggerRecord({
        type: 'executor.attempt.started',
        workflowId: 'workflow-123',
        sessionId: null,
        run: {
          id: 'run-123',
          jobId: 'job-123',
          sessionId: null,
          repoId: 'elegy-copilot',
          orchestration: {
            repo: { repoId: 'elegy-copilot' },
            workflow: {
              workflowId: 'workflow-123',
              runId: 'run-123',
              jobId: 'job-123',
              sessionId: 'session-123',
              workflowKind: 'task-execution',
            },
          },
        },
        job: {
          id: 'job-123',
          repoId: 'elegy-copilot',
          targetType: 'existing-session',
          orchestration: {
            workflow: {
              workflowId: 'workflow-123',
              sessionId: 'session-123',
            },
          },
        },
        data: null,
      });

      assert.ok(trigger);
      assert.equal(trigger.context.sessionId, 'session-123');
      assert.equal(trigger.context.workflow.workflowId, 'workflow-123');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('malformed existing-session triggers fail closed when canonical identifiers are missing', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-layer-'));
    try {
      const service = await createWorkflowLayerService({ elegyHome: tmpRoot }).init();
      const trigger = service._buildTriggerRecord({
        type: 'executor.attempt.started',
        run: {
          id: 'run-123',
          jobId: 'job-123',
          sessionId: null,
          repoId: 'elegy-copilot',
          orchestration: {
            repo: { repoId: 'elegy-copilot' },
            workflow: {},
          },
        },
        job: {
          id: '',
          repoId: 'elegy-copilot',
          targetType: 'existing-session',
          orchestration: {
            workflow: {},
          },
        },
        data: null,
      });

      assert.equal(trigger, null);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
