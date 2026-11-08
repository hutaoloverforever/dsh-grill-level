/**
 * Unit tests for the policy module: the level table, the empty-off contract,
 * and the monotonic-growth property the five levels are supposed to have
 * (higher levels contain every rule of the lower ones, never fewer).
 *
 * Run: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVELS,
  RANK,
  LABELS,
  SECTION_NAME,
  SECTION_ORDER,
  PERMISSION_RULES,
  levelLabel,
  normalizeLevel,
  policySection,
  fullLoadText,
  resumeText,
} from '../lib/policy.js';

test('level table is ordered and consistent with the labels and ranks', () => {
  assert.deepEqual(LEVELS, ['off', 'low', 'medium', 'high', 'full']);
  assert.deepEqual(RANK, { off: 0, low: 1, medium: 2, high: 3, full: 4 });
  assert.deepEqual(Object.keys(LABELS), LEVELS);
  for (const level of LEVELS) assert.equal(levelLabel(level), LABELS[level]);
});

test('section identity is the stable one diagnostics report', () => {
  assert.equal(SECTION_NAME, 'grill-level:policy');
  assert.equal(SECTION_ORDER, 130);
});

test('level normalization trims, lowercases, and rejects unknown values', () => {
  assert.equal(normalizeLevel('  HIGH '), 'high');
  assert.equal(normalizeLevel('Full'), 'full');
  assert.equal(normalizeLevel('nope'), null);
  assert.equal(normalizeLevel(''), null);
  assert.equal(normalizeLevel('   '), null);
  assert.equal(normalizeLevel(undefined), null);
  assert.equal(normalizeLevel(42), null);
});

test('off injects nothing at all', () => {
  assert.equal(policySection({ level: 'off', version: 7 }), '');
  assert.equal(policySection(null), '');
  assert.equal(policySection(undefined), '');
  assert.equal(policySection({ level: 'unknown', version: 1 }), '');
});

test('every enabled level renders its own label and the live strategy version', () => {
  for (const level of ['low', 'medium', 'high', 'full']) {
    const text = policySection({ level, version: 2 });
    assert.ok(text.length > 0, `${level} must render`);
    assert.ok(text.includes(levelLabel(level)), `${level} must name its label`);
    assert.ok(text.includes('策略版本 v2'), `${level} must carry the version`);
    assert.ok(text.startsWith('## Grill me 澄清强度'), `${level} must carry the heading`);
  }
});

test('coverage grows monotonically: higher levels keep every lower-level rule', () => {
  // The "execution permission" rules are the one deliberate exception: `full`
  // drops them on purpose (it must ask even when the task looks trivial), so the
  // monotonic comparison is scoped to the per-level rule groups.
  const rulesOf = (text) =>
    text
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2))
      .filter((rule) => !PERMISSION_RULES.includes(rule));
  let previous = [];
  for (const level of ['low', 'medium', 'high', 'full']) {
    const current = rulesOf(policySection({ level, version: 1 }));
    for (const rule of previous) {
      assert.ok(current.includes(rule), `${level} must keep the rule: ${rule}`);
    }
    assert.ok(current.length > previous.length, `${level} must add at least one rule`);
    previous = current;
  }
});

test('only the full level withholds the "you may skip the interview" permissions', () => {
  assert.ok(PERMISSION_RULES.length > 0);
  for (const level of ['low', 'medium', 'high']) {
    const text = policySection({ level, version: 1 });
    for (const rule of PERMISSION_RULES) {
      assert.ok(text.includes(rule), `${level} must keep the permission: ${rule}`);
    }
  }
  const full = policySection({ level: 'full', version: 1 });
  for (const rule of PERMISSION_RULES) {
    assert.ok(!full.includes(rule), `full must not carry the permission: ${rule}`);
  }
});

test('the full level mandates a question and forbids answering outright', () => {
  const full = policySection({ level: 'full', version: 3 });
  assert.ok(full.includes('强制'), 'full must state the mandate');
  assert.ok(full.includes('禁止直接给答案'), 'full must forbid a direct answer');
  assert.ok(!full.includes('直接给出结论'), 'full must not license a direct conclusion');
  assert.ok(!full.includes('可以直接完成'), 'full must not license direct completion');
});

test('the rhythm requirements are shared by every enabled level', () => {
  const low = policySection({ level: 'low', version: 1 });
  const high = policySection({ level: 'high', version: 1 });
  assert.equal(low.split('节奏要求')[1], high.split('节奏要求')[1]);
});

test('the full level carries the resolved skill body; lower levels never do', () => {
  const body = 'SKILL BODY SENTINEL';
  const full = fullLoadText({ level: 'full', version: 4 }, body);
  assert.ok(full.includes(body));
  assert.ok(full.includes('v4'));
  for (const level of ['low', 'medium', 'high']) {
    assert.ok(!policySection({ level, version: 1 }).includes(body));
  }
});

test('the resume message names the level it resumes under', () => {
  const text = resumeText({ level: 'off', version: 5 });
  assert.ok(text.includes(levelLabel('off')));
  assert.ok(text.includes('v5'));
  assert.ok(text.includes('已中断') || text.includes('中断'));
});
