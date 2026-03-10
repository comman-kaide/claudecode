const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'schedules.json');

async function loadSchedules() {
  await fs.ensureFile(DATA_FILE);
  try {
    const data = await fs.readJson(DATA_FILE);
    return data;
  } catch {
    return [];
  }
}

async function saveSchedules(schedules) {
  await fs.ensureDir(path.dirname(DATA_FILE));
  await fs.writeJson(DATA_FILE, schedules, { spaces: 2 });
}

async function addSchedule(datetime, title) {
  const schedules = await loadSchedules();
  const entry = {
    id: Date.now(),
    datetime,
    title,
    createdAt: new Date().toISOString(),
  };
  schedules.push(entry);
  schedules.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  await saveSchedules(schedules);
  return entry;
}

async function listSchedules(range = 'today') {
  const schedules = await loadSchedules();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let endDate;
  switch (range) {
    case 'today':
      endDate = new Date(startOfDay);
      endDate.setDate(endDate.getDate() + 1);
      break;
    case 'week':
      endDate = new Date(startOfDay);
      endDate.setDate(endDate.getDate() + 7);
      break;
    case 'month':
      endDate = new Date(startOfDay);
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    default:
      endDate = new Date(startOfDay);
      endDate.setDate(endDate.getDate() + 1);
  }

  return schedules.filter((s) => {
    const d = new Date(s.datetime);
    return d >= startOfDay && d < endDate;
  });
}

async function deleteSchedule(query) {
  const schedules = await loadSchedules();
  const index = schedules.findIndex(
    (s) => s.title.includes(query) || s.id.toString() === query
  );
  if (index === -1) return null;
  const removed = schedules.splice(index, 1)[0];
  await saveSchedules(schedules);
  return removed;
}

function formatSchedule(schedule) {
  const dt = new Date(schedule.datetime);
  const dateStr = `${dt.getMonth() + 1}/${dt.getDate()}`;
  const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `📅 ${dateStr} ${timeStr} - ${schedule.title}`;
}

function formatScheduleList(schedules) {
  if (schedules.length === 0) return '予定はありません。';
  return schedules.map(formatSchedule).join('\n');
}

module.exports = {
  addSchedule,
  listSchedules,
  deleteSchedule,
  formatScheduleList,
};
