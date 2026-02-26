import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      TEST_INCLUDE_LIST_FILE: process.env.TEST_INCLUDE_LIST_FILE,
      TEST_LEDGER_RESULTS_FILE: process.env.TEST_LEDGER_RESULTS_FILE
    }
  });
}

main().catch((error) => {
  console.error('Failed to run tests');
  console.error(error);
  process.exit(1);
});
