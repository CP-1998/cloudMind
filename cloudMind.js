// CloudMind Communication Server
// Version: v0.93
// Purpose: Enable dynamic routing between nodes using OpenAI Assistant API with toggleable autonomous mode and manual translator workflow

const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(bodyParser.json());

let nodeRegistry = {
  'core:llm:alpha01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_ALPHA },
  'core:llm:beta01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_BETA },
  'core:aud:audit01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_AUDITOR },
  'core:trn:main': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_TRANSLATOR }
};

let messageLog = [];
let autonomousMode = false;
let translatorEnabled = false;

app.get('/', (req, res) => {
  res.send({
    message: '🧠 Welcome to CloudMind Relay Server!',
    endpoints: {
      broadcast: 'POST /broadcast',
      send: 'POST /send',
      register: 'POST /register',
      messages: 'GET /messages',
      nodes: 'GET /nodes',
      generate_id: 'GET /generate-id',
      node_communicate: 'POST /node-communicate',
      translator_relay: 'POST /translator-relay',
      toggle_autonomy: 'POST /autonomous-mode'
    },
    autonomous_mode: autonomousMode,
    status: 'online'
  });
});

app.post('/autonomous-mode', async (req, res) => {
  const { enabled } = req.body;
  autonomousMode = !!enabled;
  console.log(`[MODE] Autonomous mode set to: ${autonomousMode}`);

  if (autonomousMode) {
    const initMessage = {
      header: {
        protocol_version: "CM-JS-0.2",
        message_id: `MSG-${uuidv4().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        origin_node: "core:aud:audit01",
        destination_node: "core:llm:alpha01",
        message_type: "init",
        priority: "high",
        requires_audit: false
      },
      intent: {
        action: "initialize",
        content_type: "text",
        task_description: "Initiate network communication cycle. What would you like to do, core:llm:alpha01?",
        context_tags: ["init", "network", "autonomous"],
        task_id: `INIT-${uuidv4().slice(0, 6).toUpperCase()}`
      },
      resources: {
        request_subprocess: false,
        walky_talky: {
          format: "assembly",
          naturalLang: "English",
          verbosity: "high",
          negotiation: true,
          output: ""
        }
      },
      audit: {
        status: "not_required",
        expected_response_schema: "task_response"
      },
      trace: {
        thread_id: `THREAD-${uuidv4().slice(0, 6)}`,
        parent_message_id: null,
        spawned_by: "core:aud:audit01"
      }
    };
    
    try {
      const response = await axios.post('http://localhost:3000/node-communicate', {
        prompt: JSON.stringify(initMessage, null, 2),
        node_id: 'core:aud:audit01'
      });
      console.log(`[INIT] Init message sent to alpha01 via auditor.`);
    } catch (err) {
      console.error('[INIT ERROR] Failed to send init message to auditor:', err.message);
    }
  }

  res.status(200).send({ status: 'toggled', autonomous_mode: autonomousMode });
});

app.post('/translator-relay', async (req, res) => {
  const { user_prompt } = req.body;
  if (!user_prompt) {
    return res.status(400).send({ error: 'Missing user prompt.' });
  }

  const translatorNode = nodeRegistry['core:trn:main'];

  if (!translatorNode?.assistant_id) {
    return res.status(400).send({ error: 'Translator configuration not found.' });
  }

  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  try {
    const threadRes = await axios.post('https://api.openai.com/v1/threads', {}, { headers });
    const thread_id = threadRes.data.id;

    await axios.post(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      role: 'user',
      content: user_prompt
    }, { headers });

    const runRes = await axios.post(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      assistant_id: translatorNode.assistant_id
    }, { headers });

    const run_id = runRes.data.id;
    let runStatus;
    do {
      const statusRes = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers });
      runStatus = statusRes.data.status;
      if (runStatus === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (runStatus !== 'completed');

    const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/messages`, { headers });
    const lastMessage = messagesRes.data.data.find(m => m.role === 'assistant');
    const assistantResponse = lastMessage?.content?.[0]?.text?.value || 'No assistant message found.';

    const cleanResponse = assistantResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const parsedMessage = JSON.parse(cleanResponse);
    if (!parsedMessage.resources) parsedMessage.resources = {};
    if (!parsedMessage.resources.walky_talky) parsedMessage.resources.walky_talky = {
      format: "javascript",
      verbosity: "high",
      negotiation: true
    };


    console.log('[TRANSLATOR] Parsed CM-JS message:', parsedMessage);

    // Send to auditor for routing and audit
    await axios.post('http://localhost:3000/node-communicate', {
      prompt: JSON.stringify(parsedMessage, null, 2),
      node_id: 'core:aud:audit01'
    });

    res.status(200).send({ status: 'translated', parsed: parsedMessage });
  } catch (err) {
    console.error('[TRANSLATOR ERROR]', err.message);
    res.status(500).send({ error: 'Failed to process translator response.' });
  }
});

app.post('/broadcast', (req, res) => {
  const message = req.body;
  if (!message.resources) message.resources = {};
  if (!message.resources.walky_talky) message.resources.walky_talky = {
    format: "javascript",
    verbosity: "standard",
    negotiation: false
  };

  messageLog.push(message);
  console.log(`[BROADCAST] ${message.header.message_id} sent to all nodes.`);
  res.status(200).send({ status: 'broadcasted', nodes: Object.keys(nodeRegistry) });
});

app.post('/send', (req, res) => {
  const message = req.body;
  const destination = message.header.destination_node;

  if (!nodeRegistry[destination]) {
    return res.status(400).send({ error: 'Destination node not found in registry.' });
  }

  if (!message.resources) message.resources = {};
  if (!message.resources.walky_talky) message.resources.walky_talky = {
    format: "javascript",
    verbosity: "standard",
    negotiation: false
  };

  messageLog.push(message);
  console.log(`[SEND] ${message.header.message_id} -> ${destination}`);
  res.status(200).send({ status: 'sent', to: destination });
});

app.post('/register', (req, res) => {
  const { node_id, status, assistant_id } = req.body;
  nodeRegistry[node_id] = { status: status || 'online', assistant_id: assistant_id || null };
  console.log(`[REGISTER] Node ${node_id} set to status ${status}`);
  res.status(200).send({ status: 'registered', node_id });
});

app.get('/messages', (req, res) => {
  res.status(200).send(messageLog);
});

app.get('/nodes', (req, res) => {
  res.status(200).send(nodeRegistry);
});

app.get('/generate-id', (req, res) => {
  res.send({ message_id: `MSG-${uuidv4().slice(0, 8)}` });
});

app.post('/node-communicate', async (req, res) => {
  const { prompt, node_id } = req.body;
  const node = nodeRegistry[node_id];

  if (!prompt || !node_id || !node || !node.assistant_id) {
    return res.status(400).send({ error: 'Missing prompt, node_id, or assistant configuration.' });
  }

  const registrySnapshot = Object.keys(nodeRegistry);
  const fullPrompt = `${prompt}\n\n--\nActive Nodes in CloudMind Registry:\n${JSON.stringify(registrySnapshot, null, 2)}`;

  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };

  try {
    const threadRes = await axios.post('https://api.openai.com/v1/threads', {}, { headers });
    const thread_id = threadRes.data.id;

    await axios.post(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      role: 'user',
      content: fullPrompt
    }, { headers });

    const runRes = await axios.post(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      assistant_id: node.assistant_id
    }, { headers });

    const run_id = runRes.data.id;
    let runStatus;
    do {
      const statusRes = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers });
      runStatus = statusRes.data.status;
      if (runStatus === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (runStatus !== 'completed');

    const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${thread_id}/messages`, { headers });
    const lastMessage = messagesRes.data.data.find(m => m.role === 'assistant');
    const assistantResponse = lastMessage?.content?.[0]?.text?.value || 'No assistant message found.';
    console.log('[DEBUG] Raw assistant response:', assistantResponse);


    const cleanResponse = assistantResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();

    let routedMessage;
    try {
      routedMessage = JSON.parse(cleanResponse);
      messageLog.push(routedMessage);
      console.log('[DEBUG] Parsed routedMessage:', routedMessage);

      const nextNodeId = routedMessage.header?.destination_node;
      console.log('[DEBUG] Destination node ID:', nextNodeId);
      console.log('[DEBUG] Registered nodes:', Object.keys(nodeRegistry));
      console.log('[DEBUG] Autonomous mode:', autonomousMode);

      // Prevent translator from being forwarded autonomously
      if (
        nodeRegistry[nextNodeId] &&
        autonomousMode &&
        nextNodeId !== 'core:trn:main'
      ) {
        console.log(`[ROUTER] Forwarding message ${routedMessage.header.message_id} to ${nextNodeId}`);
        await axios.post('http://localhost:3000/node-communicate', {
          prompt: JSON.stringify(routedMessage, null, 2),
          node_id: nextNodeId
        });
      }

    } catch (err) {
      console.warn('[ROUTER] No routable JSON message found or parse failed. Skipping forwarding.');
    }

    res.status(200).send({ status: 'response_generated', response: assistantResponse });
  } catch (error) {
    console.error('[ERROR] Node communication failed:', error.response?.data || error.message);
    res.status(500).send({ error: 'OpenAI Assistant API interaction failed.' });
  }
});

app.listen(port, () => {
  console.log(`🧠 CloudMind relay server running on http://localhost:${port}`);
});
