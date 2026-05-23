'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EMBEDDED_DESKTOP_PLANNING_DB_URL,
  createEmbeddedPGlitePlanningPersistenceClient,
} = require('./planningPersistenceClient');

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

(async () => {
  await test('embedded PGlite client persists planning rows across reopen', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planning-client-'));
    const dataDir = path.join(tempRoot, 'db');
    const firstClient = createEmbeddedPGlitePlanningPersistenceClient({ dataDir });

    try {
      assert.strictEqual(EMBEDDED_DESKTOP_PLANNING_DB_URL, 'postgresql://desktop-local/planning');

      await firstClient.query(`
        CREATE TABLE planning_records (
          record_id TEXT PRIMARY KEY,
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const insertResult = await firstClient.query(
        'INSERT INTO planning_records (record_id, state) VALUES ($1, $2::jsonb) RETURNING record_id, state',
        ['idea-1', JSON.stringify({ title: 'Desktop runtime', ready: true })],
      );

      assert.strictEqual(insertResult.rowCount, 1);
      assert.deepStrictEqual(insertResult.rows[0], {
        record_id: 'idea-1',
        state: {
          title: 'Desktop runtime',
          ready: true,
        },
      });
    } finally {
      await firstClient.close();
    }

    const reopenedClient = createEmbeddedPGlitePlanningPersistenceClient({ dataDir });
    try {
      const rowsResult = await reopenedClient.query(
        'SELECT record_id, state FROM planning_records WHERE record_id = ANY($1::text[]) ORDER BY record_id ASC',
        [['idea-1']],
      );

      assert.strictEqual(rowsResult.rowCount, 1);
      assert.deepStrictEqual(rowsResult.rows[0], {
        record_id: 'idea-1',
        state: {
          title: 'Desktop runtime',
          ready: true,
        },
      });
    } finally {
      await reopenedClient.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  if (process.exitCode && process.exitCode !== 0) {
    return;
  }

  console.log(`${passed} planning persistence client test(s) passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
