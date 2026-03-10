const { processMessage } = require('./ai');
const schedule = require('./schedule');
const tasks = require('./tasks');

// Per-user conversation history (in-memory, keyed by userId)
const conversationHistories = new Map();

function getHistory(userId) {
  if (!conversationHistories.has(userId)) {
    conversationHistories.set(userId, []);
  }
  return conversationHistories.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  // Keep last 20 messages
  if (history.length > 20) {
    conversationHistories.set(userId, history.slice(-20));
  }
}

async function handleMessage(userId, text) {
  const history = getHistory(userId);

  addToHistory(userId, 'user', text);
  const result = await processMessage(text, history);
  let reply;

  switch (result.action) {
    case 'add_schedule': {
      await schedule.addSchedule(result.datetime, result.title);
      reply = result.reply;
      break;
    }
    case 'list_schedule': {
      const items = await schedule.listSchedules(result.range);
      const list = schedule.formatScheduleList(items);
      reply = `${result.reply}\n\n${list}`;
      break;
    }
    case 'delete_schedule': {
      const removed = await schedule.deleteSchedule(result.query);
      reply = removed
        ? result.reply
        : '該当する予定が見つかりませんでした。';
      break;
    }
    case 'add_task': {
      await tasks.addTask(result.title);
      reply = result.reply;
      break;
    }
    case 'list_tasks': {
      const allTasks = await tasks.listTasks();
      const list = tasks.formatTaskList(allTasks);
      reply = `${result.reply}\n\n${list}`;
      break;
    }
    case 'complete_task': {
      const completed = await tasks.completeTask(result.index);
      reply = completed
        ? result.reply
        : '該当するタスクが見つかりませんでした。';
      break;
    }
    case 'delete_task': {
      const deleted = await tasks.deleteTask(result.index);
      reply = deleted
        ? result.reply
        : '該当するタスクが見つかりませんでした。';
      break;
    }
    case 'chat':
    default:
      reply = result.reply;
      break;
  }

  addToHistory(userId, 'assistant', reply);
  return reply;
}

module.exports = { handleMessage };
