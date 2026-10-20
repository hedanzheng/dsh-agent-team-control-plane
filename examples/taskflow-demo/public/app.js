export function renderTasks(tasks, list) {
  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement('li');
    item.dataset.taskId = task.id;
    item.textContent = `${task.title} · ${task.status}`;
    return item;
  }));
}

if (typeof document !== 'undefined') {
  const form = document.querySelector('#task-form');
  const title = document.querySelector('#task-title');
  const list = document.querySelector('#task-list');
  const message = document.querySelector('#message');
  const local = [];
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = title.value.trim();
    if (!value) { message.textContent = '请输入任务标题'; return; }
    local.push({ id: String(local.length + 1), title: value, status: 'TODO' });
    title.value = '';
    message.textContent = '任务已添加';
    renderTasks(local, list);
  });
}
