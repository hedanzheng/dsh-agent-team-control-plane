window.__ModuleLoader__.load({
  id: '@local/agent-team-control-plane',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = '/agent-team-control-plane/v1';

    const styles = {
      page: {
        height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxSizing: 'border-box', color: 'var(--dsw-alias-content-primary)',
        background: 'var(--dsw-alias-surface-base)', fontSize: 13,
      },
      header: {
        flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, padding: '20px 28px 14px', borderBottom: '1px solid var(--dsw-alias-border-subtle)',
        background: 'var(--dsw-alias-surface-raised)',
      },
      tabBar: {
        flex: '0 0 auto', display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 28px',
        borderBottom: '1px solid var(--dsw-alias-border-subtle)', background: 'var(--dsw-alias-surface-raised)',
      },
      tab: {
        whiteSpace: 'nowrap', border: '1px solid transparent', borderRadius: 7, padding: '7px 12px',
        color: 'var(--dsw-alias-content-secondary)', background: 'transparent', cursor: 'pointer',
      },
      body: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '20px 28px 40px' },
      content: { width: '100%', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      section: { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-subtle)' },
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
      card: {
        minWidth: 0, marginTop: 8, padding: 11, overflowWrap: 'anywhere',
        border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 8,
        background: 'var(--dsw-alias-surface-raised)',
      },
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

    function PLChatView({ selected, busy, onOpenPLChat }) {
      const lead = selected?.agents?.find((agent) => agent.id === selected.project.leadAgentId);
      return h('section', { style: styles.section, 'aria-labelledby': 'pl-chat-heading', 'data-testid': 'view-pl-chat' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', { id: 'pl-chat-heading' }, 'PL Chat'),
          h(Button, { disabled: !selected || busy, 'data-testid': 'open-pl-chat', onClick: () => onOpenPLChat(selected) }, '新建并启动 PL 对话')),
        h('div', { style: styles.card },
          h('div', null, '每个 Project 使用独立的 DeepSeek 对话作为 Human 与 PL 的主要沟通窗口。'),
          h('div', { style: styles.muted }, lead
            ? `${lead.displayName} · ${lead.id} · ${lead.providerKey}`
            : '创建 Project 后建立 Project Lead 身份。'),
          h('div', { style: styles.muted }, '控制台负责 Project、审批、任务与审计；对话窗口负责向 PL 描述目标和反馈。')));
    }

    function ActiveTeam({ selected, ownerId, busy, act }) {
      const [replaceTarget, setReplaceTarget] = React.useState('');
      const activeAgents = selected.agents.filter((agent) => agent.status !== 'REPLACED');
      const replacedAgents = selected.agents.filter((agent) => agent.status === 'REPLACED');
      return h('div', { style: styles.section, 'data-testid': 'active-team' },
        h('strong', null, `Active Agent Records · ${activeAgents.length}/${selected.project.maxAgents}`),
        activeAgents.map((agent) => h('div', { key: agent.id, style: styles.card, 'data-testid': 'agent-record' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('b', null, agent.displayName), h('span', { style: styles.tag }, agent.status)),
          h('div', null, `${agent.role} · ${agent.providerKey}`),
          h('div', { style: styles.muted }, `Permissions: ${agent.permissions.join(', ')}`),
          h('div', { style: styles.muted }, `Skills: ${agent.skills.join(', ') || 'none'} · currentTaskId: ${agent.currentTaskId || 'none'}`),
          agent.role !== 'PROJECT_LEAD' && agent.status === 'IDLE' && !agent.currentTaskId && replaceTarget !== agent.id && h(Button, {
            disabled: busy, 'data-testid': `replace-${agent.id}`, onClick: () => setReplaceTarget(agent.id),
          }, '更换此 Agent'),
          replaceTarget === agent.id && h('div', { style: { ...styles.row, marginTop: 8 } },
            h('span', null, '确认停用当前身份并创建新的 Agent Record？'),
            h(Button, {
              disabled: busy, 'data-testid': `confirm-replace-${agent.id}`,
              onClick: async () => {
                await act('replace-agent', {
                  actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
                  expectedVersion: selected.project.version, agentId: agent.id, providerKey: agent.providerKey,
                });
                setReplaceTarget('');
              },
            }, '确认更换'),
            h(Button, { disabled: busy, onClick: () => setReplaceTarget('') }, '取消')))),
        replacedAgents.length > 0 && h('details', { style: styles.card },
          h('summary', { style: { cursor: 'pointer' } }, `已替换历史 · ${replacedAgents.length}`),
          replacedAgents.map((agent) => h('div', { key: agent.id, style: { ...styles.muted, marginTop: 7 } },
            `${agent.displayName} · ${agent.role} · ${agent.providerKey} · ${agent.id}`))));
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
          h(Button, { disabled: busy || !decisionForm.title.trim() || !decisionForm.body.trim(), onClick: () => act('record-decision', { actor: { type: 'pl', id: lead }, projectId: selected.project.id, title: decisionForm.title, body: decisionForm.body }) }, '记录批准 Decision')));
    }

    function ActivityView({ selected }) {
      const activities = selected?.activities || [];
      return h('section', { style: styles.section, 'aria-labelledby': 'activity-heading', 'data-testid': 'view-activity' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', { id: 'activity-heading' }, 'Activity'),
          h('span', { style: styles.tag }, `${activities.length} 条`)),
        !selected && h('div', { style: styles.card }, '创建并选择 Project 后显示 Host Activity。'),
        selected && h('div', { 'data-testid': 'activity-feed' },
          [...activities].reverse().map((item) => h('div', { key: item.id, style: styles.card },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('b', null, item.eventType), h('span', { style: styles.muted }, item.createdAt)),
            h('div', { style: { marginTop: 5 } }, item.summary),
            h('div', { style: styles.muted }, `${item.actorId} · ${item.objectRef}`)))));
    }

    function ControlPlanePanel({ onClose, onOpenPLChat }) {
      const [data, setData] = React.useState(null);
      const [ownerId, setOwnerId] = React.useState('human-owner');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [createMode, setCreateMode] = React.useState(false);
      const [selectedProjectId, setSelectedProjectId] = React.useState('');
      const [activeView, setActiveView] = React.useState('project');

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
          if (action === 'create-project' && next.selected?.project) await onOpenPLChat(next.selected);
        }
        catch (e) { setError(`${e.code ? `${e.code}: ` : ''}${e.message}`); }
        finally { setBusy(false); }
      };

      const launchPLChat = async (projectState) => {
        setBusy(true); setError('');
        try { await onOpenPLChat(projectState); }
        catch (e) { setError(`PL_CHAT_START_FAILED: ${e.message}`); }
        finally { setBusy(false); }
      };

      const selected = data?.selected;
      const tabs = [
        ['pl-chat', 'PL 对话'], ['project', 'Project'], ['agents', 'Agents'],
        ['tasks', 'Tasks'], ['approvals', 'Approvals'], ['activity', 'Activity'],
      ];
      const projectView = data && h('section', { 'aria-labelledby': 'project-heading', 'data-testid': 'view-project' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', { id: 'project-heading', style: { fontSize: 16 } }, 'Project'),
          h(Button, { 'data-testid': 'new-project', onClick: () => setCreateMode(true) }, '新建 Project')),
        h('label', null, 'Human Owner ID', h('input', { style: styles.input, value: ownerId, 'data-testid': 'owner-id', onChange: (e) => setOwnerId(e.target.value) })),
        data.projects.length > 0 && h('label', null, '当前 Project', h('select', {
          style: styles.input, value: selected?.project?.id || '', 'data-testid': 'project-selector',
          onChange: (event) => { setSelectedProjectId(event.target.value); setCreateMode(false); },
        }, data.projects.map((project) => h('option', { key: project.id, value: project.id }, `${project.name} · ${project.status}`)))),
        selected && !createMode && h('div', { style: styles.card, 'data-testid': 'project-summary' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('strong', null, selected.project.name), h('span', { style: styles.tag, 'data-testid': 'project-status' }, selected.project.status)),
          h('div', { style: styles.muted }, `${selected.project.id} · owner ${selected.project.ownerId} · version ${selected.project.version}`),
          h('div', { style: { marginTop: 8 } }, h('b', null, 'Mission: '), (selected.charters.find((charter) => charter.version === selected.project.charterVersion) || selected.charters.at(-1))?.mission || selected.project.initialGoal),
          h('div', { style: styles.muted }, `Milestone: ${(selected.tasks.find((task) => !['VERIFIED', 'CANCELLED'].includes(task.status)) || {}).title || 'all scoped tasks complete'} · Completion ${selected.tasks.filter((task) => task.status === 'VERIFIED').length}/${selected.tasks.length}`),
          h('div', { style: { ...styles.row, marginTop: 9 } },
            h(Button, { disabled: busy, 'data-testid': 'open-project-pl-chat', onClick: () => launchPLChat(selected) }, '新建并启动 PL 对话'),
            selected.project.status === 'ACTIVE' && h(Button, {
              disabled: busy, 'data-testid': 'stop-project',
              onClick: () => act('stop-project', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, expectedVersion: selected.project.version, reason: 'Stopped by Human Owner from Control Plane' }),
            }, '停止 Project'))),
        (!selected || createMode) && h(ProjectForm, { data, ownerId, busy, act }),
        h(RuntimeCatalog, { data, ownerId, busy, act }));

      let view;
      if (!data) view = h('p', null, '正在读取 Host 状态…');
      else if (activeView === 'pl-chat') view = h(PLChatView, { selected, busy, onOpenPLChat: launchPLChat });
      else if (activeView === 'project') view = projectView;
      else if (activeView === 'agents') view = h('section', { 'aria-labelledby': 'agents-heading', 'data-testid': 'view-agents' },
        h('strong', { id: 'agents-heading', style: { fontSize: 16 } }, 'Agents'),
        selected && !createMode ? h(ActiveTeam, { selected, ownerId, busy, act }) : h('div', { style: styles.card }, '创建并选择 Project 后显示 Agent Records。'));
      else if (activeView === 'tasks') view = h('section', { 'aria-labelledby': 'tasks-heading', 'data-testid': 'view-tasks' },
        h('strong', { id: 'tasks-heading', style: { fontSize: 16 } }, 'Tasks'),
        selected && !createMode && selected.project.status === 'ACTIVE'
          ? h(TaskBoard, { selected, busy, act })
          : h('div', { style: styles.card }, 'Task DAG 在 Project ACTIVE 后启用。'));
      else if (activeView === 'approvals') view = h('section', { 'aria-labelledby': 'approvals-heading', 'data-testid': 'view-approvals' },
        h('strong', { id: 'approvals-heading', style: { fontSize: 16 } }, 'Approvals & Governance'),
        selected && !createMode && selected.project.status === 'CHARTER_INTERVIEW' && h(Interview, { selected, ownerId, busy, act }),
        selected && !createMode && selected.project.status === 'CHARTER_PENDING_APPROVAL' && h(CharterApproval, { selected, ownerId, busy, act }),
        selected && !createMode && selected.project.status === 'TEAM_PENDING_APPROVAL' && h(TeamApproval, { selected, ownerId, busy, act }),
        selected && !createMode && ['ACTIVE', 'STOPPED'].includes(selected.project.status) && h(GovernancePanel, { selected, busy, act }),
        (!selected || createMode) && h('div', { style: styles.card }, '创建并选择 Project 后显示审批队列。'));
      else view = h(ActivityView, { selected });

      return h('section', { 'aria-label': 'Agent Team Control Plane', style: styles.page, 'data-testid': 'control-plane' },
        h('header', { style: styles.header },
          h('div', { style: { minWidth: 0 } },
            h('strong', { style: { display: 'block', fontSize: 18 } }, 'Agent Team Control Plane'),
            h('div', { style: styles.muted }, selected ? `${selected.project.name} · ${selected.project.status}` : 'Project、Agent、Task 与审批控制台')),
          h(Button, { 'data-testid': 'close-control-plane', onClick: onClose }, '返回对话')),
        h('nav', { style: styles.tabBar, 'aria-label': 'Control Plane views' },
          tabs.map(([id, label]) => h('button', {
            key: id, type: 'button', 'data-testid': `tab-${id}`, onClick: () => setActiveView(id),
            style: activeView === id
              ? { ...styles.tab, color: 'var(--dsw-alias-content-primary)', background: 'var(--dsw-alias-surface-subtle)', borderColor: 'var(--dsw-alias-border-subtle)', fontWeight: 600 }
              : styles.tab,
          }, label))),
        h('main', { style: styles.body },
          h('div', { style: styles.content },
            error && h('div', { role: 'alert', 'data-testid': 'error', style: { ...styles.card, color: '#d44', marginBottom: 12 } }, error),
            view)));
    }

    function ControlPlaneIcon({ size = 18 }) {
      return h('span', {
        'aria-hidden': true,
        style: { width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(10, size * 0.55), fontWeight: 700, border: '1.5px solid currentColor', borderRadius: 5 },
      }, 'AT');
    }

    return {
      inject: ['slots', 'layout', 'uiWorkspace', 'sessions', 'workspaces', 'conversation'],
      apply(ctx) {
        const close = () => ctx.layout.selectPanel(null);
        const currentSessionId = (snapshot) => {
          if (typeof snapshot?.current === 'string' && snapshot.current) return snapshot.current;
          const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : Object.keys(snapshot?.byId || {});
          return ids.find((id) => (snapshot.byId?.[id]?.retainedBy?.mainView || 0) > 0);
        };
        const normalizedPath = (value) => String(value || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
        const resolveWorkspaceId = (project) => {
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot();
          const sessionSnapshot = ctx.sessions.list.getSnapshot();
          const exact = workspaceSnapshot.items.find((item) => normalizedPath(item.path) === normalizedPath(project?.workspaceDir));
          if (exact) return exact.workspaceId;
          const current = currentSessionId(sessionSnapshot);
          const currentWorkspace = workspaceSnapshot.items.find((item) => item.sessionIds.includes(current));
          if (currentWorkspace) return currentWorkspace.workspaceId;
          let recent;
          let recentAt = Number.NEGATIVE_INFINITY;
          for (const item of workspaceSnapshot.items) {
            const updatedAt = Math.max(Date.parse(item.createdAt) || 0, ...item.sessionIds.map((id) => sessionSnapshot.byId?.[id]?.updatedAt || 0));
            if (updatedAt > recentAt) { recent = item.workspaceId; recentAt = updatedAt; }
          }
          return recent;
        };
        const openPLChat = async (projectState) => {
          const project = projectState?.project || projectState;
          if (!project) throw new Error('请先创建或选择 Project');
          const workspaceId = resolveWorkspaceId(project);
          if (!workspaceId) throw new Error('没有可用的 Harness Workspace，请先在左侧项目区打开工作目录');
          const prompt = [
            `你是 Agent Team Control Plane 中 Project「${project.name}」的 Project Lead（PL）。`,
            `Project ID：${project.id}`,
            `工作目录：${project.workspaceDir}`,
            `当前状态：${project.status}`,
            `Human 给出的一句话目标：${project.initialGoal}`,
            '',
            '这是该 Project 的独立主对话。请立即用中文回复并开始履行 PL 职责，不要只复述本提示。',
            project.status === 'CHARTER_INTERVIEW'
              ? '当前处于需求访谈阶段：先说明你已接管，然后围绕范围、禁止修改项/技术约束、可验证成功标准提出简短问题，并明确告诉 Human 直接在本对话中回答。'
              : '先说明你已接管，概括当前目标，并给出一个明确、可执行的下一步；需要 Human 决策时直接提问。',
            '每次回复末尾都用“下一步：”明确说明 Human 或团队接下来要做什么。',
          ].join('\n');
          await ctx.uiWorkspace.openWorkspace(workspaceId, (sessionId) => {
            const binding = ctx.sessions.binding(sessionId);
            if (!binding?.ctx) throw new Error('新 PL 会话尚未就绪');
            const result = ctx.conversation.input.requestDraftInitialization(binding, {
              prompt, clearPreviousDraft: true,
            });
            if (result === 'blocked') throw new Error('新 PL 会话输入区正忙，请稍后重试');
            ctx.conversation.input.for(binding.ctx).submit();
          }, { agentPreset: 'standard' });
        };
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'agent-team-control-plane',
        }, () => h(ControlPlanePanel, { onClose: close, onOpenPLChat: openPLChat })));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'agent-team-control-plane', order: 20, label: 'Agent 团队',
        }, ControlPlaneIcon));
      },
    };
  },
});
