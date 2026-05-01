# Floyo LLM Codex

ChatGPT/Codex-style local app for running the `LLM_floyo` workflow through the Floyo API.

## Setup

```bash
cd /Users/ritik/Desktop/Floyo/API-NODES/floyo-llm-codex
npm install
cp .env.example .env
```

Add your default server key in `.env`:

```bash
FLOYO_API_KEY=your_key_here
FLOYO_API_BASE_URL=https://api-dev.floyo.ai
APP_ACCESS_TOKEN=long_random_private_token
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
APP_ACCESS_TOKEN=long_random_private_token
```

The app includes Vercel serverless API wrappers under `api/`, so the frontend can call `/api/chat`, `/api/config`, and run status endpoints after deployment. In production, users can unlock a request with either `APP_ACCESS_TOKEN` or a Floyo API key. Floyo-shaped keys are accepted for the pending request and validated by the actual Floyo workflow call. API keys are not persisted across page refreshes.

## API Flow

1. Frontend keeps the token in memory only, then sends it with the chat and settings to the Express server.
2. Server verifies app access tokens locally or uses the supplied Floyo API key for the current request.
3. Server builds Floyo API workflow JSON using `LLM_floyo`.
4. Server posts to `POST /runs` with the configured key or the verified user-provided Floyo key.
5. Server polls `GET /runs/:id`.
6. Server returns status, text candidates, outputs, raw run data, and the generated workflow JSON.
