export const TASK_STATUS = Object.freeze(['TODO', 'DOING', 'DONE']);

export function validateTaskInput(value) {
  if (!value || typeof value.title !== 'string' || !value.title.trim()) {
    return { ok: false, error: 'title is required' };
  }
  if (value.title.trim().length > 120) return { ok: false, error: 'title exceeds 120 characters' };
  return { ok: true, value: { title: value.title.trim() } };
}

export function taskResource(task) {
  return { id: task.id, title: task.title, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt };
}
