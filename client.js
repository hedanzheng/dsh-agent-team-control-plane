window.__ModuleLoader__.load({
  id: '@local/agent-team-control-plane',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = '/agent-team-control-plane/v1';

    const styles = {
      panel: {
        pointerEvents: 'auto', position: 'fixed', top: 76, right: 20, zIndex: 60,
        width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 190px)',
        overflow: 'auto', boxSizing: 'border-box', padding: 14,
        color: 'var(--dsw-alias-content-primary)', background: 'var(--dsw-alias-surface-raised)',
        border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,.22)', fontSize: 12,
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      section: { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-subtle)' },
      input: {
        width: '100%', boxSizing: 'border-box', marginTop: 4, marginBottom: 8, padding: '7px 8px',
        color: 'var(--dsw-alias-content-primary)', background: 'var(--dsw-alias-surface-subtle)',
        border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 6,
      },
      button: {
        border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 6,
        color: 'var(--dsw-alias-content-primary)', background: 'var(--dsw-alias-surface-subtle)',
        padding: '6px 10px', cursor: 'pointer',
      },
      tag: { padding: '2px 6px', borderRadius: 999, background: 'var(--dsw-alias-surface-subtle)' },
      card: { marginTop: 7, padding: 9, border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 7 },
      muted: { opacity: 0.72 },
    };

    function op() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function request(action, body = {}) {
      const response = await fetch(ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, operationId: op(), ...body }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) {
        const error = new Error(payload.error?.message || `HTTP ${response.status}`);
        error.code = payload.error?.code;
        throw error;
      }
      return payload.data;
    }

    function Button({ children, ...props }) {
      return h('button', { type: 'button', style: { ...styles.button, opacity: props.disabled ? 0.5 : 1 }, ...props }, children);
    }

    function RuntimeCatalog({ data, ownerId, busy, act }) {
      const cards = data.runtimes.map((runtime) => h('div', {
        key: runtime.providerKey, style: styles.card, 'data-provider-key': runtime.providerKey,
      },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('span', null, h('strong', null, runtime.displayName), ` · ${runtime.kind}`),
          h('span', { style: styles.tag }, runtime.availability)),
        h('div', { style: { ...styles.row, marginTop: 6 } },
          h('code', { style: { flex: 1 } }, runtime.providerKey),
          h(Button, {
            disabled: busy || runtime.availability !== 'AVAILABLE',
            'data-testid': `authorize-${runtime.providerKey.replace(/[^a-z0-9]/gi, '-')}`,
            onClick: () => act('authorize-runtime', {
              actor: { type: 'human', id: ownerId }, providerKey: runtime.providerKey, authorized: !runtime.authorized,
            }),
          }, runtime.authorized ? '撤销授权' : '授权'))));
      return h('div', { style: styles.section, 'data-testid': 'runtime-catalog' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', null, 'Runtime Sources'),
          h(Button, { disabled: busy, 'data-testid': 'rescan-runtimes', onClick: () => act('rescan-runtimes', { actor: { type: 'human', id: ownerId } }) }, '重新扫描')),
        cards);
    }

    function ProjectForm({ data, ownerId, busy, act }) {
      const harness = data.runtimes.filter((item) => item.kind === 'harness-agent' && item.availability === 'AVAILABLE' && item.authorized);
      const [form, setForm] = React.useState({
        name: 'Agent Team MVP', workspaceDir: 'D:\\GPT-workspace\\agent-control-plane-mvp',
        initialGoal: '', maxAgents: 3, leadRuntimeKey: harness[0]?.providerKey || '',
      });
      React.useEffect(() => {
        if (!form.leadRuntimeKey && harness[0]) setForm((value) => ({ ...value, leadRuntimeKey: harness[0].providerKey }));
      }, [harness.map((item) => item.providerKey).join('|')]);
      const field = (name, label, multiline = false) => h('label', null, label,
        h(multiline ? 'textarea' : 'input', {
          style: styles.input, value: form[name], 'data-testid': `project-${name}`,
          onChange: (event) => setForm({ ...form, [name]: event.target.value }),
        }));
      return h('div', { style: styles.section, 'data-testid': 'project-form' },
        h('strong', null, '创建 Project'),
        field('name', '名称'), field('workspaceDir', '工作目录'), field('initialGoal', '一句目标', true),
        h('label', null, 'Project Lead Runtime',
          h('select', {
            style: styles.input, value: form.leadRuntimeKey, 'data-testid': 'project-leadRuntimeKey',
            onChange: (event) => setForm({ ...form, leadRuntimeKey: event.target.value }),
          }, h('option', { value: '' }, '请先授权 Harness Runtime'), harness.map((runtime) => h('option', { key: runtime.providerKey, value: runtime.providerKey }, runtime.displayName)))),
        h(Button, {
          disabled: busy || !form.initialGoal.trim() || !form.leadRuntimeKey,
          'data-testid': 'create-project',
          onClick: () => act('create-project', {
            actor: { type: 'human', id: ownerId }, ownerId, ...form, maxAgents: Number(form.maxAgents),
          }),
        }, '创建并开始 PL 访谈'));
    }

    function Interview({ selected, ownerId, busy, act }) {
      const [answers, setAnswers] = React.useState({});
      const interview = selected.interview;
      return h('div', { style: styles.section, 'data-testid': 'charter-interview' },
        h('strong', null, `PL 需求访谈 · ${interview.mode === 'fallback' ? '内置降级流程' : 'grill-me'}`),
        interview.questions.map((question) => h('label', { key: question.id }, question.prompt,
          h('textarea', {
            style: styles.input, rows: 2, value: answers[question.id] || '',
            'data-testid': `answer-${question.id}`,
            onChange: (event) => setAnswers({ ...answers, [question.id]: event.target.value }),
          }))),
        h(Button, {
          disabled: busy || interview.questions.some((question) => !(answers[question.id] || '').trim()),
          'data-testid': 'submit-interview',
          onClick: () => act('answer-interview', {
            actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
            expectedVersion: selected.project.version, answers,
          }),
        }, '生成 Charter 草案'));
    }

    function CharterApproval({ selected, ownerId, busy, act }) {
      const charter = selected.charters[selected.charters.length - 1];
      return h('div', { style: styles.section, 'data-testid': 'charter-approval' },
        h('strong', null, `Charter v${charter.version} 待 Human 批准`),
        h('div', { style: styles.card },
          h('div', null, h('b', null, 'Mission: '), charter.mission),
          h('div', null, h('b', null, '允许范围: '), charter.scope.allowed.join('；')),
          h('div', null, h('b', null, '约束: '), charter.constraints.join('；')),
          h('div', null, h('b', null, '成功标准: '), charter.successCriteria.join('；')),
          h('div', { style: styles.muted }, `PL assumptions: ${charter.plAssumptions.join('；')}`)),
        h(Button, {
          disabled: busy, 'data-testid': 'approve-charter',
          onClick: () => act('approve-charter', {
            actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
            expectedVersion: selected.project.version,
          }),
        }, '批准 Charter 并接收 3 人团队建议'));
    }

    function TeamApproval({ selected, ownerId, busy, act }) {
      const approval = [...selected.approvals].reverse().find((item) => item.kind === 'TEAM' && item.status === 'PENDING');
      const members = approval?.payload?.members || [];
      return h('div', { style: styles.section, 'data-testid': 'team-approval' },
        h('strong', null, `团队提案 · ${members.length}/${selected.project.maxAgents}`),
        members.map((member) => h('div', { key: member.id, style: styles.card },
          h('b', null, member.displayName), ` · ${member.role}`,
          h('div', { style: styles.muted }, member.providerKey))),
        h(Button, {
          disabled: busy, 'data-testid': 'approve-team',
          onClick: () => act('approve-team', {
            actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
            expectedVersion: selected.project.version,
          }),
        }, '批准团队（仅建档，不启动模型）'));
    }

    function PLChatView({ selected }) {
      const lead = selected?.agents?.find((agent) => agent.id === selected.project.leadAgentId);
      return h('section', { style: styles.section, 'aria-labelledby': 'pl-chat-heading', 'data-testid': 'view-pl-chat' },
        h('strong', { id: 'pl-chat-heading' }, 'PL Chat'),
        h('div', { style: styles.card },
          h('div', null, '当前 DeepSeek Harness 主会话即持久 PL Chat；在主输入框描述目标与反馈。'),
          h('div', { style: styles.muted }, lead
            ? `${lead.displayName} · ${lead.id} · ${lead.providerKey}`
            : '创建 Project 后建立 Project Lead 身份。'),
          h('div', { style: styles.muted }, 'Panel 只呈现 Host Official State、审批与任务行为，不复制原始思维链或凭据。')));
    }

    function ActiveTeam({ selected, ownerId, busy, act }) {
      return h('div', { style: styles.section, 'data-testid': 'active-team' },
        h('strong', null, `Agent Records · ${selected.agents.length}/${selected.project.maxAgents}`),
        selected.agents.map((agent) => h('div', { key: agent.id, style: styles.card, 'data-testid': 'agent-record' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('b', null, agent.displayName), h('span', { style: styles.tag }, agent.status)),
          h('div', null, `${agent.role} · ${agent.providerKey}`),
          h('div', { style: styles.muted }, `Permissions: ${agent.permissions.join(', ')}`),
          h('div', { style: styles.muted }, `Skills: ${agent.skills.join(', ') || 'none'} · currentTaskId: ${agent.currentTaskId || 'none'}`),
          agent.role !== 'PROJECT_LEAD' && agent.status === 'IDLE' && !agent.currentTaskId && h(Button, {
            disabled: busy, 'data-testid': `replace-${agent.id}`,
            onClick: () => act('replace-agent', {
              actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
              expectedVersion: selected.project.version, agentId: agent.id, providerKey: agent.providerKey,
            }),
          }, '以新身份替换'))));
    }

    function TaskBoard({ selected, busy, act }) {
      const tasks = selected.tasks || [];
      const proposals = selected.taskProposals || [];
      const runs = selected.taskRuns || [];
      const results = selected.results || [];
      const evidence = selected.evidence || [];
      const worker = selected.agents.find((agent) => agent.role === 'WORKER');
      const [verificationCommand, setVerificationCommand] = React.useState('');
      const [form, setForm] = React.useState({
        title: '', goal: '', allowed: '', forbidden: '', acceptance: '', dependencies: '',
        controlLevel: 'IMPORTANT', reviewPolicy: 'PL',
      });
      const split = (value) => value.split(/\r?\n|[,，;；]/).map((item) => item.trim()).filter(Boolean);
      const field = (name, label, multiline = false) => h('label', null, label,
        h(multiline ? 'textarea' : 'input', {
          style: styles.input, value: form[name], 'data-testid': `task-${name}`,
          onChange: (event) => setForm({ ...form, [name]: event.target.value }),
        }));
      return h('div', { style: styles.section, 'data-testid': 'task-board' },
        h('strong', null, `Tasks · ${tasks.length}`),
        h('div', { style: styles.card, 'data-testid': 'task-form' },
          field('title', '标题'), field('goal', '目标', true), field('allowed', '允许范围（换行分隔）'),
          field('forbidden', '禁止范围（可空）'), field('acceptance', '验收标准（换行分隔）', true),
          field('dependencies', '依赖 Task ID（逗号分隔，可空）'),
          h('div', { style: styles.row },
            h('label', { style: { flex: 1 } }, '治理等级', h('select', {
              style: styles.input, value: form.controlLevel, 'data-testid': 'task-controlLevel',
              onChange: (event) => {
                const controlLevel = event.target.value;
                const minimum = controlLevel === 'ROUTINE' ? 'AUTO' : controlLevel === 'IMPORTANT' ? 'PL' : 'REVIEWER_PL';
                setForm({ ...form, controlLevel, reviewPolicy: minimum });
              },
            }, ['ROUTINE', 'IMPORTANT', 'CRITICAL'].map((value) => h('option', { key: value, value }, value)))),
            h('label', { style: { flex: 1 } }, '审核策略', h('select', {
              style: styles.input, value: form.reviewPolicy, 'data-testid': 'task-reviewPolicy',
              onChange: (event) => setForm({ ...form, reviewPolicy: event.target.value }),
            }, ['AUTO', 'PL', 'REVIEWER_PL'].map((value) => h('option', { key: value, value }, value))))),
          h(Button, {
            disabled: busy || !form.title.trim() || !form.goal.trim() || !form.allowed.trim() || !form.acceptance.trim(),
            'data-testid': 'create-task',
            onClick: () => act('create-task', {
              actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
              expectedProjectVersion: selected.project.version, title: form.title, goal: form.goal,
              scope: { allowed: split(form.allowed), forbidden: split(form.forbidden) },
              acceptance: split(form.acceptance), dependencies: split(form.dependencies),
              controlLevel: form.controlLevel, reviewPolicy: form.reviewPolicy,
            }),
          }, 'PL 创建正式 Task')),
        tasks.map((task) => h('div', { key: task.id, style: styles.card, 'data-testid': 'task-record', 'data-task-id': task.id },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('b', null, task.title), h('span', { style: styles.tag }, task.status)),
          h('div', { style: styles.muted }, `${task.id} · v${task.version} · Charter v${task.charterVersion}`),
          h('div', null, `${task.controlLevel} / ${task.reviewPolicy} · assignee ${task.assignedAgentId || 'none'}`),
          h('div', { style: styles.muted }, `Dependencies: ${task.dependencies.join(', ') || 'none'}`),
          task.waiting && h('div', { style: styles.muted }, `Waiting: ${task.waiting.reason} · ${task.waiting.onRef}`),
          task.status === 'READY' && !task.assignedAgentId && worker && h(Button, {
            disabled: busy, 'data-testid': `assign-${task.id}`,
            onClick: () => act('assign-task', {
              actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
              taskId: task.id, expectedVersion: task.version, agentId: worker.id,
            }),
          }, `PL 指派给 ${worker.displayName}`),
          task.status === 'READY' && task.assignedAgentId && h(Button, {
            disabled: busy, 'data-testid': `unassign-${task.id}`,
            onClick: () => act('unassign-task', {
              actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
              taskId: task.id, expectedVersion: task.version,
            }),
          }, '释放指派（未启动）'),
          task.status === 'READY' && task.assignedAgentId && h('div', { style: { marginTop: 7 } },
            h('input', {
              style: styles.input, value: verificationCommand,
              placeholder: 'Host 独立验证 PowerShell 命令（留空将得到 PARTIAL）',
              'data-testid': 'run-verification-command',
              onChange: (event) => setVerificationCommand(event.target.value),
            }),
            h(Button, {
              disabled: busy, 'data-testid': `start-run-${task.id}`,
              onClick: () => act('start-task-run', {
                actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
                taskId: task.id, expectedVersion: task.version,
                verificationCommands: verificationCommand.trim() ? [{ command: verificationCommand.trim() }] : [],
                writeIntent: true,
              }),
            }, '启动一次性 Worker Run')))),
        runs.length > 0 && h('div', { style: styles.section, 'data-testid': 'task-runs' },
          h('strong', null, `Task Runs · ${runs.length}`),
          [...runs].reverse().map((run) => {
            const result = results.find((item) => item.runId === run.id);
            const runEvidence = result ? evidence.filter((item) => item.resultId === result.id) : [];
            const active = ['CREATED', 'STARTING', 'RUNNING'].includes(run.status);
            return h('div', { key: run.id, style: styles.card, 'data-testid': 'task-run', 'data-run-id': run.id },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                h('b', null, `${run.id} · attempt ${run.attempt}`), h('span', { style: styles.tag }, run.status)),
              h('div', { style: styles.muted }, `${run.taskId} · ${run.providerKey} · watchdog ${run.watchdogState}`),
              h('div', { style: styles.muted }, `Stage: ${active ? run.status : `${run.terminalKind || run.status} → Result ${result?.outcome || 'pending'}`}`),
              result && h('div', { style: { marginTop: 5 } },
                h('b', null, `${result.outcome}: `), result.changeSummary,
                h('div', { style: styles.muted }, `Verified actions: ${result.verifiedActions.join('；') || 'none'}`),
                runEvidence.map((item) => h('div', { key: item.id, style: styles.muted }, `${item.kind} ${item.status} · ${item.ref}`))),
              active && h(Button, {
                disabled: busy, 'data-testid': `cancel-run-${run.id}`,
                onClick: () => act('cancel-task-run', {
                  actor: { type: 'pl', id: selected.project.leadAgentId }, runId: run.id,
                }),
              }, '取消 Run'));
          })),
        proposals.length > 0 && h('div', { style: styles.section, 'data-testid': 'task-proposals' },
          h('strong', null, `Task Proposals · ${proposals.length}`),
          proposals.map((proposal) => h('div', { key: proposal.id, style: styles.card, 'data-testid': 'task-proposal' },
            h('div', null, h('b', null, proposal.payload.title), ` · ${proposal.status}`),
            h('div', { style: styles.muted }, `${proposal.id} · by ${proposal.proposedByAgentId}`),
            h('div', null, proposal.payload.goal)))));
    }

    function GovernancePanel({ selected, busy, act }) {
      const requests = selected.requests || [];
      const responses = selected.responses || [];
      const reviews = selected.reviews || [];
      const findings = selected.findings || [];
      const planChecks = selected.planChecks || [];
      const decisions = selected.decisions || [];
      const submitted = (selected.tasks || []).filter((task) => task.status === 'SUBMITTED');
      const [responseBody, setResponseBody] = React.useState('');
      const [reviewIssue, setReviewIssue] = React.useState('');
      const [planNotes, setPlanNotes] = React.useState('Current evidence and dependencies remain aligned with the approved Charter.');
      const [decisionForm, setDecisionForm] = React.useState({ title: '', body: '' });
      const lead = selected.project.leadAgentId;
      const reviewer = selected.agents.find((agent) => agent.role === 'REVIEWER');
      const evidenceFor = (task) => (selected.results.find((item) => item.id === task.resultId)?.evidenceRefs || []).slice(0, 4);
      const review = (task, actor, decision) => act('submit-review', {
        actor, taskId: task.id, decision,
        issues: decision === 'REJECT' ? [reviewIssue.trim() || 'Revision required by reviewer'] : [],
        evidenceRefs: evidenceFor(task),
      });
      return h('div', { style: styles.section, 'data-testid': 'governance-panel' },
        h('strong', null, 'Requests · Reviews · Findings · Plan Checks'),
        h('div', { style: styles.section, 'data-testid': 'approval-history' },
          h('b', null, `Approval History · ${selected.approvals.length}`),
          [...selected.approvals].reverse().map((approval) => h('div', { key: approval.id, style: styles.card },
            h('span', null, `${approval.kind} · `), h('span', { style: styles.tag }, approval.status),
            h('div', { style: styles.muted }, `${approval.id} · requested ${approval.requestedBy}`)))),
        h('div', { style: styles.section, 'data-testid': 'request-mailbox' },
          h('b', null, `Request Mailbox · ${requests.length}`),
          [...requests].reverse().map((requestItem) => {
            const response = responses.find((item) => item.requestId === requestItem.id);
            const target = selected.agents.find((agent) => agent.id === requestItem.toAgentId);
            return h('div', { key: requestItem.id, style: styles.card, 'data-testid': 'request-record' },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, requestItem.id), h('span', { style: styles.tag }, requestItem.status)),
              h('div', null, `${requestItem.fromAgentId} → ${requestItem.toAgentId}`),
              h('div', { style: styles.muted }, requestItem.body),
              response && h('div', null, h('b', null, `${response.outcome}: `), response.body),
              ['PENDING', 'IN_PROGRESS'].includes(requestItem.status) && h('div', null,
                h('input', { style: styles.input, value: responseBody, placeholder: '受限 RESPONSE', 'data-testid': 'request-response-body', onChange: (event) => setResponseBody(event.target.value) }),
                h(Button, {
                  disabled: busy || !responseBody.trim() || Boolean(target?.currentTaskId), 'data-testid': `respond-${requestItem.id}`,
                  onClick: () => act('respond-request', { actor: { type: target?.role === 'PROJECT_LEAD' ? 'pl' : 'agent', id: requestItem.toAgentId }, requestId: requestItem.id, outcome: 'ANSWER', body: responseBody.trim(), evidenceRefs: [] }),
                }, target?.currentTaskId ? '接收者忙，保持排队' : '接收者提交 RESPONSE')));
          })),
        submitted.length > 0 && h('div', { style: styles.section, 'data-testid': 'review-queue' },
          h('b', null, `Review Queue · ${submitted.length}`),
          h('input', { style: styles.input, value: reviewIssue, placeholder: 'Reject 时填写明确问题', 'data-testid': 'review-issue', onChange: (event) => setReviewIssue(event.target.value) }),
          submitted.map((task) => {
            const reviewerApproved = reviews.some((item) => item.taskId === task.id && item.resultId === task.resultId && item.reviewerRole === 'REVIEWER' && item.decision === 'APPROVE');
            return h('div', { key: task.id, style: styles.card, 'data-testid': 'review-record' },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, task.title), h('span', { style: styles.tag }, task.reviewPolicy)),
              task.reviewPolicy === 'REVIEWER_PL' && !reviewerApproved && reviewer && h('div', { style: styles.row },
                h(Button, { disabled: busy, onClick: () => review(task, { type: 'agent', id: reviewer.id }, 'APPROVE') }, 'Reviewer 通过'),
                h(Button, { disabled: busy, onClick: () => review(task, { type: 'agent', id: reviewer.id }, 'REJECT') }, 'Reviewer 退回')),
              (task.reviewPolicy !== 'REVIEWER_PL' || reviewerApproved) && h('div', { style: styles.row },
                h(Button, { disabled: busy, 'data-testid': `approve-review-${task.id}`, onClick: () => review(task, { type: 'pl', id: lead }, 'APPROVE') }, 'PL 通过'),
                h(Button, { disabled: busy, 'data-testid': `reject-review-${task.id}`, onClick: () => review(task, { type: 'pl', id: lead }, 'REJECT') }, 'PL 退回')));
          })),
        h('div', { style: styles.section, 'data-testid': 'findings' },
          h('b', null, `Findings · ${findings.length}`),
          [...findings].reverse().map((finding) => h('div', { key: finding.id, style: styles.card },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, `${finding.severity} · ${finding.id}`), h('span', { style: styles.tag }, finding.status)),
            h('div', null, finding.description),
            finding.status !== 'CLOSED' && h(Button, { disabled: busy, onClick: () => act('update-finding', { actor: { type: 'pl', id: lead }, findingId: finding.id, status: 'CLOSED' }) }, 'PL 关闭')))),
        h('div', { style: styles.section, 'data-testid': 'plan-checks' },
          h('b', null, `Plan Checks · ${planChecks.length}`),
          planChecks.map((plan) => h('div', { key: plan.id, style: styles.card },
            h('div', null, h('b', null, plan.trigger), ` · ${plan.status}`),
            plan.status === 'PENDING' && h('div', null,
              h('input', { style: styles.input, value: planNotes, onChange: (event) => setPlanNotes(event.target.value) }),
              h(Button, { disabled: busy, onClick: () => act('complete-plan-check', { actor: { type: 'pl', id: lead }, planCheckId: plan.id, decision: 'KEEP_PLAN', notes: planNotes }) }, 'KEEP PLAN'))))),
        h('div', { style: styles.section, 'data-testid': 'decisions' },
          h('b', null, `Approved Decisions · ${decisions.length}`),
          decisions.map((item) => h('div', { key: item.id, style: styles.card }, h('b', null, item.title), h('div', null, item.body))),
          h('input', { style: styles.input, value: decisionForm.title, placeholder: 'Decision 标题', onChange: (event) => setDecisionForm({ ...decisionForm, title: event.target.value }) }),
          h('textarea', { style: styles.input, value: decisionForm.body, placeholder: '已批准决策正文', onChange: (event) => setDecisionForm({ ...decisionForm, body: event.target.value }) }),
          h(Button, { disabled: busy || !decisionForm.title.trim() || !decisionForm.body.trim(), onClick: () => act('record-decision', { actor: { type: 'pl', id: lead }, projectId: selected.project.id, title: decisionForm.title, body: decisionForm.body }) }, '记录批准 Decision')),
        h('section', { style: styles.section, 'aria-labelledby': 'activity-heading', 'data-testid': 'view-activity' },
          h('b', { id: 'activity-heading' }, `Activity · ${selected.activities.length}`),
          h('div', { 'data-testid': 'activity-feed' },
            [...selected.activities].slice(-12).reverse().map((item) => h('div', { key: item.id, style: styles.card }, h('b', null, item.eventType), h('div', null, item.summary), h('div', { style: styles.muted }, `${item.actorId} · ${item.createdAt}`))))));
    }

    function ControlPlanePanel() {
      const [data, setData] = React.useState(null);
      const [ownerId, setOwnerId] = React.useState('human-owner');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [collapsed, setCollapsed] = React.useState(false);
      const [createMode, setCreateMode] = React.useState(false);
      const [selectedProjectId, setSelectedProjectId] = React.useState('');

      const load = React.useCallback(async () => {
        const response = await fetch(selectedProjectId ? `${ROUTE}?projectId=${encodeURIComponent(selectedProjectId)}` : ROUTE);
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) throw new Error(payload.error?.message || `HTTP ${response.status}`);
        setData(payload.data);
        if (!selectedProjectId && payload.data.selected?.project?.id) setSelectedProjectId(payload.data.selected.project.id);
      }, [selectedProjectId]);

      React.useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
      React.useEffect(() => {
        const active = data?.selected?.taskRuns?.some((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
        if (!active) return undefined;
        const timer = setInterval(() => load().catch((e) => setError(e.message)), 1000);
        return () => clearInterval(timer);
      }, [data?.selected?.taskRuns?.map((run) => `${run.id}:${run.status}`).join('|'), load]);

      const act = async (action, body) => {
        setBusy(true); setError('');
        try {
          const next = await request(action, body);
          setData(next); setSelectedProjectId(next.selected?.project?.id || ''); setCreateMode(false);
        }
        catch (e) { setError(`${e.code ? `${e.code}: ` : ''}${e.message}`); }
        finally { setBusy(false); }
      };

      const selected = data?.selected;
      return h('section', { 'aria-label': 'Agent Team Control Plane', style: styles.panel, 'data-testid': 'control-plane' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('div', null, h('strong', { style: { fontSize: 14 } }, 'Agent Team Control Plane'),
            h('div', { style: styles.muted }, 'MVP Phase 5 · packaged Windows Desktop control plane')),
          h(Button, { 'data-testid': 'toggle-panel', onClick: () => setCollapsed(!collapsed) }, collapsed ? '展开' : '收起')),
        !collapsed && h(React.Fragment, null,
          error && h('div', { role: 'alert', 'data-testid': 'error', style: { ...styles.card, color: '#d44' } }, error),
          !data ? h('p', null, '正在读取 Host 状态…') : h(React.Fragment, null,
            h('label', null, 'Human Owner ID', h('input', { style: styles.input, value: ownerId, 'data-testid': 'owner-id', onChange: (e) => setOwnerId(e.target.value) })),
            h(PLChatView, { selected }),
            h('section', { style: styles.section, 'aria-labelledby': 'project-heading', 'data-testid': 'view-project' },
              h('strong', { id: 'project-heading' }, 'Project'),
              data.projects.length > 0 && h('label', null, '当前 Project', h('select', {
                style: styles.input, value: selected?.project?.id || '', 'data-testid': 'project-selector',
                onChange: (event) => { setSelectedProjectId(event.target.value); setCreateMode(false); },
              }, data.projects.map((project) => h('option', { key: project.id, value: project.id }, `${project.name} · ${project.status}`)))),
              h(RuntimeCatalog, { data, ownerId, busy, act }),
              selected && !createMode && h('div', { style: styles.section, 'data-testid': 'project-summary' },
                h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                  h('strong', null, selected.project.name), h('span', { style: styles.tag, 'data-testid': 'project-status' }, selected.project.status)),
                h('div', { style: styles.muted }, `${selected.project.id} · owner ${selected.project.ownerId} · version ${selected.project.version}`),
                h('div', null, h('b', null, 'Mission: '), (selected.charters.find((charter) => charter.version === selected.project.charterVersion) || selected.charters.at(-1))?.mission || selected.project.initialGoal),
                h('div', { style: styles.muted }, `Milestone: ${(selected.tasks.find((task) => !['VERIFIED', 'CANCELLED'].includes(task.status)) || {}).title || 'all scoped tasks complete'} · Completion ${selected.tasks.filter((task) => task.status === 'VERIFIED').length}/${selected.tasks.length}`),
                h('div', { style: { ...styles.row, marginTop: 7 } },
                  h(Button, { 'data-testid': 'new-project', onClick: () => setCreateMode(true) }, '新建 Project'),
                  selected.project.status === 'ACTIVE' && h(Button, {
                    disabled: busy, 'data-testid': 'stop-project',
                    onClick: () => act('stop-project', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, expectedVersion: selected.project.version, reason: 'Stopped by Human Owner from Panel' }),
                  }, '停止 Project'))),
              (!selected || createMode) && h(ProjectForm, { data, ownerId, busy, act })),
            h('section', { style: styles.section, 'aria-labelledby': 'agents-heading', 'data-testid': 'view-agents' },
              h('strong', { id: 'agents-heading' }, 'Agents'),
              selected && !createMode ? h(ActiveTeam, { selected, ownerId, busy, act }) : h('div', { style: styles.muted }, '创建并选择 Project 后显示 Agent Records。')),
            h('section', { style: styles.section, 'aria-labelledby': 'tasks-heading', 'data-testid': 'view-tasks' },
              h('strong', { id: 'tasks-heading' }, 'Tasks'),
              selected && !createMode && selected.project.status === 'ACTIVE'
                ? h(TaskBoard, { selected, busy, act })
                : h('div', { style: styles.muted }, 'Task DAG 在 Project ACTIVE 后启用。')),
            h('section', { style: styles.section, 'aria-labelledby': 'approvals-heading', 'data-testid': 'view-approvals' },
              h('strong', { id: 'approvals-heading' }, 'Approvals'),
              selected && !createMode && selected.project.status === 'CHARTER_INTERVIEW' && h(Interview, { selected, ownerId, busy, act }),
              selected && !createMode && selected.project.status === 'CHARTER_PENDING_APPROVAL' && h(CharterApproval, { selected, ownerId, busy, act }),
              selected && !createMode && selected.project.status === 'TEAM_PENDING_APPROVAL' && h(TeamApproval, { selected, ownerId, busy, act }),
              selected && !createMode && ['ACTIVE', 'STOPPED'].includes(selected.project.status) && h(GovernancePanel, { selected, busy, act }),
              (!selected || createMode) && h('div', { style: styles.muted }, '创建并选择 Project 后显示审批队列。')),
            (!selected || createMode || !['ACTIVE', 'STOPPED'].includes(selected.project.status)) && h('section', { style: styles.section, 'aria-labelledby': 'activity-heading-empty', 'data-testid': 'view-activity' },
              h('strong', { id: 'activity-heading-empty' }, 'Activity'),
              h('div', { style: styles.muted }, selected ? `当前阶段 ${selected.project.status} 的行为由 Host 持久化。` : '创建 Project 后显示 Host Activity。')))));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'agent-team-control-plane', order: 5,
        }, ControlPlanePanel));
      },
    };
  },
});
