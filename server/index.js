import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildLLMWorkflow, buildPromptFromMessages, DEFAULT_OPTIONS, LLM_MODELS, normalizeOptions } from "./workflow.js";
import { cancelRun, createRun, getPublicConfig, normalizeRunResult, pollRun, retrieveRun } from "./floyo.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const app = express();
const port = Number(process.env.PORT || 8788);

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

function expectedAccessToken() {
  return String(process.env.APP_ACCESS_TOKEN || "").trim();
}

function timingSafeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function providedAccessToken(request) {
  const directToken = String(request.get("x-floyo-app-token") || "").trim();
  if (directToken) {
    return directToken;
  }

  const authorization = String(request.get("authorization") || "").trim();
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function requireAppAccess(request, response, next) {
  const expectedToken = expectedAccessToken();
  const shouldRequireToken = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

  if (!expectedToken) {
    if (shouldRequireToken) {
      response.status(503).json({
        error: "Access token not configured",
        message: "APP_ACCESS_TOKEN is required before the deployed API can run Floyo workflows.",
      });
      return;
    }
    next();
    return;
  }

  if (!timingSafeEquals(providedAccessToken(request), expectedToken)) {
    response.status(401).json({
      error: "Unauthorized",
      message: "Enter the app access token to run Floyo workflows.",
    });
    return;
  }

  next();
}

const chatSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional(),
  options: z
    .object({
      model: z.string().optional(),
      customModelName: z.string().optional(),
      custom_model_name: z.string().optional(),
      systemPrompt: z.string().optional(),
      system_prompt: z.string().optional(),
      temperature: z.number().optional(),
      reasoning: z.boolean().optional(),
      maxTokens: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .optional(),
  waitForCompletion: z.boolean().optional(),
  pollTimeoutMs: z.number().int().min(10000).max(900000).optional(),
});

app.get("/api/config", (_request, response) => {
  response.json({
    ...getPublicConfig(),
    requiresAccessToken: Boolean(expectedAccessToken() || process.env.VERCEL || process.env.NODE_ENV === "production"),
    defaults: DEFAULT_OPTIONS,
    models: LLM_MODELS,
  });
});

app.post("/api/workflow/preview", requireAppAccess, (request, response, next) => {
  try {
    const parsed = chatSchema.partial({ prompt: true }).parse({
      ...request.body,
      prompt: request.body?.prompt || "Write a concise launch plan for Floyo API integrations.",
    });
    const prompt = buildPromptFromMessages(parsed.messages, parsed.prompt);
    response.json(buildLLMWorkflow({ prompt, options: normalizeOptions(parsed.options) }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat", requireAppAccess, async (request, response, next) => {
  try {
    const parsed = chatSchema.parse(request.body);
    const prompt = buildPromptFromMessages(parsed.messages, parsed.prompt);
    const workflowPayload = buildLLMWorkflow({
      prompt,
      options: normalizeOptions(parsed.options),
    });

    const run = await createRun(workflowPayload);
    const shouldWait = parsed.waitForCompletion ?? true;
    const finalRun = shouldWait
      ? await pollRun(run.id, { timeoutMs: parsed.pollTimeoutMs || 180000 })
      : await retrieveRun(run.id);
    const normalizedResult = await normalizeRunResult(finalRun);

    response.json({
      runId: run.id,
      workflow: workflowPayload,
      ...normalizedResult,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId", requireAppAccess, async (request, response, next) => {
  try {
    const run = await retrieveRun(request.params.runId);
    const normalizedResult = await normalizeRunResult(run);
    response.json({
      runId: request.params.runId,
      ...normalizedResult,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/:runId/cancel", requireAppAccess, async (request, response, next) => {
  try {
    response.json(await cancelRun(request.params.runId));
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(projectRoot, "dist");
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  const status = error.status || (error.name === "ZodError" ? 400 : 500);
  response.status(status).json({
    error: error.name || "Error",
    message: error.message || "Unexpected server error",
    details: error.issues || error.data || undefined,
  });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Floyo LLM Codex server listening on http://localhost:${port}`);
  });
}

export default app;
