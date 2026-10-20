import { TASK_STATUS, taskResource, validateTaskInput } from './contract.js';

export class TaskApi {
  constructor(clock = () => new Date().toISOString()) {
    this.clock = clock;
    this.tasks = new Map();
    this.nextId = 1;
  }

  list() {
    return [...this.tasks.values()].map(taskResource);
  }

  create(input) {
    const checked = validateTaskInput(input);
    if (!checked.ok) return { status: 400, body: { error: checked.error } };
    const at = this.clock();
    const task = { id: String(this.nextId++), title: checked.value.title, status: 'TODO', createdAt: at, updatedAt: at };
    this.tasks.set(task.id, task);
    return { status: 201, body: taskResource(task) };
  }

  updateStatus(id, status) {
    const task = this.tasks.get(String(id));
    if (!task) return { status: 404, body: { error: 'task not found' } };
    if (!TASK_STATUS.includes(status)) return { status: 400, body: { error: 'invalid status' } };
    task.status = status;
    task.updatedAt = this.clock();
    return { status: 200, body: taskResource(task) };
  }
}
