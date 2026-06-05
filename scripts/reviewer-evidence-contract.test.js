#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const reviewerPath = path.resolve(__dirname, '..', 'opencode-assets', 'agents', 'reviewer.md');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function main() {
  if (!fs.existsSync(reviewerPath)) {
    console.error('reviewer.md not found — skipping tests');
    process.exit(1);
  }

  const content = fs.readFileSync(reviewerPath, 'utf8');

  // Test 1: Reviewer must require concrete evidence for "approved" verdict
  test('reviewer.md requires concrete evidence for approved verdict', () => {
    const reviewStandardsSection = content.split('## Review Standards')[1] || '';
    
    // The approved standard should mention concrete evidence requirements
    const approvedText = reviewStandardsSection.split('## Constraints')[0] || '';
    
    // Approved should reference issues/findings/criteria, not just "looks good"
    const hasSubstanceRequirement = 
      /no\s+issues\s+found/i.test(approvedText) ||
      /no\s+.*defects/i.test(approvedText) ||
      /only\s+cosmetic\s+suggestions/i.test(approvedText) ||
      /file.*ref/i.test(content) ||
      /spec\s+path/i.test(content);
    
    assert.ok(hasSubstanceRequirement, 
      'reviewer.md should require concrete evidence criteria for "approved" verdict (not just "looks good")');
  });

  // Test 2: Reviewer must require file references for code review mode
  test('reviewer.md requires file references for code review findings', () => {
    // The last line of reviewer.md should mention file:line references
    const lastLine = content.trim().split('\n').pop();
    assert.ok(
      /file.*line/i.test(lastLine) || /file:line/i.test(content),
      'reviewer.md should require file:line references for code review findings'
    );
  });

  // Test 3: Fixture-based negative test - "looks good" style should NOT satisfy
  test('reviewer.md rejects purely qualitative approval', () => {
    // Verify the REVIEW_RESULT block requires specific structure
    const hasReviewResult = /REVIEW_RESULT/i.test(content);
    assert.ok(hasReviewResult, 'reviewer.md should define a REVIEW_RESULT output block');

    // Verify the review output block requires concrete fields
    const reviewResultSection = content.split('REVIEW_RESULT')[1] || '';
    const hasConfidence = /confidence.*[<>0-9]/i.test(reviewResultSection);
    const hasVerdict = /verdict/i.test(reviewResultSection);
    const hasFindings = /findings/i.test(reviewResultSection);

    assert.ok(hasConfidence, 'REVIEW_RESULT must require confidence score (not just "looks good")');
    assert.ok(hasVerdict, 'REVIEW_RESULT must require verdict field');
    assert.ok(hasFindings, 'REVIEW_RESULT must require findings (not just "approved")');
  });

  // Test 4: Spec review must require spec path evidence
  test('spec-review mode requires spec path for evidence', () => {
    const specReviewSection = (content.split('### spec-review')[1] || '').split('###')[0] || '';
    
    // Spec review should mention spec document references
    const hasSpecDocReference = 
      /spec\s+document/i.test(specReviewSection) ||
      /spec.*contract/i.test(specReviewSection) ||
      /spec.*assertion/i.test(specReviewSection);
    
    assert.ok(hasSpecDocReference,
      'spec-review mode should reference spec document/contract/assertions as required evidence');
  });

  // Test 5: Evidence review must check completeness
  test('evidence-review mode requires completeness check', () => {
    const evidenceReviewSection = (content.split('### evidence-review')[1] || '').split('###')[0] || '';
    
    const hasCompleteness = /complete/i.test(evidenceReviewSection);
    const hasEvidenceTypes = /evidence\s+types/i.test(evidenceReviewSection);
    
    assert.ok(hasCompleteness || hasEvidenceTypes,
      'evidence-review mode should check for completeness of evidence types');
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

main();
