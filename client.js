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

    async function requestSnapshot(projectId = '') {
      const response = await fetch(projectId ? `${ROUTE}?projectId=${encodeURIComponent(projectId)}` : ROUTE);
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) throw new Error(payload.error?.message || `HTTP ${response.status}`);
      if (projectId && payload.data?.selected?.project?.id !== projectId) {
        throw new Error(`Host 未返回 Project ${projectId} 的状态，已保留原项目`);
      }
      return payload.data;
    }

    async function requestActivityPage({ projectId, limit = 50, cursor = null, actorId = '', eventType = '', taskId = '' }) {
      const query = new URLSearchParams({ view: 'activity', projectId, limit: String(limit) });
      if (cursor?.createdAt && cursor?.id) {
        query.set('cursorCreatedAt', cursor.createdAt);
        query.set('cursorId', cursor.id);
      }
      if (actorId) query.set('actorId', actorId);
      if (eventType) query.set('eventType', eventType);
      if (taskId) query.set('taskId', taskId);
      const response = await fetch(`${ROUTE}?${query.toString()}`);
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

    const PROJECT_STATUS_LABELS = Object.freeze({
      CHARTER_INTERVIEW: '需求访谈中',
      CHARTER_PENDING_APPROVAL: '章程待批准',
      TEAM_PENDING_APPROVAL: '团队待批准',
      ACTIVE: '进行中',
      STOPPED: '已停止（可恢复）',
      COMPLETED: '已完成',
    });
    const AGENT_STATUS_LABELS = Object.freeze({
      PENDING_APPROVAL: '待批准', IDLE: '空闲', RUNNING: '工作中',
      UNAVAILABLE: '已停用', REPLACED: '已替换',
    });
    const TASK_STATUS_LABELS = Object.freeze({
      PENDING: '等待依赖', READY: '可执行', RUNNING: '执行中', WAITING: '等待处理',
      SUBMITTED: '待审核', VERIFIED: '已验收', FAILED: '失败', CANCELLED: '已取消',
    });
    const AVAILABILITY_LABELS = Object.freeze({
      AVAILABLE: '可用', NOT_CONFIGURED: '未配置', UNAVAILABLE: '不可用',
    });
    const ACTIVITY_LABELS = Object.freeze({
      RUNTIMES_SCANNED: '扫描运行环境', RUNTIME_AUTHORIZED: '授权运行环境', RUNTIME_REVOKED: '撤销运行环境授权',
      PROJECT_CREATED: '创建项目', PROJECT_STOPPED: '停止项目', PROJECT_RESUMED: '恢复项目', PROJECT_COMPLETED: '完成项目', PROJECT_DELETED: '删除项目记录',
      CHARTER_DRAFTED: '生成章程草案', CHARTER_APPROVED: '批准章程', TEAM_PROPOSED: '提交团队方案', TEAM_APPROVED: '批准团队',
      AGENT_REPLACED: '更换 Agent', TASK_CREATED: '创建任务', TASK_UPDATED: '更新任务', TASK_ASSIGNED: '指派任务',
      TASK_UNASSIGNED: '释放任务指派', TASK_STATE_CHANGED: '任务状态变更', TASK_PROPOSED: '提议新任务', TASK_PROPOSAL_REJECTED: '驳回任务提议',
      TASK_RUN_CREATED: '创建 Worker 运行', TASK_RUN_TERMINAL: 'Worker 运行结束', TASK_RUN_CANCEL_REQUESTED: '请求取消 Worker 运行',
      TASK_RUN_RECOVERED_UNKNOWN: '恢复异常运行记录', REQUEST_RUN_STARTED: '启动协作请求处理', REQUEST_RUN_FAILED: '协作请求处理失败', REQUEST_RUN_RECOVERED: '恢复异常协作请求',
      REQUEST_CREATED: '创建协作请求', REQUEST_REJECTED: '拒绝协作请求', REQUEST_RESOLVED: '完成协作请求', REQUEST_TIMED_OUT: '协作请求超时',
      TASK_AUTO_VERIFIED: '自动验收任务', REVIEW_APPROVE: '审核通过', REVIEW_REJECT: '审核退回', REVIEW_RUN_CREATED: '创建独立审核',
      REVIEW_RUN_TERMINAL: '独立审核结束', REVIEW_RUN_FAILED: '独立审核失败', REVIEW_RUN_RECOVERED: '恢复异常审核记录',
      FINDING_OPENED: '记录问题', FINDING_TRIAGED: '更新问题状态', PLAN_CHECK_COMPLETED: '完成计划检查', DECISION_APPROVED: '记录已批准决策',
      PL_SESSION_BOUND: '绑定 PL 会话', VERIFICATION_COMMAND_APPROVED: '批准验证命令', VERIFICATION_COMMAND_REVOKED: '撤销验证命令',
    });
    const ACTIVITY_DESCRIPTIONS = Object.freeze({
      PROJECT_CREATED: '项目已经建立，并进入需求访谈阶段。', PROJECT_STOPPED: '项目已由负责人停止；未完成任务保留为审计记录。',
      PROJECT_RESUMED: '项目已由负责人恢复，可以继续创建和执行新任务。', PROJECT_COMPLETED: '负责人已完成最终验收，项目进入只读状态。',
      PROJECT_DELETED: '负责人已永久删除该项目的控制面记录；工作目录与 PL 对话未被修改。',
      CHARTER_DRAFTED: '需求访谈结果已整理为项目章程草案。', CHARTER_APPROVED: '负责人已批准项目章程，系统已生成团队方案。',
      TEAM_PROPOSED: 'PL 已提交团队成员方案，等待负责人确认。', TEAM_APPROVED: '负责人已批准团队，项目开始运行。',
      AGENT_REPLACED: '旧 Agent 身份已停用，并创建了新的审计身份。', TASK_CREATED: '已建立正式任务并纳入依赖图。',
      TASK_UPDATED: '任务定义或依赖已更新。', TASK_ASSIGNED: '任务已指派给 Worker，但运行尚未启动。', TASK_UNASSIGNED: '尚未启动的任务指派已释放。',
      TASK_STATE_CHANGED: '任务状态已经更新。', TASK_PROPOSED: 'Agent 提交了任务建议；尚未成为正式任务。', TASK_PROPOSAL_REJECTED: '任务建议已被驳回。',
      TASK_RUN_CREATED: '一次性 Worker 运行已加入队列。', TASK_RUN_TERMINAL: 'Worker 运行已结束，结果和任务状态已经保存。',
      TASK_RUN_CANCEL_REQUESTED: '系统已向正在执行的 Worker 发送取消请求。', TASK_RUN_RECOVERED_UNKNOWN: 'Host 重启后将中断的运行标记为未知，等待人工处理。',
      REQUEST_RUN_STARTED: '系统已启动一次受限的协作请求处理。', REQUEST_RUN_FAILED: '协作请求处理失败，请查看技术审计原文。', REQUEST_RUN_RECOVERED: 'Host 重启后已释放中断的协作请求运行，请求保留为待人工处理。',
      REQUEST_CREATED: 'Agent 已创建协作请求，并等待接收者处理。', REQUEST_REJECTED: '协作请求被拒绝。', REQUEST_RESOLVED: '协作请求已处理完成。', REQUEST_TIMED_OUT: '协作请求已超时并停止自动重试。',
      TASK_AUTO_VERIFIED: '常规任务已依据完整的 Host 证据自动验收。', REVIEW_APPROVE: '审核已通过；任务按治理规则进入下一状态。',
      REVIEW_REJECT: '审核未通过；任务已退回修改。', REVIEW_RUN_CREATED: '独立 Reviewer 审核已加入队列。', REVIEW_RUN_TERMINAL: '独立 Reviewer 已提交审核结果。',
      REVIEW_RUN_FAILED: '独立 Reviewer 运行失败，请查看技术审计原文。', REVIEW_RUN_RECOVERED: 'Host 重启后将中断的审核标记为未知。',
      FINDING_OPENED: '审核过程中发现的问题已记录。', FINDING_TRIAGED: '问题状态已经更新。', PLAN_CHECK_COMPLETED: '阶段性计划检查已完成。',
      DECISION_APPROVED: '一项已批准的项目决策已写入审计记录。', RUNTIMES_SCANNED: 'Host 已重新扫描可用模型来源和 Worker 运行方式。',
      RUNTIME_AUTHORIZED: '负责人已允许控制面使用该运行环境。', RUNTIME_REVOKED: '负责人已撤销该运行环境的使用授权。',
      PL_SESSION_BOUND: '负责人已把项目绑定到指定的 PL 会话；只有该会话中的 PL 可以调用 agent_team_* 工具。',
      VERIFICATION_COMMAND_APPROVED: '负责人批准了一条验证命令；PL 只能引用该命令 ID，不能提交任意命令文本。',
      VERIFICATION_COMMAND_REVOKED: '负责人已撤销该验证命令；后续运行不能再引用它。',
    });

    function projectStatusLabel(status) { return PROJECT_STATUS_LABELS[status] || status; }
    function taskStatusLabel(status) { return TASK_STATUS_LABELS[status] || status; }
    function formatDateTime(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
    }

    function runtimePurpose(runtime) {
      if (runtime.kind === 'harness-agent') return 'PL 对话模型来源';
      if (runtime.providerKey === 'subagent:fork') return 'Worker 启动方式：继承当前 PL 的上下文（不是模型名称）';
      if (runtime.providerKey === 'subagent:spawn') return 'Worker 启动方式：新建独立上下文（不是模型名称）';
      return 'Worker 启动方式（不是模型名称）';
    }

    function RuntimeCatalog({ data, ownerId, busy, act }) {
      const runtimeCard = (runtime) => {
        const models = runtime.capabilities?.models || [];
        const worker = runtime.kind === 'external-worker';
        return h('div', { key: runtime.providerKey, style: styles.card, 'data-provider-key': runtime.providerKey },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('span', null, h('strong', null, runtime.displayName)),
            h('span', { style: styles.tag }, AVAILABILITY_LABELS[runtime.availability] || runtime.availability)),
          h('div', { style: { marginTop: 5 } }, runtimePurpose(runtime)),
          runtime.kind === 'harness-agent' && h('div', { style: styles.muted }, models.length
            ? `Host 报告的模型：${models.map((model) => model.name || model.id).join('、')}`
            : 'Host 未报告可用模型。'),
          worker && h('div', { style: styles.muted }, '具体大模型：Host 当前未报告；由 DSH 子代理或 Agent preset 决定。'),
          h('div', { style: { ...styles.row, marginTop: 7 } },
            h('span', { style: styles.tag }, runtime.authorized ? '已授权' : '未授权'),
            h(Button, {
              disabled: busy || runtime.availability !== 'AVAILABLE',
              'data-testid': `authorize-${runtime.providerKey.replace(/[^a-z0-9]/gi, '-')}`,
              onClick: () => act('authorize-runtime', {
                actor: { type: 'human', id: ownerId }, providerKey: runtime.providerKey, authorized: !runtime.authorized,
              }),
            }, runtime.authorized ? '撤销授权' : '授权')),
          h('details', { style: { marginTop: 7 } },
            h('summary', { style: { cursor: 'pointer', ...styles.muted } }, '技术详情'),
            h('div', { style: styles.muted }, `Provider：${runtime.providerKey}`),
            h('div', { style: styles.muted }, `来源：${runtime.source || 'Host'}`)));
      };
      const plRuntimes = data.runtimes.filter((runtime) => runtime.kind === 'harness-agent');
      const workerRuntimes = data.runtimes.filter((runtime) => runtime.kind === 'external-worker');
      return h('div', { style: styles.section, 'data-testid': 'runtime-catalog' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', null, '模型与 Worker 运行方式'),
          h(Button, { disabled: busy, 'data-testid': 'rescan-runtimes', onClick: () => act('rescan-runtimes', { actor: { type: 'human', id: ownerId } }) }, '重新扫描')),
        h('div', { style: { ...styles.card, background: 'var(--dsw-alias-surface-subtle)' } },
          'PL 使用 Harness 报告的模型服务；fork / spawn 是 Worker 的启动方式，不是大模型名称。'),
        h('div', { style: styles.section }, h('b', null, `PL 对话模型来源 · ${plRuntimes.length}`), plRuntimes.map(runtimeCard)),
        h('div', { style: styles.section }, h('b', null, `Worker 启动方式 · ${workerRuntimes.length}`), workerRuntimes.map(runtimeCard)));
    }

    function ProjectForm({ data, ownerId, busy, act, defaultWorkspaceDir }) {
      const harness = data.runtimes.filter((item) => item.kind === 'harness-agent' && item.availability === 'AVAILABLE' && item.authorized);
      const workers = data.runtimes.filter((item) => item.kind === 'external-worker' && item.availability === 'AVAILABLE' && item.authorized);
      const defaultWorker = workers[0];
      const [form, setForm] = React.useState({
        name: 'Agent Team MVP', workspaceDir: defaultWorkspaceDir || '',
        initialGoal: '', maxAgents: 3, leadRuntimeKey: harness[0]?.providerKey || '', workerRuntimeKey: '',
      });
      const [workspaceEdited, setWorkspaceEdited] = React.useState(false);
      React.useEffect(() => {
        if (!form.leadRuntimeKey && harness[0]) setForm((value) => ({ ...value, leadRuntimeKey: harness[0].providerKey }));
      }, [harness.map((item) => item.providerKey).join('|')]);
      const normalizedWorkspace = form.workspaceDir.trim().replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const sameWorkspaceProject = normalizedWorkspace
        ? data.projects.find((project) => project.workspaceDir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === normalizedWorkspace)
        : null;
      const field = (name, label, multiline = false) => h('label', null, label,
        h(multiline ? 'textarea' : 'input', {
          style: styles.input, value: form[name], 'data-testid': `project-${name}`,
          onChange: (event) => {
            const value = event.target.value;
            if (name === 'workspaceDir') setWorkspaceEdited(true);
            if (name === 'initialGoal' && !workspaceEdited) {
              const absolutePath = value.match(/[A-Za-z]:\\[^\s，。；;]+/)?.[0];
              setForm({ ...form, initialGoal: value, workspaceDir: absolutePath || form.workspaceDir });
            } else setForm({ ...form, [name]: value });
          },
        }));
      return h('div', { style: styles.section, 'data-testid': 'project-form' },
        h('strong', null, '创建 Project'),
        field('name', '名称'), field('workspaceDir', '工作目录'), field('initialGoal', '一句目标', true),
        sameWorkspaceProject && h('div', {
          style: { ...styles.card, color: '#b76b00', marginBottom: 8 },
          'data-testid': 'same-workspace-warning',
        }, `该目录已被 Project「${sameWorkspaceProject.name}」（${projectStatusLabel(sameWorkspaceProject.status)}）使用。可以继续创建，但同一目录的写入 Run 会互斥执行，建议优先复用已有 Project。`),
        h('label', null, '团队 Agent 数量',
          h('input', {
            type: 'number', min: 3, max: 8, step: 1, style: styles.input,
            value: form.maxAgents, 'data-testid': 'project-maxAgents',
            onChange: (event) => setForm({ ...form, maxAgents: event.target.value }),
          }),
          h('div', { style: { ...styles.muted, marginBottom: 8 } },
            `默认 3 个：1 个 PL + ${Math.max(1, Number(form.maxAgents || 3) - 2)} 个 Worker + 1 个独立 Reviewer。这里选择的是 Agent 身份数量，不代表不同大模型数量。`)),
        h('label', null, 'Project Lead Runtime',
          h('select', {
            style: styles.input, value: form.leadRuntimeKey, 'data-testid': 'project-leadRuntimeKey',
            onChange: (event) => setForm({ ...form, leadRuntimeKey: event.target.value }),
          }, h('option', { value: '' }, '请先授权 Harness Runtime'), harness.map((runtime) => h('option', { key: runtime.providerKey, value: runtime.providerKey }, runtime.displayName)))),
        h('label', null, 'Worker Runtime（可选）',
          h('select', {
            style: styles.input, value: form.workerRuntimeKey, 'data-testid': 'project-workerRuntimeKey',
            onChange: (event) => setForm({ ...form, workerRuntimeKey: event.target.value }),
          },
          h('option', { value: '' }, defaultWorker
            ? `自动选择默认：${defaultWorker.displayName}（${defaultWorker.providerKey}）`
            : '没有已授权且可用的 Worker Runtime'),
          workers.map((runtime) => h('option', { key: runtime.providerKey, value: runtime.providerKey }, `${runtime.displayName}（${runtime.providerKey}）`))),
          h('div', { style: { ...styles.muted, marginBottom: 8 } },
            '留空时使用列表中的默认项。fork / spawn 是 Worker 启动方式，不代表具体大模型；实际模型只有 Host 明确报告时才显示。')),
        h(Button, {
          disabled: busy || !form.workspaceDir.trim() || !form.initialGoal.trim() || !form.leadRuntimeKey || workers.length === 0 || Number(form.maxAgents) < 3 || Number(form.maxAgents) > 8,
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
        }, `批准 Charter 并接收 ${selected.project.maxAgents} 人团队建议`));
    }

    function TeamApproval({ selected, runtimes, ownerId, busy, act }) {
      const approval = [...selected.approvals].reverse().find((item) => item.kind === 'TEAM' && item.status === 'PENDING');
      const members = approval?.payload?.members || [];
      return h('div', { style: styles.section, 'data-testid': 'team-approval' },
        h('strong', null, `团队提案 · ${members.length}/${selected.project.maxAgents}`),
        members.map((member) => {
          const runtime = runtimes.find((item) => item.providerKey === member.providerKey);
          const launchMode = member.providerKey.startsWith('subagent:') ? member.providerKey.slice('subagent:'.length) : null;
          return h('div', { key: member.id, style: styles.card },
            h('b', null, member.displayName), ` · ${member.role}`,
            h('div', { style: styles.muted }, `Runtime：${runtime?.displayName || member.providerKey}（${member.providerKey}）`),
            launchMode && h('div', { style: styles.muted }, `启动方式：${launchMode} · 实际模型：Host 未报告/未知`));
        }),
        h(Button, {
          disabled: busy, 'data-testid': 'approve-team',
          onClick: () => act('approve-team', {
            actor: { type: 'human', id: ownerId }, projectId: selected.project.id,
            expectedVersion: selected.project.version,
          }),
        }, '批准团队（仅建档，不启动模型）'));
    }

    function ActiveTeam({ selected, runtimes, ownerId, busy, act }) {
      const [replaceTarget, setReplaceTarget] = React.useState('');
      const activeAgents = selected.agents.filter((agent) => agent.status !== 'REPLACED');
      const replacedAgents = selected.agents.filter((agent) => agent.status === 'REPLACED');
      return h('div', { style: styles.section, 'data-testid': 'active-team' },
        h('strong', null, `当前团队 · ${activeAgents.length}/${selected.project.maxAgents}`),
        activeAgents.map((agent) => {
          const runtime = runtimes.find((item) => item.providerKey === agent.providerKey);
          const launchMode = agent.providerKey.startsWith('subagent:') ? agent.providerKey.slice('subagent:'.length) : null;
          return h('div', { key: agent.id, style: styles.card, 'data-testid': 'agent-record' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('b', null, agent.displayName), h('span', { style: styles.tag }, AGENT_STATUS_LABELS[agent.status] || agent.status)),
          h('div', null, `${agent.role === 'PROJECT_LEAD' ? '项目负责人 PL' : agent.role === 'REVIEWER' ? '独立审核 Agent' : '执行 Worker'} · ${AGENT_STATUS_LABELS[agent.status] || agent.status}`),
          h('div', { style: styles.muted }, `Provider：${runtime?.displayName || agent.providerKey}（${agent.providerKey}）`),
          launchMode && h('div', { style: styles.muted }, `启动方式：${launchMode}（不是模型名称）`),
          h('div', { style: styles.muted }, `实际模型：未报告/未知 · 当前任务：${agent.currentTaskId || '无'}`),
          h('details', { style: { marginTop: 7 } },
            h('summary', { style: { cursor: 'pointer', ...styles.muted } }, '权限与技术详情'),
            h('div', { style: styles.muted }, `Runtime 来源：${runtime?.source || 'Host 未报告'}`),
            h('div', { style: styles.muted }, `Permissions：${agent.permissions.join(', ')}`),
            h('div', { style: styles.muted }, `Skills：${agent.skills.join(', ') || '无'}`)),
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
            h(Button, { disabled: busy, onClick: () => setReplaceTarget('') }, '取消')));
        }),
        replacedAgents.length > 0 && h('details', { style: styles.card },
          h('summary', { style: { cursor: 'pointer' } }, `替换审计记录 · ${replacedAgents.length}（通常无需查看）`),
          h('div', { style: { ...styles.muted, marginTop: 7 } }, '这些旧身份必须保留，用来证明历史 Task、Run 和 Review 由谁完成；它们不占当前团队名额，也不会再次运行。'),
          [...replacedAgents].reverse().slice(0, 5).map((agent) => {
            const successor = selected.agents.find((item) => item.replacesAgentId === agent.id);
            return h('details', { key: agent.id, style: { marginTop: 8 } },
              h('summary', { style: { cursor: 'pointer' } }, `${agent.displayName} → ${successor?.displayName || '后续身份'}`),
              h('div', { style: styles.muted }, `旧身份：${agent.id}`),
              h('div', { style: styles.muted }, `新身份：${successor?.id || '未记录'} · ${agent.role} · ${agent.providerKey}`));
          }),
          replacedAgents.length > 5 && h('div', { style: { ...styles.muted, marginTop: 8 } }, `仅显示最近 5 条；其余 ${replacedAgents.length - 5} 条仍保存在 Host 审计库中。`)));
    }

    function TaskBoard({ selected, busy, act, readOnly = false }) {
      const tasks = selected.tasks || [];
      const proposals = selected.taskProposals || [];
      const runs = selected.taskRuns || [];
      const results = selected.results || [];
      const evidence = selected.evidence || [];
      const workers = selected.agents.filter((agent) => agent.role === 'WORKER' && agent.status === 'IDLE' && !agent.currentTaskId);
      const approvedCommands = (selected.verificationCommands || []).filter((command) => command.status === 'APPROVED');
      const [commandForm, setCommandForm] = React.useState({ displayName: '', command: '' });
      const [commandByTask, setCommandByTask] = React.useState({});
      const [assigneeByTask, setAssigneeByTask] = React.useState({});
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
        h('strong', null, `任务与运行记录 · ${tasks.length}`),
        readOnly && h('div', { style: { ...styles.card, background: 'var(--dsw-alias-surface-subtle)' }, 'data-testid': 'task-read-only' },
          `${projectStatusLabel(selected.project.status)}：以下内容为完整历史记录。恢复 Project 后可以创建和执行新任务，已取消的旧任务不会自动复活。`),
        !readOnly && h('div', { style: styles.card, 'data-testid': 'task-form' },
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
        !readOnly && h('div', { style: styles.card, 'data-testid': 'verification-command-form' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('strong', null, `验证命令白名单 · ${approvedCommands.length}（Human 批准）`)),
          h('div', { style: { ...styles.muted, marginTop: 4 } }, 'Worker 运行只能引用此处已批准的 PowerShell 命令 ID；PL 无法提交任意命令文本，新命令必须由负责人批准。'),
          h('label', null, '命令名称（用于展示，可空）', h('input', {
            style: styles.input, value: commandForm.displayName, 'data-testid': 'verification-command-name',
            onChange: (event) => setCommandForm({ ...commandForm, displayName: event.target.value }),
          })),
          h('label', null, 'PowerShell 命令（负责人批准后写入白名单）', h('textarea', {
            style: styles.input, value: commandForm.command, 'data-testid': 'verification-command-text',
            onChange: (event) => setCommandForm({ ...commandForm, command: event.target.value }),
          })),
          h(Button, {
            disabled: busy || !commandForm.command.trim(),
            'data-testid': 'approve-verification-command',
            onClick: () => act('approve-verification-command', {
              projectId: selected.project.id,
              displayName: commandForm.displayName.trim() || commandForm.command.trim().slice(0, 60),
              command: commandForm.command.trim(), timeoutMs: 120000,
            }).then(() => setCommandForm({ displayName: '', command: '' })),
          }, 'Human 批准命令'),
          approvedCommands.map((command) => h('div', { key: command.id, style: { ...styles.row, marginTop: 7 } },
            h('span', { style: styles.tag }, command.id),
            h('span', { style: { ...styles.muted, flex: 1, overflowWrap: 'anywhere' } }, `${command.displayName} · ${command.command}`),
            h(Button, {
              disabled: busy, 'data-testid': `revoke-verification-command-${command.id}`,
              onClick: () => act('revoke-verification-command', { projectId: selected.project.id, commandId: command.id }),
            }, '撤销')))),
        tasks.map((task) => h('div', { key: task.id, style: styles.card, 'data-testid': 'task-record', 'data-task-id': task.id },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('b', null, task.title), h('span', { style: styles.tag }, taskStatusLabel(task.status))),
          h('div', { style: styles.muted }, `${task.id} · v${task.version} · Charter v${task.charterVersion}`),
          h('div', null, `${task.controlLevel} / ${task.reviewPolicy} · assignee ${task.assignedAgentId || 'none'}`),
          h('div', { style: styles.muted }, `Dependencies: ${task.dependencies.join(', ') || 'none'}`),
          task.waiting && h('div', { style: styles.muted }, `Waiting: ${task.waiting.reason} · ${task.waiting.onRef}`),
          !readOnly && ['PENDING', 'READY', 'SUBMITTED'].includes(task.status) && h(Button, {
            disabled: busy,
            'data-testid': `cancel-task-${task.id}`,
            onClick: () => {
              if (!globalThis.confirm(`取消 Task「${task.title}」？\n\n历史记录和已有 Result 会保留；如需修正 scope 或依赖，请另建承接 Task。`)) return;
              act('transition-task', {
                actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
                taskId: task.id, expectedVersion: task.version, toStatus: 'CANCELLED',
                reason: '由 PL 取消并保留审计历史；后续使用修正后的承接 Task',
              });
            },
          }, '取消 / 取代 Task'),
          !readOnly && task.status === 'READY' && !task.assignedAgentId && workers.length > 0 && h('div', { style: { ...styles.row, marginTop: 7 } },
            h('select', {
              style: { ...styles.input, flex: 1, margin: 0 },
              value: assigneeByTask[task.id] || workers[0].id,
              'data-testid': `assignee-${task.id}`,
              onChange: (event) => setAssigneeByTask({ ...assigneeByTask, [task.id]: event.target.value }),
            }, workers.map((worker) => h('option', { key: worker.id, value: worker.id }, `${worker.displayName} · ${worker.id}`))),
            h(Button, {
              disabled: busy, 'data-testid': `assign-${task.id}`,
              onClick: () => act('assign-task', {
                actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
                taskId: task.id, expectedVersion: task.version, agentId: assigneeByTask[task.id] || workers[0].id,
              }),
            }, 'PL 指派')),
          !readOnly && task.status === 'READY' && !task.assignedAgentId && workers.length === 0 && h('div', { style: styles.muted }, '当前没有空闲 Worker。'),
          !readOnly && task.status === 'READY' && task.assignedAgentId && h(Button, {
            disabled: busy, 'data-testid': `unassign-${task.id}`,
            onClick: () => act('unassign-task', {
              actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
              taskId: task.id, expectedVersion: task.version,
            }),
          }, '释放指派（未启动）'),
          !readOnly && task.status === 'READY' && task.assignedAgentId && h('div', { style: { marginTop: 7 }, 'data-testid': `run-commands-${task.id}` },
            approvedCommands.length > 0
              ? h('select', {
                  style: { ...styles.input, margin: 0 },
                  value: commandByTask[task.id] || '',
                  'data-testid': `run-verification-commands-${task.id}`,
                  onChange: (event) => setCommandByTask({ ...commandByTask, [task.id]: event.target.value }),
                }, [h('option', { key: '', value: '' }, '请选择验证命令（必选）')]
                  .concat(approvedCommands.map((command) => h('option', { key: command.id, value: command.id }, `${command.displayName} · ${command.id}`))))
              : h('div', { style: styles.error }, '尚无已批准验证命令。请先在上方批准命令，之后才能启动 Run。'),
            h(Button, {
              disabled: busy || !commandByTask[task.id], 'data-testid': `start-run-${task.id}`,
              onClick: () => act('start-task-run', {
                actor: { type: 'pl', id: selected.project.leadAgentId }, projectId: selected.project.id,
                taskId: task.id, expectedVersion: task.version,
                verification_command_ids: commandByTask[task.id] ? [commandByTask[task.id]] : [],
                writeIntent: true,
              }),
            }, '启动一次性 Worker Run')))),
        runs.length > 0 && h('div', { style: styles.section, 'data-testid': 'task-runs' },
          h('strong', null, `Task Runs · ${runs.length}`),
          [...runs].reverse().map((run) => {
            const result = results.find((item) => item.runId === run.id);
            const runEvidence = result ? evidence.filter((item) => item.resultId === result.id) : [];
            const active = ['CREATED', 'STARTING', 'RUNNING'].includes(run.status);
            const needsPlDiagnosis = ['FAILED', 'CANNOT_START', 'UNKNOWN', 'TIMED_OUT'].includes(run.status)
              || ['FAILED', 'CANNOT_START', 'UNKNOWN', 'TIMED_OUT'].includes(run.terminalKind);
            return h('div', { key: run.id, style: styles.card, 'data-testid': 'task-run', 'data-run-id': run.id },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                h('b', null, `${run.id} · attempt ${run.attempt}`), h('span', { style: styles.tag }, run.status)),
              h('div', { style: styles.muted }, `${run.taskId} · ${run.providerKey} · watchdog ${run.watchdogState}`),
              h('div', { style: styles.muted }, `Stage: ${active ? run.status : `${run.terminalKind || run.status} → Result ${result?.outcome || 'pending'}`}`),
              result && h('div', { style: { marginTop: 5 } },
                h('b', null, `${result.outcome}: `), result.changeSummary,
                h('div', { style: styles.muted }, `Verified actions: ${result.verifiedActions.join('；') || 'none'}`),
                result.unresolved?.length > 0 && h('div', { style: { ...styles.error, marginTop: 5 } }, `Unresolved: ${result.unresolved.join('；')}`),
                runEvidence.map((item) => h('div', { key: item.id, style: styles.muted }, `${item.kind} ${item.status} · ${item.ref}`))),
              needsPlDiagnosis && h('div', { style: { ...styles.card, background: 'var(--dsw-alias-surface-subtle)' }, 'data-testid': `pl-diagnosis-${run.id}` },
                h('b', null, '下一步交给 PL 诊断'),
                h('div', { style: styles.muted }, '从 Harness 左侧栏打开本 Project 的 PL 对话，让 PL 读取控制面状态、定位失败原因并决定修复或重试；控制面不会自动盲目重跑。'),
                (run.errorCode || run.errorMessage) && h('details', { style: { marginTop: 5 } },
                  h('summary', { style: { cursor: 'pointer' } }, '失败技术详情'),
                  h('div', { style: styles.muted }, `${run.errorCode || 'RUNTIME_FAILURE'}：${run.errorMessage || 'Host 未提供详细错误'}`))),
              !readOnly && active && h(Button, {
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

    function GovernancePanel({ selected, ownerId, busy, act, readOnly = false }) {
      const requests = selected.requests || [];
      const responses = selected.responses || [];
      const reviews = selected.reviews || [];
      const reviewRuns = selected.reviewRuns || [];
      const findings = selected.findings || [];
      const planChecks = selected.planChecks || [];
      const submitted = (selected.tasks || []).filter((task) => task.status === 'SUBMITTED');
      const [responseBody, setResponseBody] = React.useState('');
      const [reviewIssue, setReviewIssue] = React.useState('');
      const [planNotes, setPlanNotes] = React.useState('Current evidence and dependencies remain aligned with the approved Charter.');
      const lead = selected.project.leadAgentId;
      const reviewer = selected.agents.find((agent) => agent.role === 'REVIEWER' && !['REPLACED', 'UNAVAILABLE'].includes(agent.status));
      const evidenceFor = (task) => (selected.results.find((item) => item.id === task.resultId)?.evidenceRefs || []).slice(0, 4);
      const review = (task, actor, decision, acceptRisk = false) => act('submit-review', {
        actor, projectId: selected.project.id, taskId: task.id, decision,
        issues: decision === 'REJECT' ? [reviewIssue.trim() || 'Revision required by reviewer'] : [],
        evidenceRefs: evidenceFor(task),
        acceptRisk,
      });
      return h('div', { style: styles.section, 'data-testid': 'governance-panel' },
        h('strong', null, 'Requests · Reviews · Findings · Plan Checks'),
        readOnly && h('div', { style: { ...styles.card, background: 'var(--dsw-alias-surface-subtle)' } },
          `${projectStatusLabel(selected.project.status)}：审批与治理记录为只读。恢复 Project 后可继续处理新的治理事项。`),
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
              !readOnly && ['PENDING', 'IN_PROGRESS'].includes(requestItem.status) && h('div', null,
                h('input', { style: styles.input, value: responseBody, placeholder: '受限 RESPONSE', 'data-testid': 'request-response-body', onChange: (event) => setResponseBody(event.target.value) }),
                h(Button, {
                  disabled: busy || !responseBody.trim() || Boolean(target?.currentTaskId), 'data-testid': `respond-${requestItem.id}`,
                  onClick: () => act('respond-request', { actor: { type: target?.role === 'PROJECT_LEAD' ? 'pl' : 'agent', id: requestItem.toAgentId }, projectId: selected.project.id, requestId: requestItem.id, outcome: 'ANSWER', body: responseBody.trim(), evidenceRefs: [] }),
                }, target?.currentTaskId ? '接收者忙，保持排队' : '接收者提交 RESPONSE')));
          })),
        submitted.length > 0 && h('div', { style: styles.section, 'data-testid': 'review-queue' },
          h('b', null, `Review Queue · ${submitted.length}`),
          !readOnly && h('input', { style: styles.input, value: reviewIssue, placeholder: 'Reject 时填写明确问题', 'data-testid': 'review-issue', onChange: (event) => setReviewIssue(event.target.value) }),
          submitted.map((task) => {
            const result = selected.results.find((item) => item.id === task.resultId);
            const resultEvidence = (selected.evidence || []).filter((item) => item.resultId === task.resultId);
            const verificationIncomplete = result?.outcome !== 'SUCCESS' || resultEvidence.some((item) => item.status === 'FAILED');
            const reviewerApproved = reviews.some((item) => item.taskId === task.id && item.resultId === task.resultId && item.reviewerRole === 'REVIEWER' && item.decision === 'APPROVE');
            const reviewRun = [...reviewRuns].reverse().find((item) => item.taskId === task.id && item.resultId === task.resultId);
            return h('div', { key: task.id, style: styles.card, 'data-testid': 'review-record' },
              h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, task.title), h('span', { style: styles.tag }, task.reviewPolicy)),
              !readOnly && task.reviewPolicy === 'REVIEWER_PL' && !reviewerApproved && reviewer && h('div', { style: styles.row },
                h(Button, {
                  disabled: busy || ['STARTING', 'RUNNING'].includes(reviewRun?.status),
                  'data-testid': `request-review-${task.id}`,
                  onClick: () => act('request-review', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, taskId: task.id }),
                }, ['STARTING', 'RUNNING'].includes(reviewRun?.status) ? '独立 Reviewer 运行中' : '请求独立 Reviewer 运行')),
              !readOnly && task.reviewPolicy === 'REVIEWER_PL' && !reviewerApproved && !reviewer && h('div', { style: styles.error }, '当前没有可用 Reviewer；请先在 Agents 中更换 Reviewer。'),
              reviewRun && h('div', { style: styles.muted }, `Review Run ${reviewRun.id} · ${reviewRun.status}${reviewRun.error ? ` · ${reviewRun.error.code}: ${reviewRun.error.message}` : ''}`),
              !readOnly && (task.reviewPolicy !== 'REVIEWER_PL' || reviewerApproved) && h('div', { style: styles.row },
                !verificationIncomplete && h(Button, { disabled: busy, 'data-testid': `approve-review-${task.id}`, onClick: () => review(task, { type: 'pl', id: lead }, 'APPROVE') }, 'PL 通过'),
                h(Button, { disabled: busy, 'data-testid': `reject-review-${task.id}`, onClick: () => review(task, { type: 'pl', id: lead }, 'REJECT') }, 'PL 退回')),
              !readOnly && verificationIncomplete && (task.reviewPolicy !== 'REVIEWER_PL' || reviewerApproved) && h('div', { style: { ...styles.card, borderColor: 'var(--dsw-alias-border-warning)' } },
                h('b', null, 'Host 验证不完整'),
                h('div', { style: styles.muted }, '仅 Human Owner 可明确接受 PARTIAL / FAILED evidence 风险并将 Task 验收为 VERIFIED。'),
                h(Button, {
                  disabled: busy,
                  'data-testid': `owner-accept-risk-${task.id}`,
                  onClick: () => {
                    if (!globalThis.confirm(`Task ${task.id} 的 Host 验证不完整。\n\n确认由 Human Owner 接受该风险并验收？`)) return;
                    review(task, { type: 'human', id: ownerId }, 'APPROVE', true);
                  },
                }, 'Owner 接受风险并验收')));
          })),
        h('div', { style: styles.section, 'data-testid': 'findings' },
          h('b', null, `Findings · ${findings.length}`),
          [...findings].reverse().map((finding) => h('div', { key: finding.id, style: styles.card },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, `${finding.severity} · ${finding.id}`), h('span', { style: styles.tag }, finding.status)),
            h('div', null, finding.description),
            !readOnly && finding.status !== 'CLOSED' && h(Button, { disabled: busy, onClick: () => act('update-finding', { actor: { type: 'pl', id: lead }, projectId: selected.project.id, findingId: finding.id, status: 'CLOSED' }) }, 'PL 关闭')))),
        h('div', { style: styles.section, 'data-testid': 'plan-checks' },
          h('b', null, `Plan Checks · ${planChecks.length}`),
          planChecks.map((plan) => h('div', { key: plan.id, style: styles.card },
            h('div', null, h('b', null, plan.trigger), ` · ${plan.status}`),
            !readOnly && plan.status === 'PENDING' && h('div', null,
              h('input', { style: styles.input, value: planNotes, onChange: (event) => setPlanNotes(event.target.value) }),
              h(Button, { disabled: busy, onClick: () => act('complete-plan-check', { actor: { type: 'pl', id: lead }, projectId: selected.project.id, planCheckId: plan.id, decision: 'KEEP_PLAN', notes: planNotes }) }, 'KEEP PLAN'))))));
    }

    function ProjectDecisions({ selected, busy, act, readOnly = false }) {
      const decisions = selected.decisions || [];
      const [form, setForm] = React.useState({ title: '', body: '', charterImpact: 'NONE' });
      return h('div', { style: styles.section, 'data-testid': 'project-decisions' },
        h('b', null, `项目决策记录 · ${decisions.length}`),
        h('div', { style: { ...styles.muted, marginTop: 4 } }, '技术决策与重大目标/范围变更都保存在项目事实中；重大变更由已认证 Human Owner 明确确认。'),
        decisions.length === 0 && h('div', { style: styles.card }, '尚无已批准决策。'),
        decisions.map((item) => h('div', { key: item.id, style: styles.card },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('b', null, item.title), h('span', { style: styles.tag }, item.status)),
          h('div', { style: { marginTop: 5 } }, item.body),
          h('div', { style: styles.muted }, `${item.approvedBy || '未记录批准人'} · ${formatDateTime(item.approvedAt || item.createdAt)}`))),
        !readOnly && h('div', { style: styles.card },
          h('input', { style: styles.input, value: form.title, placeholder: '决策标题', onChange: (event) => setForm({ ...form, title: event.target.value }) }),
          h('textarea', { style: styles.input, value: form.body, placeholder: '已确认的决策内容', onChange: (event) => setForm({ ...form, body: event.target.value }) }),
          h('label', null, '对 Charter 的影响', h('select', {
            style: styles.input, value: form.charterImpact,
            onChange: (event) => setForm({ ...form, charterImpact: event.target.value }),
          }, [
            ['NONE', '无（普通技术决策）'], ['MISSION', '目标 Mission'], ['SCOPE', '范围 Scope'], ['CONSTRAINTS', '不可协商约束'],
          ].map(([value, label]) => h('option', { key: value, value }, label)))),
          h(Button, {
            disabled: busy || !form.title.trim() || !form.body.trim(), 'data-testid': 'record-project-decision',
            onClick: () => act('record-decision', {
              actor: { type: 'human', id: selected.project.ownerId }, projectId: selected.project.id,
              title: form.title.trim(), body: form.body.trim(), charterImpact: form.charterImpact,
            }).then(() => setForm({ title: '', body: '', charterImpact: 'NONE' })),
          }, 'Human 记录已批准决策')));
    }

    function ActivityView({ selected }) {
      const projectId = selected?.project?.id || '';
      const [items, setItems] = React.useState([]);
      const [cursor, setCursor] = React.useState(null);
      const [hasMore, setHasMore] = React.useState(false);
      const [facets, setFacets] = React.useState({ actors: [], eventTypes: [] });
      const [filters, setFilters] = React.useState({ actorId: '', eventType: '', taskId: '' });
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const requestSequence = React.useRef(0);
      const previousProjectId = React.useRef('');
      const latestActivityId = selected?.activities?.at(-1)?.id || '';
      const fetchFirst = async (nextFilters = filters) => {
        if (!projectId) return;
        const sequence = ++requestSequence.current;
        setLoading(true); setError('');
        try {
          const page = await requestActivityPage({ projectId, limit: 50, ...nextFilters });
          if (sequence !== requestSequence.current) return;
          setItems(page.items); setCursor(page.nextCursor); setHasMore(page.hasMore); setFacets(page.facets);
        } catch (e) { if (sequence === requestSequence.current) setError(`${e.code ? `${e.code}: ` : ''}${e.message}`); }
        finally { if (sequence === requestSequence.current) setLoading(false); }
      };
      React.useEffect(() => {
        const cleared = { actorId: '', eventType: '', taskId: '' };
        const projectChanged = previousProjectId.current !== projectId;
        previousProjectId.current = projectId;
        const nextFilters = projectChanged ? cleared : filters;
        if (projectChanged) {
          setFilters(cleared); setItems([]); setCursor(null); setHasMore(false); setError('');
        }
        if (projectId) fetchFirst(nextFilters);
      }, [projectId, latestActivityId]);
      const applyFilter = (name, value) => {
        const next = { ...filters, [name]: value };
        setFilters(next); setItems([]); setCursor(null); setHasMore(false);
        fetchFirst(next);
      };
      const loadMore = async () => {
        if (!projectId || !cursor || loading) return;
        const sequence = ++requestSequence.current;
        setLoading(true); setError('');
        try {
          const page = await requestActivityPage({ projectId, limit: 50, cursor, ...filters });
          if (sequence !== requestSequence.current) return;
          setItems((current) => {
            const seen = new Set(current.map((item) => item.id));
            return current.concat(page.items.filter((item) => !seen.has(item.id)));
          });
          setCursor(page.nextCursor); setHasMore(page.hasMore); setFacets(page.facets);
        } catch (e) { if (sequence === requestSequence.current) setError(`${e.code ? `${e.code}: ` : ''}${e.message}`); }
        finally { if (sequence === requestSequence.current) setLoading(false); }
      };
      const agentName = (id) => selected?.agents?.find((agent) => agent.id === id)?.displayName || id;
      const taskName = (id) => selected?.tasks?.find((task) => task.id === id)?.title || id;
      return h('section', { style: styles.section, 'aria-labelledby': 'activity-heading', 'data-testid': 'view-activity' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', { id: 'activity-heading' }, '活动记录'),
          h('div', { style: styles.row },
            h('span', { style: styles.tag }, `${items.length}${hasMore ? '+' : ''} 条`),
            selected && h(Button, { disabled: loading, 'data-testid': 'refresh-activities', onClick: () => fetchFirst(filters) }, '刷新'))),
        h('div', { style: { ...styles.muted, marginTop: 6 } }, '按当前 Project 从 Host 分页读取，默认最近 50 条；中文摘要直接可读，技术字段按需展开。'),
        !selected && h('div', { style: styles.card }, '创建并选择 Project 后显示 Host 活动记录。'),
        selected && h('div', { style: { ...styles.row, marginTop: 8 }, 'data-testid': 'activity-filters' },
          h('select', { style: { ...styles.input, flex: '1 1 190px', margin: 0 }, value: filters.actorId, onChange: (event) => applyFilter('actorId', event.target.value) },
            h('option', { value: '' }, '全部 Agent / 操作者'),
            facets.actors.map((entry) => h('option', { key: entry.value, value: entry.value }, `${agentName(entry.value)}（${entry.count}）`))),
          h('select', { style: { ...styles.input, flex: '1 1 190px', margin: 0 }, value: filters.eventType, onChange: (event) => applyFilter('eventType', event.target.value) },
            h('option', { value: '' }, '全部事件类型'),
            facets.eventTypes.map((entry) => h('option', { key: entry.value, value: entry.value }, `${ACTIVITY_LABELS[entry.value] || entry.value}（${entry.count}）`))),
          h('select', { style: { ...styles.input, flex: '1 1 190px', margin: 0 }, value: filters.taskId, onChange: (event) => applyFilter('taskId', event.target.value) },
            h('option', { value: '' }, '全部 Task'),
            (selected.tasks || []).map((task) => h('option', { key: task.id, value: task.id }, `${task.title} · ${task.id}`)))),
        error && h('div', { role: 'alert', style: { ...styles.card, color: '#d44' } }, error),
        selected && h('div', { 'data-testid': 'activity-feed' },
          items.map((item) => h('div', { key: item.id, style: styles.card },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('b', null, ACTIVITY_LABELS[item.eventType] || '系统事件'), h('span', { style: styles.muted }, formatDateTime(item.createdAt))),
            h('div', { style: { marginTop: 5 } }, ACTIVITY_DESCRIPTIONS[item.eventType] || item.summary),
            h('div', { style: { ...styles.muted, marginTop: 4 } }, `操作者：${agentName(item.actorId)}${item.taskId ? ` · Task：${taskName(item.taskId)}` : ''}`),
            h('details', { style: { marginTop: 7 } },
              h('summary', { style: { cursor: 'pointer', ...styles.muted } }, '技术审计原文'),
              h('div', { style: styles.muted }, `事件：${item.eventType}`),
              h('div', { style: styles.muted }, `原文：${item.summary}`),
              h('div', { style: styles.muted }, `操作者 ID：${item.actorId} · 对象：${item.objectRef}${item.taskId ? ` · Task ID：${item.taskId}` : ''}`)))),
          items.length === 0 && !loading && h('div', { style: styles.card }, '当前筛选条件下没有活动记录。'),
          hasMore && h(Button, { disabled: loading, 'data-testid': 'load-more-activities', onClick: loadMore, style: { ...styles.button, marginTop: 10 } }, loading ? '正在加载…' : '加载更多'),
          loading && items.length === 0 && h('div', { style: styles.card }, '正在读取活动记录…')));
    }

    // O1: describe only Host-reported work. A launch mode is not a model ID,
    // and an idle Agent is not evidence of a background model process.
    function DashboardView({ data, selected, onNavigate, busy }) {
      const projects = data?.projects || [];
      const tasks = selected?.tasks || [];
      const projectActive = selected?.project?.status === 'ACTIVE';
      const scopedTasks = tasks.filter((task) => task.status !== 'CANCELLED');
      const verified = scopedTasks.filter((task) => task.status === 'VERIFIED').length;
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const runtimes = new Map((data?.runtimes || []).map((runtime) => [runtime.providerKey, runtime]));
      const activeRuns = (selected?.taskRuns || []).filter((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
      const latestRuns = new Map((selected?.taskRuns || []).map((run) => [run.taskId, run]));
      const latestReviewRuns = new Map((selected?.reviewRuns || []).map((run) => [run.taskId, run]));
      const agents = (selected?.agents || []).filter((agent) => agent.status !== 'REPLACED');
      const humanProjects = projects.filter((project) => ['CHARTER_PENDING_APPROVAL', 'TEAM_PENDING_APPROVAL'].includes(project.status));
      const interviewProjects = projects.filter((project) => project.status === 'CHARTER_INTERVIEW');
      const submittedTasks = tasks.filter((task) => task.status === 'SUBMITTED');
      const reviewerReady = (task) => task.reviewPolicy !== 'REVIEWER_PL' || (selected?.reviews || []).some((review) =>
        review.taskId === task.id && review.resultId === task.resultId && review.reviewerRole === 'REVIEWER' && review.decision === 'APPROVE');
      const incompleteEvidence = (task) => {
        const result = (selected?.results || []).find((item) => item.id === task.resultId);
        return result?.outcome !== 'SUCCESS' || (selected?.evidence || []).some((item) => item.resultId === task.resultId && item.status === 'FAILED');
      };
      const riskTasks = projectActive ? submittedTasks.filter((task) => reviewerReady(task) && incompleteEvidence(task)) : [];
      const reviewerTasks = projectActive ? submittedTasks.filter((task) => !reviewerReady(task)) : [];
      const plTasks = projectActive ? submittedTasks.filter((task) => reviewerReady(task) && !incompleteEvidence(task)) : [];
      const leadId = selected?.project?.leadAgentId;
      const reviewerIds = new Set(agents.filter((agent) => agent.role === 'REVIEWER').map((agent) => agent.id));
      const openRequests = (selected?.requests || []).filter((item) => ['PENDING', 'IN_PROGRESS'].includes(item.status));
      const reviewRequests = projectActive ? openRequests.filter((item) => item.toAgentId === leadId || reviewerIds.has(item.toAgentId)) : [];
      const otherRequests = projectActive ? openRequests.filter((item) => !reviewRequests.includes(item)) : [];
      const planChecks = projectActive ? (selected?.planChecks || []).filter((item) => item.status === 'PENDING') : [];
      const taskProposals = projectActive ? (selected?.taskProposals || []).filter((item) => item.status === 'PENDING') : [];
      const waitingTasks = projectActive ? tasks.filter((task) => task.status === 'WAITING') : [];
      const failedRuns = projectActive ? [...latestRuns.values()].filter((run) =>
        ['FAILED', 'CANNOT_START', 'UNKNOWN', 'TIMED_OUT'].includes(run.status)
        && !['VERIFIED', 'CANCELLED'].includes(taskById.get(run.taskId)?.status)) : [];
      const openFindings = projectActive ? (selected?.findings || []).filter((item) => item.status !== 'CLOSED') : [];
      const recentActivities = [...(selected?.activities || [])].reverse().slice(0, 6);
      const currentCharter = selected?.charters?.find((charter) => charter.version === selected.project.charterVersion) || selected?.charters?.at(-1);
      const currentMilestone = scopedTasks.find((task) => task.status !== 'VERIFIED')?.title || (scopedTasks.length ? '范围内任务均已完成' : '尚未建立任务');
      const goto = (view, projectId = selected?.project?.id) => onNavigate(view, projectId);
      const teamStatus = (agent) => {
        const run = activeRuns.find((item) => item.agentId === agent.id);
        const reviewRun = [...latestReviewRuns.values()].find((item) => item.reviewerAgentId === agent.id && ['STARTING', 'RUNNING'].includes(item.status));
        const disagree = agent.currentTaskId && run && agent.currentTaskId !== run.taskId;
        const task = !disagree && taskById.get(agent.currentTaskId || run?.taskId || reviewRun?.taskId);
        if (task) return `${task.title} · ${taskStatusLabel(task.status)}${task.waiting?.reason ? ` · 等待原因：${task.waiting.reason}` : ''}`;
        if (agent.status === 'RUNNING' || run || reviewRun || disagree) return '当前任务未知';
        if (agent.role === 'PROJECT_LEAD' && ['CHARTER_PENDING_APPROVAL', 'TEAM_PENDING_APPROVAL'].includes(selected.project.status)) return '等待 Human 批准';
        if (agent.role === 'PROJECT_LEAD' && plTasks.length) return `${plTasks.length} 个 Task 待 PL 审核（不代表模型正在运行）`;
        if (agent.role === 'REVIEWER' && reviewerTasks.length) return `${reviewerTasks.length} 个 Task 待独立审核（不代表模型正在运行）`;
        return agent.currentTaskId ? '当前任务未知' : '当前未占用 Task';
      };
      const attentionRow = (label, count, view, testId) => count > 0 && h('div', { style: { ...styles.row, justifyContent: 'space-between', marginTop: 6 } },
        h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, `${label} · ${count}`),
        h(Button, { disabled: busy, 'data-testid': testId, onClick: () => goto(view) }, '查看'));
      return h('section', { style: styles.section, 'aria-labelledby': 'dashboard-heading', 'data-testid': 'view-dashboard' },
        h('strong', { id: 'dashboard-heading', style: { fontSize: 16 } }, '总览 · 当前工作与待处理'),
        !data && h('div', { style: styles.card }, '正在读取 Host 状态…'),
        data && h('div', null,
          selected ? h('div', { style: styles.card, 'data-testid': 'dashboard-current-project' },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('b', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, `当前项目：${selected.project.name}`),
              h('span', { style: styles.tag }, projectStatusLabel(selected.project.status))),
            h('div', { style: { marginTop: 5, overflowWrap: 'anywhere' } }, h('b', null, '目标：'), currentCharter?.mission || selected.project.initialGoal),
            h('div', { style: styles.muted }, `当前里程碑：${currentMilestone}`),
            h('div', { style: { marginTop: 5, fontWeight: 600 }, 'data-testid': 'dashboard-task-progress' }, `已验收 Task ${verified} / 有效 Task ${scopedTasks.length}`),
            h('div', { style: { ...styles.row, marginTop: 6 } },
              h(Button, { disabled: busy, 'data-testid': 'dashboard-goto-tasks', onClick: () => goto('tasks') }, '查看任务'),
              h(Button, { disabled: busy, 'data-testid': 'dashboard-goto-approvals', onClick: () => goto('approvals') }, '查看审批'),
              h(Button, { disabled: busy, 'data-testid': 'dashboard-goto-activity', onClick: () => goto('activity') }, '查看活动'))) :
            h('div', { style: styles.card }, '创建并选择 Project 后显示当前项目进度。'),
          selected && agents.length > 0 && h('div', { style: styles.section, 'data-testid': 'dashboard-team-activity' },
            h('b', null, `团队当前状态 · ${agents.length}`),
            h('div', { style: { ...styles.row, alignItems: 'stretch' } }, agents.map((agent) => {
              const runtime = runtimes.get(agent.providerKey);
              const role = agent.role === 'PROJECT_LEAD' ? 'PL' : agent.role === 'REVIEWER' ? '独立 Reviewer' : 'Worker';
              return h('div', { key: agent.id, style: { ...styles.card, flex: '1 1 250px' }, 'data-testid': `dashboard-agent-${agent.id}` },
                h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                  h('b', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, agent.displayName),
                  h('span', { style: styles.tag }, AGENT_STATUS_LABELS[agent.status] || agent.status)),
                h('div', { style: styles.muted }, `${role} · 后端：${runtime?.displayName || agent.providerKey}`),
                h('div', { style: styles.muted }, `Provider：${agent.providerKey}${agent.providerKey.startsWith('subagent:') ? ' · 实际模型：未报告' : ''}`),
                h('div', { style: { marginTop: 5, overflowWrap: 'anywhere' } }, teamStatus(agent)));
            }))),
          h('div', { style: { ...styles.row, alignItems: 'stretch' }, 'data-testid': 'dashboard-attention-groups' },
            h('div', { style: { ...styles.card, flex: '1 1 250px' }, 'data-testid': 'dashboard-human-queue' },
              h('b', null, `Human 待审批 · ${humanProjects.length + riskTasks.length}`),
              humanProjects.map((project) => h('div', { key: project.id, style: { ...styles.row, justifyContent: 'space-between', marginTop: 6 } },
                h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, `${project.name} · ${projectStatusLabel(project.status)}`),
                h(Button, { disabled: busy, 'aria-label': `处理 ${project.name} 的${projectStatusLabel(project.status)}`, 'data-testid': `dashboard-approve-${project.id}`, onClick: () => goto('approvals', project.id) }, '去批准'))),
              riskTasks.length > 0 && h('div', { style: { marginTop: 6 } }, `Host 验证不完整，待 Owner 决定是否接受风险：${riskTasks.length}`),
                riskTasks.length > 0 && h(Button, { disabled: busy, onClick: () => goto('approvals') }, '查看风险验收'),
                humanProjects.length + riskTasks.length === 0 && h('div', { style: styles.muted }, '暂无待 Human 审批事项')),
            h('div', { style: { ...styles.card, flex: '1 1 250px' }, 'data-testid': 'dashboard-agent-queue' },
              h('b', null, `PL / Reviewer 工作队列 · ${plTasks.length + reviewerTasks.length + reviewRequests.length + planChecks.length + taskProposals.length}`),
              attentionRow('待 PL 审核的 Task', plTasks.length, 'approvals', 'dashboard-pl-reviews'),
              attentionRow('待独立 Reviewer 审核的 Task', reviewerTasks.length, 'approvals', 'dashboard-reviewer-reviews'),
              attentionRow('待 Agent 回复的 Request', reviewRequests.length, 'approvals', 'dashboard-agent-requests'),
              attentionRow('待 PL 完成的 Plan Check', planChecks.length, 'approvals', 'dashboard-plan-checks'),
              attentionRow('待 PL 决定的 Task 提案', taskProposals.length, 'tasks', 'dashboard-task-proposals'),
              plTasks.length + reviewerTasks.length + reviewRequests.length + planChecks.length + taskProposals.length === 0 && h('div', { style: styles.muted }, '暂无待 PL / Reviewer 处理事项')),
            h('div', { style: { ...styles.card, flex: '1 1 250px' }, 'data-testid': 'dashboard-blockers' },
              h('b', null, `阻塞 / 异常提醒 · ${waitingTasks.length + failedRuns.length + openFindings.length + otherRequests.length + interviewProjects.length}`),
              waitingTasks.map((task) => h('div', { key: task.id, style: { marginTop: 6, overflowWrap: 'anywhere' } }, `${task.title} · 等待处理${task.waiting?.reason ? `：${task.waiting.reason}` : ''}`)),
              failedRuns.map((run) => h('div', { key: run.id, style: { marginTop: 6, overflowWrap: 'anywhere' } }, `${taskById.get(run.taskId)?.title || '未知 Task'} · Run ${run.status}${run.error?.code ? `（${run.error.code}）` : ''}`)),
              attentionRow('未关闭 Finding', openFindings.length, 'approvals', 'dashboard-findings'),
              attentionRow('待其他 Agent 回复的 Request', otherRequests.length, 'approvals', 'dashboard-other-requests'),
              interviewProjects.map((project) => h('div', { key: project.id, style: { ...styles.row, justifyContent: 'space-between', marginTop: 6 } },
                h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, `${project.name} · 访谈尚未完成（不是审批）`),
                h(Button, { disabled: busy, 'data-testid': `dashboard-interview-${project.id}`, onClick: () => goto('approvals', project.id) }, '查看访谈'))),
              waitingTasks.length + failedRuns.length + openFindings.length + otherRequests.length + interviewProjects.length === 0 && h('div', { style: styles.muted }, '暂无阻塞或异常'))),
          selected && recentActivities.length > 0 && h('div', { style: { ...styles.card, marginTop: 10 }, 'data-testid': 'dashboard-recent-activity' },
            h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
              h('b', null, '最近活动'), h(Button, { disabled: busy, 'data-testid': 'dashboard-goto-activity-full', onClick: () => goto('activity') }, '全部')),
            recentActivities.map((item) => h('div', { key: item.id, style: { ...styles.muted, marginTop: 5, overflowWrap: 'anywhere' } },
              `${formatDateTime(item.createdAt)} · ${ACTIVITY_LABELS[item.eventType] || item.eventType} · ${item.summary}`)))));
    }

    function ControlPlanePanel({ onClose, onOpenPLChat, defaultWorkspaceDir }) {
      const [data, setData] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [createMode, setCreateMode] = React.useState(false);
      const [selectedProjectId, setSelectedProjectId] = React.useState('');
      const [activeView, setActiveView] = React.useState('dashboard');
      const [switchingProjectId, setSwitchingProjectId] = React.useState('');
      const loadSequence = React.useRef(0);
      const switchingProjectRef = React.useRef('');
      const selected = data?.selected;
      const ownerId = selected?.project?.ownerId || 'authenticated-owner';

      const load = React.useCallback(async (projectId = selectedProjectId) => {
        if (switchingProjectRef.current) return null;
        const sequence = ++loadSequence.current;
        const next = await requestSnapshot(projectId);
        if (sequence !== loadSequence.current || switchingProjectRef.current) return null;
        setData(next);
        if (!selectedProjectId && next.selected?.project?.id) setSelectedProjectId(next.selected.project.id);
        return next;
      }, [selectedProjectId]);

      React.useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
      React.useEffect(() => {
        const active = data?.selected?.taskRuns?.some((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status));
        if (!active || switchingProjectId || busy) return undefined;
        const timer = setInterval(() => {
          if (globalThis.document?.visibilityState === 'hidden' || switchingProjectRef.current) return;
          load().catch((e) => setError(e.message));
        }, 3000);
        return () => clearInterval(timer);
      }, [activeView, data?.selected?.taskRuns?.map((run) => `${run.id}:${run.status}`).join('|'), load, switchingProjectId, busy]);

      const navigate = async (view, projectId = selected?.project?.id) => {
        if (switchingProjectRef.current) return false;
        if (!projectId || projectId === selected?.project?.id) {
          setCreateMode(false);
          setActiveView(view);
          return true;
        }
        // Keep A selected while fetching B. Commit Project and tab together
        // only after the Host confirms the B snapshot; an older poll cannot
        // overwrite B, and a failed switch leaves A's actions bound to A.
        const sequence = ++loadSequence.current;
        switchingProjectRef.current = projectId;
        setSwitchingProjectId(projectId);
        setError('');
        try {
          const next = await requestSnapshot(projectId);
          if (sequence !== loadSequence.current) return false;
          setData(next);
          setSelectedProjectId(projectId);
          setCreateMode(false);
          setActiveView(view);
          return true;
        } catch (e) {
          if (sequence === loadSequence.current) setError(`切换 Project 失败：${e.message}`);
          return false;
        } finally {
          if (sequence === loadSequence.current) {
            switchingProjectRef.current = '';
            setSwitchingProjectId('');
          }
        }
      };

      const act = async (action, body) => {
        ++loadSequence.current;
        setBusy(true); setError(''); setNotice('');
        try {
          const next = await request(action, body);
          setData(next); setSelectedProjectId(next.selected?.project?.id || ''); setCreateMode(false);
          if (action === 'delete-project' && next.deletedProject) {
            setNotice(`已删除 Project「${next.deletedProject.name}」的控制面记录；工作目录和 PL 对话均未改动。`);
          }
          if (action === 'create-project' && next.selected?.project) {
            try {
              await onOpenPLChat(next.selected);
              await load(next.selected.project.id);
            } catch (e) {
              // R3.3: the Project record is already committed. Surface a
              // recoverable state instead of a duplicate Project on retry.
              setError(`Project 已创建，但 PL 对话未打开：${e.message}。可在“项目”页重试创建，不会重复创建 Project。`);
            }
          }
        }
        catch (e) { setError(`${e.code ? `${e.code}: ` : ''}${e.message}`); }
        finally { setBusy(false); }
      };

      const launchPLChat = async (projectState) => {
        setBusy(true); setError(''); setNotice('');
        try {
          const outcome = await onOpenPLChat(projectState);
          if (outcome?.message) setError(outcome.message);
        }
        catch (e) { setError(`PL_CHAT_START_FAILED: ${e.message}`); }
        finally { setBusy(false); }
      };

      const tabs = [
        ['dashboard', '总览'], ['project', '项目'], ['agents', '团队'],
        ['tasks', '任务'], ['approvals', '审批'], ['activity', '活动'],
      ];
      const projectGroups = data ? [
        ['进行中的项目', ['ACTIVE']],
        ['等待配置或批准', ['CHARTER_INTERVIEW', 'CHARTER_PENDING_APPROVAL', 'TEAM_PENDING_APPROVAL']],
        ['已停止（可恢复）', ['STOPPED']],
        ['已完成', ['COMPLETED']],
      ].map(([label, statuses]) => [label, data.projects.filter((project) => statuses.includes(project.status))])
        .filter(([, projects]) => projects.length > 0) : [];
      const scopedTasks = selected?.tasks?.filter((task) => task.status !== 'CANCELLED') || [];
      const verifiedTasks = scopedTasks.filter((task) => task.status === 'VERIFIED');
      const cancelledTasks = selected?.tasks?.filter((task) => task.status === 'CANCELLED') || [];
      const completionBlockers = selected ? [
        scopedTasks.length === 0 && '至少需要一个未取消的 Task',
        scopedTasks.some((task) => task.status !== 'VERIFIED') && `${scopedTasks.length - verifiedTasks.length} 个 Task 尚未验收`,
        selected.taskRuns.some((run) => ['CREATED', 'STARTING', 'RUNNING'].includes(run.status)) && '存在运行中的 Worker Run',
        selected.reviewRuns.some((run) => ['STARTING', 'RUNNING'].includes(run.status)) && '存在运行中的 Review Run',
        selected.requestRuns.some((run) => ['STARTING', 'RUNNING'].includes(run.status)) && '存在运行中的 Request Run',
        selected.requests.some((item) => ['PENDING', 'IN_PROGRESS'].includes(item.status)) && '存在未处理的协作请求',
        selected.taskProposals.some((item) => item.status === 'PENDING') && '存在待决定的 Task 提案',
        selected.planChecks.some((item) => item.status === 'PENDING') && '存在待完成的计划检查',
        selected.findings.some((item) => item.status !== 'CLOSED') && '存在未关闭的问题',
      ].filter(Boolean) : [];
      const selectedPlRuntime = selected ? data.runtimes.find((runtime) => runtime.providerKey === selected.project.leadRuntimeKey) : null;
      const selectedWorkerRuntime = selected ? data.runtimes.find((runtime) => runtime.providerKey === selected.project.workerRuntimeKey) : null;
      const projectView = data && h('section', { 'aria-labelledby': 'project-heading', 'data-testid': 'view-project' },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          h('strong', { id: 'project-heading', style: { fontSize: 16 } }, 'Project'),
          h(Button, { 'data-testid': 'new-project', onClick: () => setCreateMode((value) => !value) }, createMode ? '收起创建表单' : '新建 Project')),
        h('div', { style: styles.muted, 'data-testid': 'owner-identity' }, selected
          ? `负责人身份由 Host 认证：${selected.project.ownerId}`
          : '负责人身份将在创建时由 Host 认证，不接受手工输入。'),
        data.projects.length > 0 && h('label', null, '当前 Project', h('select', {
          style: styles.input, value: selected?.project?.id || '', disabled: busy || Boolean(switchingProjectId), 'data-testid': 'project-selector',
          onChange: (event) => { navigate('project', event.target.value); },
        }, projectGroups.map(([label, projects]) => h('optgroup', { key: label, label },
          projects.map((project) => h('option', { key: project.id, value: project.id }, `${project.name} · ${projectStatusLabel(project.status)} · ${project.id}`)))))),
        selected && !createMode && h('div', { style: styles.card, 'data-testid': 'project-summary' },
          h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('strong', null, selected.project.name), h('span', { style: styles.tag, 'data-testid': 'project-status' }, projectStatusLabel(selected.project.status))),
          h('div', { style: styles.muted }, `${selected.project.id} · owner ${selected.project.ownerId} · version ${selected.project.version}`),
          h('div', { style: styles.muted }, `Workspace: ${selected.project.workspaceDir}`),
          h('div', { style: styles.muted }, `PL Runtime：${selectedPlRuntime?.displayName || selected.project.leadRuntimeKey}`),
          h('div', { style: styles.muted, 'data-testid': 'project-worker-runtime' }, `Worker Runtime：${selectedWorkerRuntime?.displayName || selected.project.workerRuntimeKey || '自动选择'}${selected.project.workerRuntimeKey ? `（${selected.project.workerRuntimeKey}）` : ''}`),
          h('div', { style: { marginTop: 8 } }, h('b', null, 'Mission: '), (selected.charters.find((charter) => charter.version === selected.project.charterVersion) || selected.charters.at(-1))?.mission || selected.project.initialGoal),
          h('div', { style: styles.muted }, `当前里程碑：${(scopedTasks.find((task) => task.status !== 'VERIFIED') || {}).title || '范围内任务均已完成'} · 验收 ${verifiedTasks.length}/${scopedTasks.length}${cancelledTasks.length ? ` · 历史取消 ${cancelledTasks.length}` : ''}`),
          selected.project.status === 'ACTIVE' && completionBlockers.length > 0 && h('div', { style: { ...styles.muted, marginTop: 6 }, 'data-testid': 'completion-blockers' },
            `暂不可完成 Project：${completionBlockers.join('；')}`),
          h('div', { style: { ...styles.row, marginTop: 9 } },
            !selected.project.plSessionId && !['STOPPED', 'COMPLETED'].includes(selected.project.status) && h(Button, { disabled: busy, 'data-testid': 'retry-create-pl-chat', onClick: () => launchPLChat(selected) }, '重试创建 PL 对话'),
            selected.project.status === 'STOPPED' && h(Button, {
              disabled: busy, 'data-testid': 'resume-project',
              onClick: () => act('resume-project', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, expectedVersion: selected.project.version }),
            }, '恢复 Project'),
            selected.project.status === 'ACTIVE' && completionBlockers.length === 0 && h(Button, {
              disabled: busy, 'data-testid': 'complete-project',
              onClick: () => act('complete-project', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, expectedVersion: selected.project.version }),
            }, '验收并完成 Project'),
            selected.project.status === 'ACTIVE' && h(Button, {
              disabled: busy, 'data-testid': 'stop-project',
              onClick: () => {
                if (!globalThis.confirm('停止后，未开始或等待中的 Task 会记为“已取消”，但 Project 之后可以恢复并创建新 Task。确认停止？')) return;
                act('stop-project', { actor: { type: 'human', id: ownerId }, projectId: selected.project.id, expectedVersion: selected.project.version, reason: '由 Human Owner 在控制台停止' });
              },
            }, '停止 Project（可恢复）'),
            selected.project.status !== 'ACTIVE' && h(Button, {
              disabled: busy,
              'data-testid': 'delete-project',
              style: { ...styles.button, color: '#d44' },
              title: '只删除控制面中的 Project 及其审计记录，不删除工作目录或 PL 对话',
              onClick: () => {
                if (!globalThis.confirm(`永久删除 Project「${selected.project.name}」？\n\n将删除控制面中的 Charter、Agent、Task、Run、Review 和 Activity 记录。工作目录与 PL 对话不会删除。此操作不可恢复。`)) return;
                act('delete-project', {
                  actor: { type: 'human', id: ownerId },
                  projectId: selected.project.id,
                  expectedVersion: selected.project.version,
                  confirmation: selected.project.id,
                });
              },
            }, '永久删除 Project 记录'))),
        selected && !createMode && h(ProjectDecisions, { selected, busy, act, readOnly: selected.project.status !== 'ACTIVE' }),
        (!selected || createMode) && h(ProjectForm, { data, ownerId, busy, act, defaultWorkspaceDir }),
        h(RuntimeCatalog, { data, ownerId, busy, act }));

      let view;
      if (switchingProjectId) view = h('div', { role: 'status', style: styles.card, 'data-testid': 'project-switching' },
        `正在切换到 Project「${data?.projects?.find((item) => item.id === switchingProjectId)?.name || switchingProjectId}」并读取其状态…`);
      else if (!data) view = h('div', { style: styles.card },
        h('p', null, error ? `Host 状态读取失败：${error}` : '正在读取 Host 状态…'),
        error && h(Button, { 'data-testid': 'retry-load', onClick: () => { setError(''); load().catch((e) => setError(e.message)); } }, '重试'));
      else if (activeView === 'dashboard') view = h(DashboardView, { data, selected, onNavigate: navigate, busy });
      else if (activeView === 'project') view = projectView;
      else if (activeView === 'agents') view = h('section', { 'aria-labelledby': 'agents-heading', 'data-testid': 'view-agents' },
        h('strong', { id: 'agents-heading', style: { fontSize: 16 } }, 'Agents'),
        selected && !createMode ? h(ActiveTeam, { selected, runtimes: data.runtimes, ownerId, busy, act }) : h('div', { style: styles.card }, '创建并选择 Project 后显示 Agent Records。'));
      else if (activeView === 'tasks') view = h('section', { 'aria-labelledby': 'tasks-heading', 'data-testid': 'view-tasks' },
        h('strong', { id: 'tasks-heading', style: { fontSize: 16 } }, 'Tasks'),
        selected && !createMode && ['ACTIVE', 'STOPPED', 'COMPLETED'].includes(selected.project.status)
          ? h(TaskBoard, { selected, busy, act, readOnly: selected.project.status !== 'ACTIVE' })
          : h('div', { style: styles.card }, 'Task DAG 在 Project ACTIVE 后启用。'));
      else if (activeView === 'approvals') view = h('section', { 'aria-labelledby': 'approvals-heading', 'data-testid': 'view-approvals' },
        h('strong', { id: 'approvals-heading', style: { fontSize: 16 } }, 'Approvals & Governance'),
        selected && !createMode && selected.project.status === 'CHARTER_INTERVIEW' && h(Interview, { selected, ownerId, busy, act }),
        selected && !createMode && selected.project.status === 'CHARTER_PENDING_APPROVAL' && h(CharterApproval, { selected, ownerId, busy, act }),
        selected && !createMode && selected.project.status === 'TEAM_PENDING_APPROVAL' && h(TeamApproval, { selected, runtimes: data.runtimes, ownerId, busy, act }),
        selected && !createMode && ['ACTIVE', 'COMPLETED', 'STOPPED'].includes(selected.project.status) && h(GovernancePanel, { selected, ownerId, busy, act, readOnly: selected.project.status !== 'ACTIVE' }),
        (!selected || createMode) && h('div', { style: styles.card }, '创建并选择 Project 后显示审批队列。'));
      else view = h(ActivityView, { selected });

      return h('section', { 'aria-label': 'Agent Team Control Plane', style: styles.page, 'data-testid': 'control-plane' },
        h('header', { style: styles.header },
          h('div', { style: { minWidth: 0 } },
            h('strong', { style: { display: 'block', fontSize: 18 } }, 'Agent Team Control Plane'),
            h('div', { style: { ...styles.muted, overflowWrap: 'anywhere' } }, switchingProjectId ? '正在切换项目…' : selected ? `${selected.project.name} · ${projectStatusLabel(selected.project.status)}` : 'Project、Agent、Task 与审批控制台')),
          h('div', { style: styles.row },
            h(Button, { 'data-testid': 'close-control-plane', onClick: onClose }, '关闭控制台'))),
        h('nav', { style: styles.tabBar, 'aria-label': 'Control Plane views' },
          tabs.map(([id, label]) => h('button', {
            key: id, type: 'button', disabled: Boolean(switchingProjectId), 'data-testid': `tab-${id}`, onClick: () => setActiveView(id),
            style: activeView === id
              ? { ...styles.tab, color: 'var(--dsw-alias-content-primary)', background: 'var(--dsw-alias-surface-subtle)', borderColor: 'var(--dsw-alias-border-subtle)', fontWeight: 600 }
              : styles.tab,
          }, label))),
        h('main', { style: styles.body },
          h('div', { style: styles.content },
            notice && h('div', { role: 'status', 'data-testid': 'notice', style: { ...styles.card, color: '#2a7', marginBottom: 12 } }, notice),
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
        const currentWorkspace = () => {
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot();
          const sessionSnapshot = ctx.sessions.list.getSnapshot();
          const current = currentSessionId(sessionSnapshot);
          return workspaceSnapshot.items.find((item) => item.sessionIds.includes(current));
        };
        const resolveWorkspaceId = (project) => {
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot();
          const sessionSnapshot = ctx.sessions.list.getSnapshot();
          const exact = workspaceSnapshot.items.find((item) => normalizedPath(item.path) === normalizedPath(project?.workspaceDir));
          if (exact) return exact.workspaceId;
          const currentItem = currentWorkspace();
          if (currentItem) return currentItem.workspaceId;
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
          // R3/R5: a bound Project always targets its existing Session first.
          // R0 verified uiWorkspace.openSession(sessionId) as the public Host
          // navigation API, including persisted Sessions that are not currently
          // retained by the main view.
          if (project.plSessionId) {
            if (typeof ctx.uiWorkspace.openSession !== 'function') {
              throw new Error('Host 未提供 openSession，已保留原绑定且不会新建重复会话');
            }
            try {
              await ctx.uiWorkspace.openSession(project.plSessionId);
              return { reused: true, sessionId: project.plSessionId, message: '已返回该 Project 绑定的 PL 对话。' };
            } catch (error) {
              const sessionSnapshot = ctx.sessions.list.getSnapshot();
              if (sessionSnapshot.byId?.[project.plSessionId]) {
                throw new Error(`Host 无法打开仍存在的 PL 会话：${error.message}`);
              }
            }
            // Host confirms the old reference is unavailable: create one
            // replacement and atomically persist the new binding.
          }
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
            'Agent Team Control Plane 是唯一可信状态源：第一步必须调用 agent_team_project_state 读取本 Project。只有 agent_team_* 工具返回的 Charter、Task、Run、Result、Review 才能在回复中声称已存在。',
            'PL 对话只负责访谈、计划、编排与反馈：不要直接修改项目文件、不要直接运行实现命令、不要把自己完成的工作冒充为 Worker Task。正式工作必须经控制面建 Task、指派 Worker、启动 Run。',
            project.status === 'CHARTER_INTERVIEW'
              ? '当前处于需求访谈阶段：先读取控制面状态，再围绕范围、禁止修改项/技术约束、可验证成功标准提出简短问题；Human 回答后调用 agent_team_record_interview 写入 Charter 草案，然后明确要求 Human 回到 Agent 团队控制台批准 Charter。'
              : '先说明你已接管，概括当前目标，并给出一个明确、可执行的下一步；需要 Human 决策时直接提问。',
            '每次回复末尾都用“下一步：”明确说明 Human 或团队接下来要做什么。',
          ].join('\n');
          let createdSessionId = null;
          let bindAndSubmit = null;
          await ctx.uiWorkspace.openWorkspace(workspaceId, (sessionId) => {
            createdSessionId = sessionId;
            const binding = ctx.sessions.binding(sessionId);
            if (!binding?.ctx) throw new Error('新 PL 会话尚未就绪');
            const result = ctx.conversation.input.requestDraftInitialization(binding, {
              prompt, clearPreviousDraft: true,
            });
            if (result === 'blocked') throw new Error('新 PL 会话输入区正忙，请稍后重试');
            // R1: persist the Project ↔ PL Session binding so agent_team_* tools
            // can authorize this exact Session. Bind before submitting the PL
            // prompt, eliminating the race where the new PL could call a tool
            // before its Session became authoritative.
            bindAndSubmit = request('bind-project-pl-session', {
              projectId: project.id,
              plSessionId: sessionId,
            }).then(() => {
              ctx.conversation.input.for(binding.ctx).submit();
              return sessionId;
            });
          }, { agentPreset: 'standard' });
          if (!createdSessionId || !bindAndSubmit) throw new Error('PL 会话创建被后续导航中断，Project 尚未绑定会话');
          await bindAndSubmit;
          return { reused: false, sessionId: createdSessionId, message: '已创建并绑定新的 PL 对话。' };
        };
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'agent-team-control-plane',
        }, () => h(ControlPlanePanel, {
          onClose: close,
          onOpenPLChat: openPLChat,
          defaultWorkspaceDir: currentWorkspace()?.path || '',
        })));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'agent-team-control-plane', order: 20, label: 'Agent 团队',
        }, ControlPlaneIcon));
      },
    };
  },
});
