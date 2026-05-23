'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listRuns,
  getRun,
  createRun,
  updateRunStep,
  cancelRun,
} = require('./workflowTemplateService');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

async function run() {
  console.log('\nWorkflow Template Service Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-tpl-'));
  const copilotHome = path.join(tmpRoot, '.copilot');

  try {
    // ------------------------------------------------------------------
    // Template CRUD
    // ------------------------------------------------------------------

    await test('createTemplate returns a valid template with generated IDs', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Deploy Pipeline',
        description: 'Standard deploy workflow',
        steps: [
          { label: 'Build', objective: 'Compile the code' },
          { label: 'Test', objective: 'Run test suite', actorRole: 'reviewer', approvalRequired: true, triggerCondition: 'on-approve' },
        ],
      });
      assert.ok(tpl.templateId.startsWith('wft-'), 'templateId prefix');
      assert.equal(tpl.name, 'Deploy Pipeline');
      assert.equal(tpl.description, 'Standard deploy workflow');
      assert.equal(tpl.steps.length, 2);
      assert.ok(tpl.steps[0].stepId.startsWith('wfs-'), 'stepId prefix');
      assert.equal(tpl.steps[0].label, 'Build');
      assert.equal(tpl.steps[0].objective, 'Compile the code');
      assert.equal(tpl.steps[0].actorRole, 'implementer');
      assert.equal(tpl.steps[0].isolationMode, 'shared');
      assert.equal(tpl.steps[0].approvalRequired, false);
      assert.equal(tpl.steps[0].triggerCondition, 'on-complete');
      assert.equal(tpl.steps[1].actorRole, 'reviewer');
      assert.equal(tpl.steps[1].approvalRequired, true);
      assert.equal(tpl.steps[1].triggerCondition, 'on-approve');
      assert.ok(tpl.createdAt, 'createdAt set');
      assert.ok(tpl.updatedAt, 'updatedAt set');
    });

    await test('listTemplates returns all templates sorted by name', async () => {
      createTemplate(copilotHome, {
        name: 'Alpha Workflow',
        steps: [{ label: 'Step 1', objective: 'Do alpha' }],
      });
      createTemplate(copilotHome, {
        name: 'Zeta Workflow',
        steps: [{ label: 'Step 1', objective: 'Do zeta' }],
      });
      const list = listTemplates(copilotHome);
      assert.ok(list.length >= 3, 'at least 3 templates');
      const names = list.map((t) => t.name);
      const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      assert.deepEqual(names, sorted, 'sorted by name');
    });

    await test('getTemplate returns the correct template', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Get Test',
        steps: [{ label: 'Only Step', objective: 'Test get' }],
      });
      const fetched = getTemplate(copilotHome, tpl.templateId);
      assert.ok(fetched, 'template found');
      assert.equal(fetched.templateId, tpl.templateId);
      assert.equal(fetched.name, 'Get Test');
    });

    await test('getTemplate returns null for non-existent ID', async () => {
      const result = getTemplate(copilotHome, 'wft-nonexistent-id');
      assert.equal(result, null);
    });

    await test('updateTemplate merges fields and updates updatedAt', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Update Me',
        description: 'Old desc',
        steps: [{ label: 'S1', objective: 'O1' }],
      });
      const updated = updateTemplate(copilotHome, tpl.templateId, {
        name: 'Updated Name',
        description: 'New desc',
      });
      assert.ok(updated, 'returned updated template');
      assert.equal(updated.name, 'Updated Name');
      assert.equal(updated.description, 'New desc');
      assert.equal(updated.steps.length, 1, 'steps unchanged');
      assert.ok(updated.updatedAt >= tpl.updatedAt, 'updatedAt advanced');
    });

    await test('updateTemplate with new steps replaces steps', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Steps Replace',
        steps: [{ label: 'Old', objective: 'Old obj' }],
      });
      const updated = updateTemplate(copilotHome, tpl.templateId, {
        steps: [
          { label: 'New1', objective: 'New obj 1' },
          { label: 'New2', objective: 'New obj 2' },
        ],
      });
      assert.equal(updated.steps.length, 2);
      assert.equal(updated.steps[0].label, 'New1');
      assert.equal(updated.steps[1].label, 'New2');
    });

    await test('updateTemplate returns null for non-existent ID', async () => {
      const result = updateTemplate(copilotHome, 'wft-does-not-exist', { name: 'No' });
      assert.equal(result, null);
    });

    await test('deleteTemplate removes the template file', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Delete Me',
        steps: [{ label: 'S', objective: 'O' }],
      });
      const deleted = deleteTemplate(copilotHome, tpl.templateId);
      assert.equal(deleted, true);
      const fetched = getTemplate(copilotHome, tpl.templateId);
      assert.equal(fetched, null);
    });

    await test('deleteTemplate returns false for non-existent ID', async () => {
      const result = deleteTemplate(copilotHome, 'wft-no-such-template');
      assert.equal(result, false);
    });

    // ------------------------------------------------------------------
    // Input validation
    // ------------------------------------------------------------------

    await test('createTemplate rejects missing name', async () => {
      let threw = false;
      try {
        createTemplate(copilotHome, { name: '', steps: [{ label: 'S', objective: 'O' }] });
      } catch (e) {
        threw = true;
        assert.ok(e.message.includes('name'), 'error mentions name');
      }
      assert.ok(threw, 'expected error');
    });

    await test('createTemplate rejects empty steps', async () => {
      let threw = false;
      try {
        createTemplate(copilotHome, { name: 'Valid', steps: [] });
      } catch (e) {
        threw = true;
        assert.ok(e.message.includes('step'), 'error mentions step');
      }
      assert.ok(threw, 'expected error');
    });

    await test('createTemplate rejects step without label', async () => {
      let threw = false;
      try {
        createTemplate(copilotHome, { name: 'Valid', steps: [{ label: '', objective: 'O' }] });
      } catch (e) {
        threw = true;
        assert.ok(e.message.includes('label'), 'error mentions label');
      }
      assert.ok(threw, 'expected error');
    });

    await test('createTemplate rejects step without objective', async () => {
      let threw = false;
      try {
        createTemplate(copilotHome, { name: 'Valid', steps: [{ label: 'L', objective: '' }] });
      } catch (e) {
        threw = true;
        assert.ok(e.message.includes('objective'), 'error mentions objective');
      }
      assert.ok(threw, 'expected error');
    });

    // ------------------------------------------------------------------
    // Run lifecycle
    // ------------------------------------------------------------------

    await test('createRun creates a run from a template with all steps pending', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Run Source',
        steps: [
          { label: 'S1', objective: 'O1' },
          { label: 'S2', objective: 'O2' },
          { label: 'S3', objective: 'O3' },
        ],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId, projectId: 'proj-1' });
      assert.ok(r.workflowRunId.startsWith('wfr-'), 'runId prefix');
      assert.equal(r.templateId, tpl.templateId);
      assert.equal(r.projectId, 'proj-1');
      assert.equal(r.status, 'running');
      assert.equal(r.currentStepIndex, 0);
      assert.equal(r.steps.length, 3);
      for (const step of r.steps) {
        assert.equal(step.status, 'pending');
        assert.equal(step.sessionId, null);
        assert.equal(step.outcome, null);
      }
      assert.ok(r.launchedAt, 'launchedAt set');
      assert.equal(r.completedAt, null);
    });

    await test('createRun throws for non-existent template', async () => {
      let threw = false;
      try {
        createRun(copilotHome, { templateId: 'wft-ghost' });
      } catch (e) {
        threw = true;
        assert.equal(e.statusCode, 404);
      }
      assert.ok(threw, 'expected error');
    });

    await test('updateRunStep advances currentStepIndex on completion', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Advance Test',
        steps: [
          { label: 'S1', objective: 'O1' },
          { label: 'S2', objective: 'O2' },
        ],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      const now = new Date().toISOString();

      const r1 = updateRunStep(copilotHome, r.workflowRunId, 0, {
        status: 'completed',
        startedAt: now,
        completedAt: now,
        outcome: 'success',
      });
      assert.equal(r1.currentStepIndex, 1, 'advanced to step 1');
      assert.equal(r1.status, 'running', 'still running');
      assert.equal(r1.steps[0].status, 'completed');
      assert.equal(r1.steps[0].outcome, 'success');
    });

    await test('updateRunStep completes run when last step completes', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Complete Test',
        steps: [{ label: 'Only', objective: 'Single step' }],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      const now = new Date().toISOString();

      const r1 = updateRunStep(copilotHome, r.workflowRunId, 0, {
        status: 'completed',
        completedAt: now,
      });
      assert.equal(r1.status, 'completed');
      assert.ok(r1.completedAt, 'completedAt set');
    });

    await test('updateRunStep sets run to failed when step fails', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Fail Test',
        steps: [
          { label: 'S1', objective: 'O1' },
          { label: 'S2', objective: 'O2' },
        ],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      const r1 = updateRunStep(copilotHome, r.workflowRunId, 0, { status: 'failed' });
      assert.equal(r1.status, 'failed');
      assert.equal(r1.steps[0].status, 'failed');
    });

    await test('updateRunStep returns null for non-existent run', async () => {
      const result = updateRunStep(copilotHome, 'wfr-nonexistent', 0, { status: 'completed' });
      assert.equal(result, null);
    });

    await test('updateRunStep throws for invalid step index', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Index Test',
        steps: [{ label: 'S1', objective: 'O1' }],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      let threw = false;
      try {
        updateRunStep(copilotHome, r.workflowRunId, 99, { status: 'completed' });
      } catch (e) {
        threw = true;
        assert.equal(e.statusCode, 400);
      }
      assert.ok(threw, 'expected error');
    });

    await test('cancelRun sets status to cancelled with completedAt', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Cancel Test',
        steps: [{ label: 'S1', objective: 'O1' }],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      const cancelled = cancelRun(copilotHome, r.workflowRunId);
      assert.equal(cancelled.status, 'cancelled');
      assert.ok(cancelled.completedAt, 'completedAt set');
    });

    await test('cancelRun returns null for non-existent run', async () => {
      const result = cancelRun(copilotHome, 'wfr-ghost');
      assert.equal(result, null);
    });

    await test('getRun returns null for non-existent run', async () => {
      const result = getRun(copilotHome, 'wfr-nonexistent');
      assert.equal(result, null);
    });

    // ------------------------------------------------------------------
    // listRuns filtering
    // ------------------------------------------------------------------

    await test('listRuns filters by projectId and status', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Filter Source',
        steps: [{ label: 'S1', objective: 'O1' }],
      });
      createRun(copilotHome, { templateId: tpl.templateId, projectId: 'proj-filter' });
      const r2 = createRun(copilotHome, { templateId: tpl.templateId, projectId: 'proj-filter' });
      cancelRun(copilotHome, r2.workflowRunId);
      createRun(copilotHome, { templateId: tpl.templateId, projectId: 'proj-other' });

      const byProject = listRuns(copilotHome, { projectId: 'proj-filter' });
      assert.ok(byProject.length >= 2, 'at least 2 for project');
      assert.ok(byProject.every((r) => r.projectId === 'proj-filter'), 'all match projectId');

      const byStatus = listRuns(copilotHome, { status: 'cancelled' });
      assert.ok(byStatus.length >= 1, 'at least 1 cancelled');
      assert.ok(byStatus.every((r) => r.status === 'cancelled'), 'all match status');

      const combined = listRuns(copilotHome, { projectId: 'proj-filter', status: 'running' });
      assert.ok(combined.length >= 1, 'at least 1 running in proj-filter');
      assert.ok(combined.every((r) => r.projectId === 'proj-filter' && r.status === 'running'), 'all match both');
    });

    await test('listRuns returns results sorted by launchedAt desc', async () => {
      const all = listRuns(copilotHome);
      for (let i = 1; i < all.length; i++) {
        assert.ok(all[i - 1].launchedAt >= all[i].launchedAt, `run ${i - 1} launchedAt >= run ${i} launchedAt`);
      }
    });

    await test('updateRunStep sets sessionId on a step', async () => {
      const tpl = createTemplate(copilotHome, {
        name: 'Session Test',
        steps: [{ label: 'S1', objective: 'O1' }],
      });
      const r = createRun(copilotHome, { templateId: tpl.templateId });
      const updated = updateRunStep(copilotHome, r.workflowRunId, 0, {
        status: 'running',
        sessionId: 'sess-123',
        startedAt: new Date().toISOString(),
      });
      assert.equal(updated.steps[0].sessionId, 'sess-123');
      assert.equal(updated.steps[0].status, 'running');
    });

  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
