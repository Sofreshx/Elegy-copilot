import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeInstructionQuality, splitSentences } from './validate-instruction-quality.mjs';

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-instruction-quality-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(root, name, body) {
  const dir = path.join(root, 'catalog-assets', 'shared-skills', name);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'SKILL.md');
  fs.writeFileSync(filePath, [
    '---',
    `name: ${name}`,
    'description: Test skill fixture.',
    '---',
    '',
    body,
    '',
  ].join('\n'), 'utf8');
  return filePath;
}

test('instruction quality detects pseudo-theory and vague prompt language', () => {
  withTempRepo((root) => {
    writeSkill(root, 'bad-skill', [
      'Use this cognitive load framing to make it robust.',
      'Prefer one pretrained word for routing.',
    ].join('\n'));

    const result = analyzeInstructionQuality(root);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.id).sort(),
      ['pseudo-cognitive-load', 'pseudo-pretrained-word', 'vague-make-robust'],
    );
  });
});

test('instruction quality ignores banned examples inside inline code', () => {
  withTempRepo((root) => {
    writeSkill(root, 'example-skill', 'Reject vague text such as `make it robust` and `cognitive load`.');

    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.length, 0);
  });
});

test('instruction quality rejects generic reasoning intensity', () => {
  withTempRepo((root) => {
    writeSkill(root, 'careful', 'Plan carefully before editing.');
    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.some((item) => item.id === 'vague-careful-reasoning'), true);
  });
});

test('instruction quality rejects generic directive bullets', () => {
  withTempRepo((root) => {
    writeSkill(root, 'generic', '- Focus on quality and correctness throughout.');
    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.some((item) => item.id === 'non-actionable-directive'), true);
  });
});

test('instruction quality accepts a directive with an explicit check', () => {
  withTempRepo((root) => {
    writeSkill(root, 'specific', '- Run `npm test` after changing parser behavior.');
    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.length, 0);
  });
});

test('instruction quality rejects generic numbered directives', () => {
  withTempRepo((root) => {
    writeSkill(root, 'numbered-generic', '1. Focus on quality and correctness throughout.');
    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.some((item) => item.id === 'non-actionable-directive'), true);
  });
});

test('instruction quality ignores quoted negative examples', () => {
  withTempRepo((root) => {
    writeSkill(root, 'negative-example', 'Reject instructions that say "plan carefully" or "be concise".');
    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.length, 0);
  });
});

test('instruction quality detects repeated long sentences', () => {
  withTempRepo((root) => {
    const sentence = 'This instruction repeats a long operational sentence so the validator can catch duplicated prompt content in maintained instruction assets.';
    writeSkill(root, 'duplicate-skill', `${sentence}\n\n${sentence}`);

    const result = analyzeInstructionQuality(root);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].id, 'duplicate-sentence');
  });
});

test('splitSentences excludes fenced code content', () => {
  const result = splitSentences([
    '```',
    'This sentence is intentionally long enough that it would be included if fenced code were scanned.',
    '```',
    'This operational sentence is intentionally long enough to be returned by the sentence splitter.',
  ].join('\n'));

  assert.deepEqual(result, [
    'This operational sentence is intentionally long enough to be returned by the sentence splitter.',
  ]);
});
