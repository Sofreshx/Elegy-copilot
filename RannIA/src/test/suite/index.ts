import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname, '.');
  
  if (process.env.TEST_INCLUDE_LIST_FILE && fs.existsSync(process.env.TEST_INCLUDE_LIST_FILE)) {
    const includeList = JSON.parse(fs.readFileSync(process.env.TEST_INCLUDE_LIST_FILE, 'utf8'));
    for (const file of includeList) {
      mocha.addFile(file);
    }
  } else {
    mocha.addFile(path.resolve(testsRoot, 'eventEmitter.test.js'));
    mocha.addFile(path.resolve(testsRoot, 'taskLifecycle.test.js'));
  }

  return new Promise((resolve, reject) => {
    try {
      const runner = mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });

      const results: Record<string, { success: boolean, durationMs: number, failedTests: any[] }> = {};

      runner.on('test end', (test) => {
        const file = test.file;
        if (!file) return;
        if (!results[file]) {
          results[file] = { success: true, durationMs: 0, failedTests: [] };
        }
        results[file].durationMs += test.duration || 0;
        if (test.state === 'failed') {
          results[file].success = false;
          results[file].failedTests.push({ title: test.title, error: test.err?.message });
        }
      });

      runner.on('end', () => {
        if (process.env.TEST_LEDGER_RESULTS_FILE) {
          fs.writeFileSync(process.env.TEST_LEDGER_RESULTS_FILE, JSON.stringify(results, null, 2));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
