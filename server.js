const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files
function initDataFiles() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(REPORTS_FILE)) {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2));
  }
}

initDataFiles();

// Helper functions
function readUsers() {
  const data = fs.readFileSync(USERS_FILE, 'utf-8');
  return JSON.parse(data);
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readReports() {
  const data = fs.readFileSync(REPORTS_FILE, 'utf-8');
  return JSON.parse(data);
}

function writeReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2));
}

// ========== User API ==========

// Get all users
app.get('/api/users', (req, res) => {
  const users = readUsers();
  res.json(users);
});

// Create new user
app.post('/api/users', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: '名前とメールアドレスは必須です' });
  }

  const users = readUsers();

  // Check for duplicate email
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
  }

  // Check max users (10 for small teams)
  if (users.length >= 10) {
    return res.status(400).json({ error: 'チームメンバーは最大10名までです' });
  }

  const newUser = {
    id: uuidv4(),
    name,
    email,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

  res.status(201).json(newUser);
});

// Delete user
app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  let users = readUsers();

  const userIndex = users.findIndex(u => u.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  users = users.filter(u => u.id !== id);
  writeUsers(users);

  // Also delete user's reports
  let reports = readReports();
  reports = reports.filter(r => r.userId !== id);
  writeReports(reports);

  res.json({ message: 'ユーザーを削除しました' });
});

// ========== Report API ==========

// Get all reports (with optional filters)
app.get('/api/reports', (req, res) => {
  const { userId, date, startDate, endDate } = req.query;
  let reports = readReports();
  const users = readUsers();

  // Filter by userId
  if (userId) {
    reports = reports.filter(r => r.userId === userId);
  }

  // Filter by specific date
  if (date) {
    reports = reports.filter(r => r.date === date);
  }

  // Filter by date range
  if (startDate && endDate) {
    reports = reports.filter(r => r.date >= startDate && r.date <= endDate);
  }

  // Add user info to each report
  reports = reports.map(r => ({
    ...r,
    user: users.find(u => u.id === r.userId) || { name: '不明なユーザー' }
  }));

  // Sort by date (newest first) and then by creation time
  reports.sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  res.json(reports);
});

// Get single report
app.get('/api/reports/:id', (req, res) => {
  const { id } = req.params;
  const reports = readReports();
  const users = readUsers();

  const report = reports.find(r => r.id === id);
  if (!report) {
    return res.status(404).json({ error: '日報が見つかりません' });
  }

  res.json({
    ...report,
    user: users.find(u => u.id === report.userId) || { name: '不明なユーザー' }
  });
});

// Create new report
app.post('/api/reports', (req, res) => {
  const { userId, date, todayWork, tomorrowPlan, issues, memo } = req.body;

  if (!userId || !date || !todayWork) {
    return res.status(400).json({ error: 'ユーザー、日付、今日の作業内容は必須です' });
  }

  const users = readUsers();
  if (!users.find(u => u.id === userId)) {
    return res.status(400).json({ error: 'ユーザーが見つかりません' });
  }

  const reports = readReports();

  // Check if report already exists for this user and date
  const existingReport = reports.find(r => r.userId === userId && r.date === date);
  if (existingReport) {
    return res.status(400).json({ error: 'この日の日報は既に提出されています。編集してください。' });
  }

  const newReport = {
    id: uuidv4(),
    userId,
    date,
    todayWork,
    tomorrowPlan: tomorrowPlan || '',
    issues: issues || '',
    memo: memo || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  reports.push(newReport);
  writeReports(reports);

  res.status(201).json(newReport);
});

// Update report
app.put('/api/reports/:id', (req, res) => {
  const { id } = req.params;
  const { todayWork, tomorrowPlan, issues, memo } = req.body;

  const reports = readReports();
  const reportIndex = reports.findIndex(r => r.id === id);

  if (reportIndex === -1) {
    return res.status(404).json({ error: '日報が見つかりません' });
  }

  reports[reportIndex] = {
    ...reports[reportIndex],
    todayWork: todayWork !== undefined ? todayWork : reports[reportIndex].todayWork,
    tomorrowPlan: tomorrowPlan !== undefined ? tomorrowPlan : reports[reportIndex].tomorrowPlan,
    issues: issues !== undefined ? issues : reports[reportIndex].issues,
    memo: memo !== undefined ? memo : reports[reportIndex].memo,
    updatedAt: new Date().toISOString()
  };

  writeReports(reports);
  res.json(reports[reportIndex]);
});

// Delete report
app.delete('/api/reports/:id', (req, res) => {
  const { id } = req.params;
  let reports = readReports();

  const reportIndex = reports.findIndex(r => r.id === id);
  if (reportIndex === -1) {
    return res.status(404).json({ error: '日報が見つかりません' });
  }

  reports = reports.filter(r => r.id !== id);
  writeReports(reports);

  res.json({ message: '日報を削除しました' });
});

// ========== Stats API ==========

// Get submission stats
app.get('/api/stats', (req, res) => {
  const { date } = req.query;
  const users = readUsers();
  const reports = readReports();

  const targetDate = date || new Date().toISOString().split('T')[0];

  const todayReports = reports.filter(r => r.date === targetDate);
  const submittedUserIds = todayReports.map(r => r.userId);

  const stats = {
    date: targetDate,
    totalUsers: users.length,
    submitted: todayReports.length,
    notSubmitted: users.length - todayReports.length,
    submittedUsers: users.filter(u => submittedUserIds.includes(u.id)),
    notSubmittedUsers: users.filter(u => !submittedUserIds.includes(u.id))
  };

  res.json(stats);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '日報アプリは正常に動作しています' });
});

app.listen(PORT, () => {
  console.log(`日報アプリが起動しました: http://localhost:${PORT}`);
});
