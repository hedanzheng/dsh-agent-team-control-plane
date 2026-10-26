// O5: Request delivery is event-driven for creation/recipient release, with a
// bounded low-frequency fallback. The next actual deadline wins over fallback.
// This never invokes an LLM; only existing Host SQLite/dispatch operations.
export class RequestDispatchScheduler {
  constructor({ governance, logger = console, idleFallbackMs = 30000, pendingFallbackMs = 15000,
    nowMs = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.governance = governance;
    this.logger = logger;
    this.idleFallbackMs = idleFallbackMs;
    this.pendingFallbackMs = pendingFallbackMs;
    this.nowMs = nowMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.active = false;
    this.timer = null;
    this.nextDelayMs = null;
    this.running = false;
    this.wakeQueued = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.wake();
  }

  stop() {
    this.active = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.nextDelayMs = null;
    this.wakeQueued = false;
  }

  schedule(delayMs) {
    if (!this.active) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.nextDelayMs = Math.max(0, Math.ceil(delayMs));
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.nextDelayMs = null;
      this.tick();
    }, this.nextDelayMs);
    this.timer?.unref?.();
  }

  wake() {
    if (!this.active) return;
    if (this.running) { this.wakeQueued = true; return; }
    if (this.nextDelayMs === 0) return;
    this.schedule(0);
  }

  tick() {
    if (!this.active || this.running) return;
    this.running = true;
    let delay = this.idleFallbackMs;
    try {
      this.governance.timeoutExpiredRequests();
      this.governance.dispatchPendingRequests();
      const { count, deadlineAt } = this.governance.requestQueueSchedule();
      if (count > 0) {
        const untilDeadline = Date.parse(deadlineAt) - this.nowMs();
        delay = Number.isFinite(untilDeadline)
          ? Math.min(this.pendingFallbackMs, Math.max(1000, untilDeadline))
          : this.pendingFallbackMs;
      }
    } catch (error) {
      this.logger.warn(`agent-team-control-plane request scheduler failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      const nextDelay = this.wakeQueued ? 0 : delay;
      this.wakeQueued = false;
      this.schedule(nextDelay);
    }
  }
}
