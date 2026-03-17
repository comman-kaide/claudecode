const { App } = require('@slack/bolt');
const { handleMessage } = require('./agent');

let slackApp = null;

function createSlackApp() {
  slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
  });

  // Handle direct messages
  slackApp.message(async ({ message, say }) => {
    if (message.subtype) return; // Ignore bot messages, edits, etc.
    if (!message.text) return; // Ignore file uploads, reactions, etc.

    try {
      const userId = message.user;
      const reply = await handleMessage(userId, message.text);
      await say(reply);
    } catch (error) {
      console.error('Slack message error:', error);
      await say('申し訳ありません、エラーが発生しました。もう一度お試しください。');
    }
  });

  // Handle app mentions in channels
  slackApp.event('app_mention', async ({ event, say }) => {
    try {
      const userId = event.user;
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) {
        await say('はい、何かご用ですか？予定の確認、タスク管理、なんでもお聞きください！');
        return;
      }
      const reply = await handleMessage(userId, text);
      await say(reply);
    } catch (error) {
      console.error('Slack mention error:', error);
      await say('申し訳ありません、エラーが発生しました。');
    }
  });

  // Handle /secretary slash command
  slackApp.command('/secretary', async ({ command, ack, respond }) => {
    await ack();
    try {
      const userId = command.user_id;
      if (!command.text) {
        await respond('はい、何かご用ですか？予定の確認、タスク管理、なんでもお聞きください！');
        return;
      }
      const reply = await handleMessage(userId, command.text);
      await respond(reply);
    } catch (error) {
      console.error('Slack command error:', error);
      await respond('申し訳ありません、エラーが発生しました。');
    }
  });

  return slackApp;
}

async function startSlackBot() {
  if (
    !process.env.SLACK_BOT_TOKEN ||
    !process.env.SLACK_SIGNING_SECRET ||
    !process.env.SLACK_APP_TOKEN
  ) {
    console.log('Slack credentials not configured. Slack bot will not start.');
    console.log('Set SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN to enable.');
    return null;
  }

  const app = createSlackApp();
  await app.start();
  console.log('⚡ Slack bot is running in Socket Mode!');
  return app;
}

module.exports = { startSlackBot };
