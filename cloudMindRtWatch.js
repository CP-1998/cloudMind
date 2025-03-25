// cloudmind-router-watch.js
// Live router log monitor for CloudMind

const axios = require('axios');
const SERVER = 'http://localhost:3000';
let lastSeen = 0;

console.clear();
console.log('\u001b[36m\u001b[1m🧠 CLOUDMIND ROUTER WATCH MODE\u001b[0m');
console.log('\u001b[90mListening for node activity... (Ctrl+C to exit)\u001b[0m');

async function pollMessages() {
  try {
    const res = await axios.get(`${SERVER}/messages`);
    const messages = res.data;

    const newMessages = messages.slice(lastSeen);
    newMessages.forEach((msg, index) => {
      const header = msg.header || {};
      const from = header.origin_node || 'unknown';
      const to = header.destination_node || 'unknown';
      const type = header.message_type || 'unknown';
      const id = header.message_id || '???';

      if (from === 'human') {
        console.log(
          `\u001b[34m[${id}]\u001b[0m \u001b[36m${from}\u001b[0m 💬 \u001b[32m${to}\u001b[0m \u001b[90m(${type})\u001b[0m`
        );
      } else if (to === 'human') {
        console.log(
          `\u001b[33m[${id}]\u001b[0m \u001b[32m${from}\u001b[0m 📨 \u001b[36m${to}\u001b[0m \u001b[90m(${type})\u001b[0m`
        );
      } else {
        console.log(
          `\u001b[33m[${id}]\u001b[0m \u001b[32m${from}\u001b[0m ➡ \u001b[35m${to}\u001b[0m \u001b[90m(${type})\u001b[0m`
        );
      }
    });

    lastSeen = messages.length;
  } catch (err) {
    console.error('\u001b[31m[ERROR] Could not fetch messages\u001b[0m', err.message);
  }
}

setInterval(pollMessages, 1500);