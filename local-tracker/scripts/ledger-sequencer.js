const Sequencer = require('@jest/test-sequencer').default;
const fs = require('fs');

class LedgerSequencer extends Sequencer {
  sort(tests) {
    const includeListFile = process.env.TEST_INCLUDE_LIST_FILE;
    if (!includeListFile || !fs.existsSync(includeListFile)) {
      return Array.from(tests);
    }

    const includeList = JSON.parse(fs.readFileSync(includeListFile, 'utf8'));
    const includeSet = new Set(includeList);

    return Array.from(tests).filter(test => includeSet.has(test.path));
  }
}

module.exports = LedgerSequencer;