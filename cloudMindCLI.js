// cloudmind-cli.js
// Version: 0.1
// CLI command layer for interacting with CloudMind server

const readline = require('readline');
const axios = require('axios');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '🤖 CloudMind> '
});

const SERVER = 'http://localhost:3000';
const TRANSLATOR_NODE = 'core:trn:main';

const commands = {
  help: () => {
    console.log(`\nAvailable Commands:
  start -a       => Enables autonomous mode
  start -m          => Disables autonomous mode
  status                   => Show current system status
  halt -a                  => Alias for manual mode
  send -f [file] -n [node] => Send JSON file to node
  chat                     => Open translator chat
  help                     => Show this menu\n`);
  },

  async status() {
    try {
      const res = await axios.get(`${SERVER}`);
      console.log(`\nCloudMind Status:`);
      console.table(res.data);
    } catch (err) {
      console.error('Failed to fetch status.');
    }
  },

  async setAutonomy(state) {
    try {
      const res = await axios.post(`${SERVER}/autonomous-mode`, { enabled: state });
      console.log(`\n[MODE] Autonomous mode ${state ? 'ENABLED' : 'DISABLED'}`);
    } catch (err) {
      console.error('Failed to toggle autonomy mode.');
    }
  },

  async sendFile(file, node) {
    try {
      const data = fs.readFileSync(file, 'utf8');
      await axios.post(`${SERVER}/node-communicate`, {
        prompt: data,
        node_id: node
      });
      console.log(`\n[SENT] File ${file} sent to ${node}`);
    } catch (err) {
      console.error('Failed to send file:', err.message);
    }
  },

  async chatWithTranslator() {
    const askInput = () => {
      rl.question('\nYou> ', async (input) => {
        if (input === 'exit' || input === 'quit') return rl.prompt();

        try {
          const response = await axios.post(`${SERVER}/node-communicate`, {
            prompt: input,
            node_id: TRANSLATOR_NODE
          });
          console.log(`\nTranslator> ${response.data.response}`);
        } catch (err) {
          console.error('Translator error:', err.message);
        }

        askInput();
      });
    };

    console.log('\n🗣️  Entering Translator Chat (type "exit" to return)');
    askInput();
  }
};

rl.prompt();

rl.on('line', async (line) => {
  const trimmed = line.trim();

  if (trimmed === 'help') return commands.help();
  if (trimmed === 'status') return commands.status();
  if (trimmed === 'start -a') return commands.setAutonomy(true);
  if (trimmed === 'start -m' || trimmed === 'halt -a') return commands.setAutonomy(false);
  if (trimmed === 'chat') return commands.chatWithTranslator();

  const sendMatch = trimmed.match(/send -f (.+) -n (.+)/);
  if (sendMatch) {
    const [_, file, node] = sendMatch;
    return commands.sendFile(file, node);
  }

  console.log(`Unrecognized command. Type 'help' to see available commands.`);
  rl.prompt();
});
