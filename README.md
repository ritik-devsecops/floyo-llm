# Floyo LLM Codex

ChatGPT/Codex-style local app for running the `LLM_floyo` workflow through the Floyo API.

## Setup

```bash
cd /Users/ritik/Desktop/Floyo/API-NODES/floyo-llm-codex
npm install
cp .env.example .env
```

Add your key in `.env`:

```bash
FLOYO_API_KEY=your_key_here
FLOYO_API_BASE_URL=https://api-dev.floyo.ai
PORT=8788
```

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5174
```

The local API server runs on `http://localhost:8788`.

## Supported Workflow Inputs

- `prompt`
- `model`
- `custom_model_name`
- `system_prompt`
- `temperature`
- `reasoning`
- `max_tokens`

This app is text-only because `LLM_floyo` does not expose image or video inputs. Model selection, custom model, system prompt, max tokens, temperature, and reasoning controls live in the right-side Advanced panel.

## Response Formatting

Assistant responses render with GitHub-flavored Markdown, including headings, lists, tables, links, inline code, and fenced code blocks. Code blocks include syntax highlighting, a language label, and a per-snippet copy button.

## Vercel

Set these environment variables in Vercel before production use:

```bash
FLOYO_API_KEY=your_key_here
FLOYO_API_BASE_URL=https://api-dev.floyo.ai
```

The app includes Vercel serverless API wrappers under `api/`, so the frontend can call `/api/chat`, `/api/config`, and run status endpoints after deployment.

## API Flow

1. Frontend sends chat + settings to the local Express server.
2. Server builds Floyo API workflow JSON using `LLM_floyo`.
3. Server posts to `POST /runs`.
4. Server polls `GET /runs/:id`.
5. Server returns status, text candidates, outputs, raw run data, and the generated workflow JSON.
