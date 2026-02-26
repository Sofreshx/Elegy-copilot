const fs = require('fs');

class LedgerReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
  }

  onRunComplete(contexts, results) {
    const resultsFile = process.env.TEST_LEDGER_RESULTS_FILE;
    if (!resultsFile) return;

    const ledgerResults = {};
    for (const testResult of results.testResults) {
      const success = testResult.numFailingTests === 0 && !testResult.testExecError;
      const durationMs = testResult.perfStats.end - testResult.perfStats.start;
      const stderr = testResult.failureMessage || '';
      
      ledgerResults[testResult.testFilePath] = {
        success,
        durationMs,
        stderr
      };
    }

    fs.writeFileSync(resultsFile, JSON.stringify(ledgerResults, null, 2));
  }
}

module.exports = LedgerReporter;