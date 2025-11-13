---
title: Frequently Asked Questions (FAQ)
status: proposed
lastReviewed: 2025-10-20T00:00:00.000Z
description: Answers to common questions about Team-in-a-Box.
id: template
type: work-item
subtype: template
lifecycle: draft
---

## General Questions

- **What is Team-in-a-Box?**
  - An AI-powered platform for managing virtual teams using declarative agent and workflow files.
- **Who should use Team-in-a-Box?**
  - Startup founders, product managers, and developers looking to automate team workflows.

## Installation & Setup

- **How do I install Team-in-a-Box?**
  - See [Getting Started](./getting-started.md).
- **What are the system requirements?**
  - Node.js 18+, macOS/Linux recommended.

## Configuration

- **Where do I put my API keys?**
  - In your environment file (`~/.tiab/config/.env`).
- **How do I set up TIAB_HOME?**
  - Add `TIAB_HOME=/path/to/your/.tiab` to your `.env` file.

## Usage

- **How do I create an agent or workflow?**
  - Use YAML, JSON, or TOML files in the examples/agents or examples/workflows folders.
- **Can I use version control for my agents/workflows?**
  - Yes, all files are local and can be managed with git.

## Security

- **How are secrets managed?**
  - Secrets are stored in user-local `.env` files, never committed.
- **How do I rotate API keys?**
  - Update your `.env` file and restart the backend.

## Troubleshooting

- **See [Troubleshooting](./TROUBLESHOOTING.md) for more help.**
