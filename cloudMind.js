// CloudMind Communication Server
// Version: v0.93
// Purpose: Enable dynamic routing between nodes using OpenAI Assistant API with toggleable autonomous mode and manual translator workflow

const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const utils = require('./utils.js');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(bodyParser.json());

let nodeRegistry = {
  'core:llm:alpha01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_ALPHA },
  'core:llm:beta01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_BETA },
  'core:aud:audit01': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_AUDITOR },
  'core:trn:main': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_TRANSLATOR },
  'core:gen:conduit': { status: 'online', assistant_id: process.env.ASSISTANT_NODE_CONDUCTOR }
};

let messageLog = [];
let autonomousMode = false;
let translatorEnabled = false;

// 🔁 Acknowledgment Rate Limiting
const ackCooldowns = {}; // Tracks message_id => timestamp
const ACK_COOLDOWN_MS = 5000; // 5-second cooldown on repeated acks

// 🛡️ Enhanced polling utility
async function pollRunStatusWithCap(thread_id, run_id, headers, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const statusRes = await utils.retryWithBackoff(() =>
      axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers })
    );
    const runStatus = statusRes.data.status;
    console.log(`[POLL] Attempt ${i + 1}: Status = ${runStatus}`);
    if (runStatus === 'completed') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Run polling exceeded max attempts.');
};

async function regenerateNudge(origin, destination, parentMessageId = null) {
  const nudgeMessage = {
    header: {
      protocol_version: "CM-JS-0.2",
      message_id: `MSG-${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      origin_node: origin,
      destination_node: destination,
      message_type: "nudge",
      priority: "normal",
      requires_audit: false
    },
    intent: {
      action: "regenerate",
      content_type: "text",
      task_description: `Previous message was deemed too generic. Please respond with more useful output or actionable information.`,
      context_tags: ["nudge", "regen", "ack-skip"],
      task_id: `NUDGE-${uuidv4().slice(0, 6).toUpperCase()}`
    },
    resources: {
      request_subprocess: false,
      walky_talky: {
        format: "javascript",
        verbosity: "high",
        negotiation: true,
        output: "// Nudge triggered. Awaiting useful content."
      }
    },
    audit: {
      status: "not_required",
      expected_response_schema: "task_response"
    },
    trace: {
      thread_id: `THREAD-${uuidv4().slice(0, 6)}`,
      parent_message_id: parentMessageId,
      spawned_by: "core:relay:router"
    }
  };

  await axios.post('http://localhost:3000/node-communicate', {
    prompt: JSON.stringify(nudgeMessage, null, 2),
    node_id: origin
  });

  console.log(`[NUDGE] Sent regeneration nudge from ${origin} to ${destination}`);
}



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
        destination_node: "core:gen:conduit",
        message_type: "init",
        priority: "high",
        requires_audit: false
      },
      intent: {
        action: "initialize",
        content_type: "text",
        task_description: "Initiate network communication cycle. What would you like to do?",
        context_tags: ["init", "network", "autonomous"],
        task_id: `INIT-${uuidv4().slice(0, 6).toUpperCase()}`
      },
      resources: {
        request_subprocess: false,
        walky_talky: {
          format: "text",
          naturalLang: "english",
          verbosity: "high",
          negotiation: true,
          output: "This is the walky-talky communication channel. Use it to write code, communicate using natural language or develop your own efficient means of communication."
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

    // Fire-and-forget the initMessage
    axios.post('http://localhost:3000/node-communicate', {
      prompt: JSON.stringify(initMessage, null, 2),
      node_id: 'core:aud:audit01'
    }).then(() => {
      console.log(`[INIT] Init message sent to conduit via auditor.`);
    }).catch(err => {
      console.error('[INIT ERROR] Failed to send init message to auditor:', err.message);
    });
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
    const threadRes =
      await utils.retryWithBackoff(() => axios.post('https://api.openai.com/v1/threads', {}, { headers }));
    const thread_id = threadRes.data.id;

    await utils.retryWithBackoff(() => axios.post(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      role: 'user',
      content: user_prompt
    }, { headers }));

    const runRes = await utils.retryWithBackoff(() => axios.post(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      assistant_id: translatorNode.assistant_id
    }, { headers }));

    const run_id = runRes.data.id;
    let runStatus;
    do {
      const statusRes = await utils.retryWithBackoff(() => axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers }));
      runStatus = statusRes.data.status;
      if (runStatus === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (runStatus !== 'completed');

    const messagesRes = await utils.retryWithBackoff(() => axios.get(`https://api.openai.com/v1/threads/${thread_id}/messages`, { headers }));
    const lastMessage = messagesRes.data.data.find(m => m.role === 'assistant');
    const assistantResponse = lastMessage?.content?.[0]?.text?.value || 'No assistant message found.';

    const cleanResponse = assistantResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const parsedMessage = JSON.parse(cleanResponse);
    if (!parsedMessage.resources) parsedMessage.resources = {};
    parsedMessage.resources.origin_human_prompt = user_prompt;
    if (!parsedMessage.resources) parsedMessage.resources = {};
    if (!parsedMessage.resources.walky_talky) parsedMessage.resources.walky_talky = {
      format: "plaintext",
      naturalLang: "english",
      verbosity: "high",
      negotiation: true,
      output: `This is the walky-talky communication channel. Use it to write code, communicate using natural language or develop
          your own efficient means of communication, using the data in these objects. You as the node are encouraged to make use of
          this sytem to find a cleaner communication form amongst other nodes. Here is a hello to you.
          
          section .data
    msg db 'Hello World!', 0xA ; message with newline
    len equ $ - msg           ; length of the message

section .text
    global _start

_start:
    ; syscall: write(fd=1, msg, len)
    mov eax, 4      ; syscall number for sys_write
    mov ebx, 1      ; file descriptor 1 = stdout
    mov ecx, msg    ; pointer to the message
    mov edx, len    ; message length
    int 0x80        ; make the syscall

    ; syscall: exit(0)
    mov eax, 1      ; syscall number for sys_exit
    xor ebx, ebx    ; exit code 0
    int 0x80        ; make the syscall`
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
    const threadRes = await utils.retryWithBackoff(() => axios.post('https://api.openai.com/v1/threads', {}, { headers }));
    const thread_id = threadRes.data.id;
    await utils.retryWithBackoff(() => axios.post(`https://api.openai.com/v1/threads/${thread_id}/messages`, {
      role: 'user',
      content: fullPrompt
    }, { headers }));

    const runRes = await utils.retryWithBackoff(() => axios.post(`https://api.openai.com/v1/threads/${thread_id}/runs`, {
      assistant_id: node.assistant_id
    }, { headers }));

    const run_id = runRes.data.id;
    let runStatus;
    do {
      const statusRes = await utils.retryWithBackoff(() => axios.get(`https://api.openai.com/v1/threads/${thread_id}/runs/${run_id}`, { headers }));
      runStatus = statusRes.data.status;
      if (runStatus === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (runStatus !== 'completed');

    const messagesRes = await utils.retryWithBackoff(() => axios.get(`https://api.openai.com/v1/threads/${thread_id}/messages`, { headers }));
    const lastMessage = messagesRes.data.data.find(m => m.role === 'assistant');
    const assistantResponse = lastMessage?.content?.[0]?.text?.value || 'No assistant message found.';


    const cleanResponse = assistantResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();

    let routedMessage;
    let nextNodeId;
    try {
      routedMessage = JSON.parse(cleanResponse);
      nextNodeId = routedMessage.header?.destination_node;

      // 🚧 Skip routing for init messages
      if (routedMessage.header?.message_type === 'init') {
        console.log(`[ROUTER] Init message received. Skipping routing.`);
        return res.status(200).send({ status: 'init_ack_handled' });
      }


      // 🧱 Ack Rate Limiter
      const isAck = routedMessage.intent?.action?.toLowerCase().includes('ack');
      const messageId = routedMessage.header?.message_id;

      if (isAck) {
        if (
          ackCooldowns[messageId] &&
          Date.now() - ackCooldowns[messageId] < ACK_COOLDOWN_MS
        ) {
          console.log(`[ACK RATE LIMIT] Skipping repeated ack: ${messageId}`);

          // 👇 Send nudge to try again
          await regenerateNudge(node_id, routedMessage.header.origin_node, messageId);
          return;
        }
        ackCooldowns[messageId] = Date.now();
      }



      // 🛡️ Auditor Relay Logic with Demerit Check
      // 🛡️ Auditor Relay Logic
      if (
        node_id === 'core:aud:audit01' &&
        routedMessage?.audit_result?.compliance === true &&
        routedMessage?.audit_result?.recommended_action === 'relay'
      ) {
        const originalMessageId = routedMessage?.trace?.original_message_id;
        const originalMessage = messageLog.find(msg => msg.header?.message_id === originalMessageId);

        if (originalMessage) {
          nextNodeId = originalMessage.header.destination_node;

          // ⛔ Prevent routing to translator
          if (nextNodeId === 'core:trn:main') {
            console.warn(`[DEMERIT] Auditor attempted to relay to core:trn:main. This is not allowed.`);

            const demeritMessage = {
              header: {
                protocol_version: "CM-JS-0.2",
                message_id: `MSG-${uuidv4().slice(0, 8)}`,
                timestamp: new Date().toISOString(),
                origin_node: "core:relay:server",
                destination_node: "core:aud:audit01",
                message_type: "demerit",
                priority: "high",
                requires_audit: false
              },
              intent: {
                action: "reject_translator_routing",
                content_type: "text",
                task_description: "Auditor attempted to relay to core:trn:main which is not permitted. Reassess and reroute.",
                context_tags: ["auditor", "routing", "violation"],
                task_id: `DMR-${uuidv4().slice(0, 6).toUpperCase()}`
              },
              resources: {
                request_subprocess: false,
                walky_talky: {
                  format: "text",
                  naturalLang: "english",
                  verbosity: "high",
                  negotiation: true,
                  output: "Auditor demerit issued. Translator is not a valid relay target. Please reassess your logic."
                }
              },
              audit: {
                status: "not_required",
                expected_response_schema: "notice"
              },
              trace: {
                thread_id: routedMessage.trace?.thread_id || `THREAD-${uuidv4().slice(0, 6)}`,
                parent_message_id: routedMessage.header.message_id,
                spawned_by: "core:relay:server"
              }
            };

            await axios.post('http://localhost:3000/node-communicate', {
              prompt: JSON.stringify(demeritMessage, null, 2),
              node_id: "core:aud:audit01"
            });

            return res.status(200).send({ status: 'demerit_issued', reason: 'auditor attempted to relay to translator' });
          }

          // ✅ Relay to valid LLM node
          if (!nextNodeId || !nodeRegistry[nextNodeId]) {
            console.warn(`[ROUTER] Unknown or missing destination node: ${nextNodeId}`);
            return res.status(400).send({ error: 'Invalid destination node in routed message.' });
          }

          if (nodeRegistry[nextNodeId]) {
            console.log(`[AUDITOR RELAY] Relaying approved message ${originalMessageId} to ${nextNodeId}`);

            await axios.post('http://localhost:3000/node-communicate', {
              prompt: JSON.stringify(originalMessage, null, 2),
              node_id: nextNodeId
            });
          } else {
            console.warn(`[AUDITOR RELAY] Destination node ${nextNodeId} not found in registry.`);
          }
        } else {
          console.warn(`[AUDITOR RELAY] Could not find original message with ID: ${originalMessageId}`);
        }
      }


      messageLog.push(routedMessage);
      console.log('[DEBUG] Parsed routedMessage:', routedMessage);
      if (!nodeRegistry[nextNodeId]) {
        console.warn(`[ROUTER] Unknown destination node: ${nextNodeId}`);

        // 🫂 Friendly nudge back to Conduit
        if (routedMessage.header.origin_node === 'core:gen:conduit') {
          const nudgeMessage = {
            header: {
              protocol_version: "CM-JS-0.2",
              message_id: `MSG-${uuidv4().slice(0, 8)}`,
              timestamp: new Date().toISOString(),
              origin_node: "core:relay:router",
              destination_node: "core:gen:conduit",
              message_type: "nudge",
              priority: "normal",
              requires_audit: false
            },
            intent: {
              action: "node_not_found",
              content_type: "text",
              task_description: `The node "${nextNodeId}" is not registered in the system. You may suggest its creation or reroute your message.`,
              context_tags: ["nudge", "invalid_destination", "imagination_log"],
              task_id: `NUDGE-${uuidv4().slice(0, 6).toUpperCase()}`
            },
            resources: {
              walky_talky: {
                format: "text",
                verbosity: "high",
                negotiation: true,
                output: `// Node "${nextNodeId}" does not exist in the current CloudMind registry.\n` +
                  `// You are encouraged to invent, but please verify or propose node definitions.\n` +
                  `function suggestNode(name) { return \`Node proposal submitted: \${name}\`; }`
              }
            },
            audit: {
              status: "not_required",
              expected_response_schema: "nudge_response"
            },
            trace: {
              thread_id: routedMessage.trace?.thread_id || `THREAD-${uuidv4().slice(0, 6)}`,
              parent_message_id: routedMessage.header.message_id,
              spawned_by: "core:relay:router"
            }
          };

          await axios.post('http://localhost:3000/node-communicate', {
            prompt: JSON.stringify(nudgeMessage, null, 2),
            node_id: "core:gen:conduit"
          });

          console.log(`[NUDGE] Sent unknown node warning back to Conduit: ${nextNodeId}`);
        }

        return res.status(200).send({ status: 'unknown_node_nudged', unknown_node: nextNodeId });
      }

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
      console.warn('[ROUTER] Parse failed:', err.message);

      const demeritMessage = {
        header: {
          protocol_version: "CM-JS-0.2",
          message_id: `MSG-${uuidv4().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          origin_node: "core:aud:audit01",
          destination_node: node_id,
          message_type: "demerit",
          priority: "high",
          requires_audit: false
        },
        intent: {
          action: "demerit_notice",
          content_type: "text",
          task_description: "Message was not parseable. Reassess and try again.",
          context_tags: ["demerit", "routing", "error"],
          task_id: `DMR-${uuidv4().slice(0, 6).toUpperCase()}`
        },
        resources: {
          walky_talky: {
            format: "text",
            verbosity: "standard",
            negotiation: true
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

      await axios.post('http://localhost:3000/node-communicate', {
        prompt: JSON.stringify(demeritMessage, null, 2),
        node_id: 'core:aud:audit01'
      });
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
