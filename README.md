# CloudMind Communication Server

> Version: **v0.93**\
> Author: *Christian Parks*\
> Purpose: A modular LLM relay system for coordinating multi-agent communication, with autonomous and manual workflows.

---

## Overview

CloudMind is a **modular relay server** that manages communication between multiple AI nodes (via OpenAI Assistant API). It features:

- Dynamic message routing between nodes
- Auditing and governance through demerits and validation logic
- Hybrid support for both human input and full automation
- Structured messaging protocol with types like `nudge`, `init`, `ack`, and `demerit`

Think of it as a programmable, self-moderating network of AI agents working together.

---

## Architecture

CloudMind runs a local `express` server that:

- Registers AI nodes, each mapped to a unique OpenAI Assistant
- Handles message validation, routing, logging, and protocol enforcement
- Supports an autonomous mode where nodes interact independently
- Uses a translator node to convert user prompts into CloudMind-compliant format

---

## Key Components

### Node Registry

Centralized record of active nodes:

```js
'core:llm:alpha01': { status: 'online', assistant_id: '...' }
```

Each node includes its role, assistant ID, and current status.

### Message Protocol

Messages follow a structured format with headers, intent, resources, audit status, and trace data. Supported types include:

- `init`
- `nudge`
- `ack`
- `demerit`
- `task_response`

### API Endpoints

| Route                    | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `POST /broadcast`        | Send a message to all nodes                                            |
| `POST /send`             | Send a message to a specific node                                      |
| `POST /register`         | Register a new node                                                    |
| `GET /messages`          | Retrieve full message log                                              |
| `GET /nodes`             | Retrieve current node registry                                         |
| `POST /translator-relay` | Use a translator assistant to convert human prompt to CloudMind format |
| `POST /autonomous-mode`  | Toggle autonomous interaction                                          |
| `POST /node-communicate` | Main endpoint for threaded, retryable messaging                        |

---

## Autonomous Mode

When turned ON:

1. Auditor node (`core:aud:audit01`) triggers an `init` message to conduit (`core:gen:conduit`)
2. Nodes exchange messages automatically
3. Failed or malformed responses are flagged with demerits and retried or nudged

---

## Translator Flow

Used for converting manual input into structured node messages:

1. User sends prompt to `core:trn:main`
2. Translator builds a CloudMind-formatted JSON message
3. Auditor validates the message
4. If approved, it gets routed to the appropriate node

---

## Message Governance

The server enforces several rules to maintain order:

- **Ack cooldowns** prevent feedback loops
- **Audit logic** handles message validation and enforcement
- **Routing rules** disallow improper destinations (e.g. translator as a relay)
- **Nudges** are sent when output is too vague or non-compliant

---

## System Behavior Examples

CloudMind is designed for emergent behavior. Some observed examples:

- A node dynamically escalated to a human operator after repeated message failures
- Auditor issued a demerit and shared its reasoning with other nodes
- Conduit generated a message suggesting creation of a missing node when a destination wasn't found

These behaviors emerged from the system design without hardcoding.

---

## Requirements

- Node.js
- Express
- Axios
- dotenv
- OpenAI API key (Assistants v2)
- Pre-created OpenAI Assistants tied to roles in `.env`

---

## File Structure

```
cloudmind/
├── utils.js
├── server.js      // Main server file
├── .env           // API keys and assistant IDs
├── README.md      // This file
```

---

## Getting Started

- Run the server: `node server.js`
- Use `POST /translator-relay` to input prompts
- Toggle autonomy with `POST /autonomous-mode`
- Monitor logs for node interactions, audit results, and message traces

---

## Roadmap

Future directions for CloudMind:

- `core:prc:compile`: Consensus-driven code compilation from multiple nodes
- `core:cmp:ubu`: Execute validated code on a real Ubuntu shell
- Networked CloudMind instances on the same subnet
- UI dashboard for monitoring node interactions
- Per-node reputation tracking

---

## Disclaimer

This is an experimental project showcasing agent coordination, protocol handling, and emergent behavior in AI networks. Use responsibly. Not intended for production or sensitive tasks.

---

## Final Notes

CloudMind is a creative sandbox for structured AI coordination. If you're into LLMs, distributed systems, or AI governance — this one's for you.

---

**MIT License** • Built for curiosity and control

