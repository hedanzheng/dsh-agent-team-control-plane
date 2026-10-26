import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('R7 Panel blocks unverified Runs and exposes explicit Human/PL recovery actions', () => {
  const source = readFileSync(resolve('client.js'), 'utf8');
  assert.doesNotMatch(source, /不使用验证命令（结果将始终为 PARTIAL）/);
  assert.match(source, /请选择验证命令（必选）/);
  assert.match(source, /disabled: busy \|\| !approvedCommandIds\.has\(commandByTask\[task\.id\]\)/);
  assert.match(source, /data-testid': `owner-accept-risk-\$\{task\.id\}`/);
  assert.match(source, /acceptRisk/);
  assert.match(source, /data-testid': `cancel-task-\$\{task\.id\}`/);
  assert.match(source, /取消 \/ 取代 Task/);
});

test('R7 HTTP boundary rejects empty verification command selections', () => {
  const source = readFileSync(resolve('src/host/http-router.js'), 'utf8');
  assert.match(source, /VERIFICATION_COMMAND_REQUIRED/);
  assert.match(source, /verification_command_ids\.length === 0/);
});
