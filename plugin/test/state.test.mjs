/**
 * Unit tests for the Host half's pure pieces: argument parsing and the
 * projection fold. The fold is the only writer of session state, so these
 * tests pin down both the "changes when it should" and the "returns the same
 * reference when it should not" halves of the projection contract.
 *
 * Run: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent, parseLevelArgument, previousStateFromEvents } from '../lib/index.js';

const run = (args, time = 1000) => ({
  type: 'command/run',
  seq: 0,
  time,
  data: { commandId: 'c1', name: 'grill-level', args, source: { kind: 'user' } },
});

const at = (seq, args, time = 1000) => ({ ...run(args, time), seq });

test('arguments parse only a single known level token', () => {
  assert.equal(parseLevelArgument('high'), 'high');
  assert.equal(parseLevelArgument('  HIGH  '), 'high');
  assert.equal(parseLevelArgument(''), null);
  assert.equal(parseLevelArgument('   '), null);
  assert.equal(parseLevelArgument('high low'), null);
  assert.equal(parseLevelArgument('status'), null);
  assert.equal(parseLevelArgument('nope'), null);
  assert.equal(parseLevelArgument(undefined), null);
});

test('a different level advances the version and records the event time', () => {
  const next = applyEvent({ level: 'off', version: 0, updatedAt: 0 }, run('high', 4242));
  assert.deepEqual(next, { level: 'high', version: 1, updatedAt: 4242 });
});

test('repeating the current level does not create a new version', () => {
  const state = { level: 'high', version: 3, updatedAt: 10 };
  assert.equal(applyEvent(state, run('high', 9999)), state);
  assert.equal(state.version, 3);
});

test('unparseable arguments leave the state untouched', () => {
  const state = { level: 'medium', version: 2, updatedAt: 10 };
  assert.equal(applyEvent(state, run('bogus')), state);
  assert.equal(applyEvent(state, run('')), state);
  assert.equal(applyEvent(state, run('medium bogus')), state);
});

test('records from other commands and other event types are ignored', () => {
  const state = { level: 'low', version: 1, updatedAt: 5 };
  assert.equal(applyEvent(state, { ...run('full'), data: { name: 'permission', args: 'full' } }), state);
  assert.equal(applyEvent(state, { type: 'command/done', seq: 1, time: 9, data: { kind: 'success' } }), state);
  assert.equal(applyEvent(state, { type: 'user/message', seq: 2, time: 9, data: {} }), state);
  assert.equal(applyEvent(state, { type: 'command/run', seq: 3, time: 9, data: null }), state);
});

test('the fold is a pure function of state and event', () => {
  const state = { level: 'off', version: 0, updatedAt: 0 };
  const first = applyEvent(state, run('medium', 100));
  const second = applyEvent(state, run('medium', 100));
  assert.deepEqual(first, second);
  assert.deepEqual(state, { level: 'off', version: 0, updatedAt: 0 });
});

test('a sequence of writes converges on the last one', () => {
  let state = { level: 'off', version: 0, updatedAt: 0 };
  for (const [index, level] of ['low', 'high', 'full', 'off'].entries()) {
    state = applyEvent(state, run(level, 100 + index));
  }
  assert.deepEqual(state, { level: 'off', version: 4, updatedAt: 103 });
});

test('the previous level is recovered from the log, not from a cache', () => {
  // high (v1) -> full (v2) -> the handler for `low` runs with seq 30 already
  // appended, so the newest grill record is the one being handled.
  const events = [
    { type: 'turn/start', seq: 5, time: 10, data: { turn: 1 } },
    at(20, ' high', 20),
    at(25, ' full', 25),
    at(30, ' low', 30),
  ];
  assert.deepEqual(previousStateFromEvents(events), { level: 'full', version: 2, updatedAt: 25 });
});

test('a session with no prior writes reports the initial state', () => {
  assert.deepEqual(previousStateFromEvents([{ type: 'turn/start', seq: 1, time: 1, data: {} }]), {
    level: 'off',
    version: 0,
    updatedAt: 0,
  });
  assert.deepEqual(previousStateFromEvents([at(2, ' medium', 2)]), {
    level: 'off',
    version: 0,
    updatedAt: 0,
  });
});

test('a same-level repeat does not advance the version in the replay either', () => {
  const events = [at(1, ' high', 1), at(2, ' high', 2), at(3, ' low', 3)];
  assert.deepEqual(previousStateFromEvents(events), { level: 'high', version: 1, updatedAt: 1 });
});

test('unparseable and foreign records do not disturb the replay', () => {
  const events = [
    at(1, ' high', 1),
    at(2, ' status', 2),
    { ...at(3, ' nth'), data: { name: 'permission', args: 'high' } },
    at(4, ' full', 4),
  ];
  assert.deepEqual(previousStateFromEvents(events), { level: 'high', version: 1, updatedAt: 1 });
});
