const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'tasks.json');

async function loadTasks() {
  await fs.ensureFile(DATA_FILE);
  try {
    const data = await fs.readJson(DATA_FILE);
    return data;
  } catch {
    return [];
  }
}

async function saveTasks(tasks) {
  await fs.ensureDir(path.dirname(DATA_FILE));
  await fs.writeJson(DATA_FILE, tasks, { spaces: 2 });
}

async function addTask(title) {
  const tasks = await loadTasks();
  const task = {
    id: Date.now(),
    title,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  await saveTasks(tasks);
  return task;
}

async function listTasks() {
  return await loadTasks();
}

async function completeTask(index) {
  const tasks = await loadTasks();
  if (index < 1 || index > tasks.length) return null;
  tasks[index - 1].completed = true;
  tasks[index - 1].completedAt = new Date().toISOString();
  await saveTasks(tasks);
  return tasks[index - 1];
}

async function deleteTask(index) {
  const tasks = await loadTasks();
  if (index < 1 || index > tasks.length) return null;
  const removed = tasks.splice(index - 1, 1)[0];
  await saveTasks(tasks);
  return removed;
}

function formatTaskList(tasks) {
  if (tasks.length === 0) return 'タスクはありません。';
  return tasks
    .map((t, i) => {
      const status = t.completed ? '✅' : '⬜';
      return `${status} ${i + 1}. ${t.title}`;
    })
    .join('\n');
}

module.exports = {
  addTask,
  listTasks,
  completeTask,
  deleteTask,
  formatTaskList,
};
