# CloudMind Communication Server

**Version:** v0.93  
**Author:** *Christian Parks*  
**Description:** A modular communication server designed to orchestrate intelligent interactions among multiple OpenAI Assistant agents through a message-driven architecture.

---

## Overview
CloudMind is a flexible relay server enabling structured communication between various AI agents using the OpenAI Assistant API. It simulates a multi-agent environment with message routing, audits, and dynamic behavior regulation. It supports both autonomous execution and human-guided interaction.

---

## Features
- Dynamic routing between multiple LLM nodes
- Structured messaging protocol using JSON
- Built-in auditing, error correction, and demerit logic
- Manual and autonomous operational modes
- CLI interface and real-time message log monitoring

---

## Architecture
CloudMind runs on Node.js with Express and consists of the following key components:

- **Node Registry:** Tracks available nodes and their OpenAI Assistant IDs
- **Message Router:** Handles validation and delivery between agents
- **Audit System:** Governs compliance, routing violations, and corrective actions
- **CLI Interface:** Allows developers to interact, control, and observe node behavior

---

## Message Structure
All communication follows a defined JSON schema, containing:
- `header`: Metadata including sender, receiver, ID, and type
- `intent`: Instructions or desired action
- `resources`: Optional contextual information
- `audit`: Audit requirements and expected schemas
- `trace`: Information for thread linkage and origin tracking

---

## Endpoints
| Endpoint                  | Functionality                                  |
|--------------------------|-----------------------------------------------|
| `POST /broadcast`        | Sends a message to all nodes in the registry  |
| `POST /send`             | Direct message to a specific node             |
| `POST /register`         | Register or update a node                     |
| `GET /messages`          | View current message log                      |
| `GET /nodes`             | View active nodes                             |
| `POST /translator-relay` | Use a translator node to convert human prompts|
| `POST /autonomous-mode`  | Toggle autonomous system behavior             |
| `POST /node-communicate` | Main message interface for node interaction   |

---

## Autonomous Mode
When enabled, the network functions independently:
1. Initiation begins with an `init` message from the audit node
2. Nodes exchange messages based on assigned roles
3. Malfunctions trigger audits, nudges, or demerits

This mode is useful for observing emergent behavior in agent interactions.

---

## Command-Line Interface (`cloudMindCLI.js`)
This CLI lets developers interact with the CloudMind server:
```bash
start -a         # Enable autonomous mode
start -m             # Disable autonomous mode
status                     # Check server health and node list
send -f <file> -n <node>   # Send a structured message to a node
chat                       # Chat using the translator node
```

---

## Router Watch (`cloudMindRtwatch.js`)
This monitoring tool provides a live stream of inter-node communications. 
Ideal for debugging, traffic analysis, or studying node behavior in real time.

---

## Example Behaviors
- Nodes request human intervention for complex tasks
- Improper parsing is flagged and logged via demerits
- Unknown node destinations return constructive feedback to the sender

These behaviors emerge from the message protocol and node logic.

---

## Requirements
- Node.js (v16+ recommended)
- Express
- Axios
- dotenv
- OpenAI Assistants v2 API access

---

## File Structure
```
cloudmind/
├── server.js                  # Main communication server
├── cloudmind-cli.js           # CLI for interacting with server
├── cloudmind-router-watch.js  # Real-time router log visualizer
├── utils.js                   # Utilities for retries and polling
├── .env                       # API keys (not included in version control)
├── .env.example               # Template for environment setup
├── README.md                  # Documentation (this file)
```

---

## Usage Instructions
1. Start the server:
```bash
node cloudMind.js
```
2. Launch the CLI:
```bash
node cloudMindCLI.js
```
3. Send test prompts or activate autonomous mode
4. (Optional) Run the message monitor:
```bash
node cloudMindRtWatch.js
```

---

## Planned Features (v1.0 and beyond)
- Compiler node (`core:prc:compile`) for safe code generation
- Execution node (`core:cmp:ubu`) connected to a Linux shell
- Interconnected CloudMind clusters
- Agent scoring and voting protocols
- Visual web-based interface for message flows

---

## Disclaimer
This project is for research, experimentation, and exploration of modular AI systems. It is not intended for use in production environments or with sensitive information.

---

## License
MIT License — Contributions welcome

