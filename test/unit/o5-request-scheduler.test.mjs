import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestDispatchScheduler } from '../../src/host/request-scheduler.js';

function fakeClock(start = Date.parse('2026-10-26T00:00:00.000Z')) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    nowMs: () => now,
    setTimer(fn, delay) { const id = ++nextId; timers.set(id, { due: now + delay, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    get pendingTimers() { return timers.size; },
    get nextDelayMs() { return Math.min(...[...timers.values()].map((timer) => timer.due - now)); },
    advance(ms) {
      const end = now + ms;
      let steps = 0;
      for (;;) {
        const next = [...timers].sort((left, right) => left[1].due - right[1].due)[0];
        if (!next || next[1].due > end) break;
        assert.ok(++steps < 100, 'scheduler created a busy loop');
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}

test('O5 idle scheduler coalesces wakeups and avoids one-second polling', () => {
  const clock = fakeClock();
  const calls = { timeout: 0, dispatch: 0, schedule: 0 };
  const governance = {
    timeoutExpiredRequests() { calls.timeout += 1; },
    dispatchPendingRequests() { calls.dispatch += 1; return 0; },
    requestQueueSchedule() { calls.schedule += 1; return { count: 0, deadlineAt: null }; },
  };
  const scheduler = new RequestDispatchScheduler({ governance, ...clock, idleFallbackMs: 30000 });
  scheduler.start();
  scheduler.wake();
  scheduler.wake();
  assert.equal(clock.pendingTimers, 1);
  clock.advance(0);
  assert.deepEqual(calls, { timeout: 1, dispatch: 1, schedule: 1 });
  assert.equal(clock.nextDelayMs, 30000);
  clock.advance(29999);
  assert.equal(calls.dispatch, 1);
  clock.advance(1);
  assert.equal(calls.dispatch, 2);
  scheduler.stop();
  assert.equal(clock.pendingTimers, 0);
  clock.advance(60000);
  assert.equal(calls.dispatch, 2);
});

test('O5 pending deadline fires on time and released recipient wakes dispatch immediately', () => {
  const clock = fakeClock();
  let pending = 1;
  let busy = true;
  let dispatches = 0;
  let starts = 0;
  let timeouts = 0;
  const deadlineAt = new Date(clock.nowMs() + 1000).toISOString();
  const governance = {
    timeoutExpiredRequests() {
      if (pending && clock.nowMs() >= Date.parse(deadlineAt)) { pending = 0; timeouts += 1; }
    },
    dispatchPendingRequests() {
      dispatches += 1;
      if (pending && !busy && !starts) { starts += 1; pending = 0; }
      return starts;
    },
    requestQueueSchedule() { return { count: pending, deadlineAt: pending ? deadlineAt : null }; },
  };
  const scheduler = new RequestDispatchScheduler({ governance, ...clock, pendingFallbackMs: 15000 });
  scheduler.start();
  clock.advance(0);
  assert.equal(clock.nextDelayMs, 1000);
  busy = false;
  scheduler.wake();
  scheduler.wake();
  clock.advance(0);
  assert.equal(starts, 1);
  assert.equal(timeouts, 0);
  assert.equal(dispatches, 2);
  scheduler.stop();

  const timeoutClock = fakeClock();
  let timeoutCount = 0;
  const timeoutScheduler = new RequestDispatchScheduler({
    ...timeoutClock,
    governance: {
      timeoutExpiredRequests() { if (timeoutClock.nowMs() >= Date.parse(deadlineAt)) timeoutCount += 1; },
      dispatchPendingRequests() { return 0; },
      requestQueueSchedule() { return timeoutCount ? { count: 0, deadlineAt: null } : { count: 1, deadlineAt }; },
    },
  });
  timeoutScheduler.start();
  timeoutClock.advance(0);
  timeoutClock.advance(1000);
  assert.equal(timeoutCount, 1);
  timeoutScheduler.stop();
});

test('O5 wake during dispatch is not lost or dispatched concurrently', () => {
  const clock = fakeClock();
  let scheduler;
  let dispatches = 0;
  const governance = {
    timeoutExpiredRequests() {},
    dispatchPendingRequests() {
      dispatches += 1;
      if (dispatches === 1) scheduler.wake();
      return 0;
    },
    requestQueueSchedule() { return { count: 0, deadlineAt: null }; },
  };
  scheduler = new RequestDispatchScheduler({ governance, ...clock });
  scheduler.start();
  clock.advance(0);
  assert.equal(dispatches, 2);
  assert.equal(clock.pendingTimers, 1);
  assert.equal(clock.nextDelayMs, 30000);
  scheduler.stop();
});
