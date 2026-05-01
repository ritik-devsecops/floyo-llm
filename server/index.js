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
const ACCESS_CACHE_TTL_MS = Number(process.env.ACCESS_CACHE_TTL_MS || 12 * 60 * 60 * 1000);
const ACCESS_NEGATIVE_CACHE_TTL_MS = Number(process.env.ACCESS_NEGATIVE_CACHE_TTL_MS || 2 * 60 * 1000);
const accessTable = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

function expectedAccessToken() {
  return String(process.env.APP_ACCESS_TOKEN || "").trim();
}

function configuredFloyoApiKey() {
  const apiKey = String(process.env.FLOYO_API_KEY || "").trim();
  return apiKey && apiKey !== "YOUR_FLOYO_API_KEY" ? apiKey : "";
}

function tokenFingerprint(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function accountIdFromFingerprint(fingerprint) {
  return `acct_${fingerprint.slice(0, 24)}`;
}

function tokenMatchesExpectedAccessToken(token) {
  const expectedToken = expectedAccessToken();
  return Boolean(expectedToken && timingSafeEquals(token, expectedToken));
}

function tokenMatchesConfiguredFloyoApiKey(token) {
  const apiKey = configuredFloyoApiKey();
  return Boolean(apiKey && timingSafeEquals(token, apiKey));
}

function tokenLooksLikeFloyoApiKey(token) {
  return String(token || "").trim().startsWith("flo_");
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

function readCachedAccess(fingerprint) {
  const record = accessTable.get(fingerprint);
  if (!record) {
    return null;
  }

  if (record.expiresAt <= Date.now()) {
    accessTable.delete(fingerprint);
    return null;
  }

  record.lastUsedAt = Date.now();
  return record;
}

function writeCachedAccess(fingerprint, patch, ttlMs = ACCESS_CACHE_TTL_MS) {
  const now = Date.now();
  const record = {
    fingerprint,
    accountId: accountIdFromFingerprint(fingerprint),
    createdAt: now,
    verifiedAt: now,
    lastUsedAt: now,
    expiresAt: now + ttlMs,
    ...patch,
  };
  accessTable.set(fingerprint, record);
  return record;
}

function toAccessResult(record, token = "") {
  if (!record?.ok) {
    return {
      ok: false,
      status: record?.status || 401,
      message: record?.message || "Invalid access token or Floyo API key.",
      accountId: record?.accountId,
      cached: Boolean(record),
    };
  }

  return {
    ok: true,
    mode: record.mode,
    accountId: record.accountId,
    cached: true,
    expiresAt: record.expiresAt,
    floyoContext: record.usesUserFloyoKey
      ? {
          apiKey: token,
          apiBaseUrl: record.apiBaseUrl,
        }
      : {},
  };
}

function cacheInvalidAccessToken(token, message = "Invalid Floyo API key.") {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return;
  }

  writeCachedAccess(
    tokenFingerprint(normalizedToken),
    {
      ok: false,
      status: 401,
      message,
    },
    ACCESS_NEGATIVE_CACHE_TTL_MS,
  );
}

function errorLooksLikeInvalidFloyoKey(error) {
  const message =
    typeof error?.data === "object" && error.data
      ? String(error.data.message || error.data.error || "")
      : String(error?.message || "");
  return error?.status === 401 && message.toLowerCase().includes("invalid api key");
}

async function resolveAccess(token) {
  const fingerprint = tokenFingerprint(token);
  const cachedAccess = readCachedAccess(fingerprint);
  if (cachedAccess) {
    return toAccessResult(cachedAccess, token);
  }

  if (tokenMatchesExpectedAccessToken(token)) {
    if (!configuredFloyoApiKey()) {
      const record = writeCachedAccess(
        fingerprint,
        {
          ok: false,
          status: 503,
          message: "FLOYO_API_KEY is required before the app access token can run Floyo workflows.",
        },
        ACCESS_NEGATIVE_CACHE_TTL_MS,
      );
      return toAccessResult(record, token);
    }

    const record = writeCachedAccess(fingerprint, {
      ok: true,
      mode: "app",
      usesUserFloyoKey: false,
    });
    return {
      ...toAccessResult(record, token),
      cached: false,
    };
  }

  if (tokenLooksLikeFloyoApiKey(token)) {
    const record = writeCachedAccess(fingerprint, {
      ok: true,
      mode: tokenMatchesConfiguredFloyoApiKey(token) ? "configured_floyo_key" : "floyo_key",
      usesUserFloyoKey: true,
    });
    return {
      ...toAccessResult(record, token),
      cached: false,
    };
  }

  const record = writeCachedAccess(
    fingerprint,
    {
      ok: false,
      status: 401,
      message: "Invalid access token or Floyo API key.",
    },
    ACCESS_NEGATIVE_CACHE_TTL_MS,
  );
  return {
    ...toAccessResult(record, token),
    cached: false,
  };
}

async function requireAppAccess(request, response, next) {
  const token = providedAccessToken(request);

  if (!token) {
    response.status(401).json({
      error: "Unauthorized",
      message: "Enter a Floyo API key or app access token.",
    });
    return;
  }

  try {
    const access = await resolveAccess(token);
    if (!access.ok) {
      response.status(access.status || 401).json({
        error: access.status === 503 ? "Access token not configured" : "Unauthorized",
        message: access.message,
      });
      return;
    }

    request.floyoContext = access.floyoContext;
    request.accessAccountId = access.accountId;
    next();
  } catch (error) {
    next(error);
  }
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

app.post("/api/access/verify", async (request, response, next) => {
  try {
    const token = providedAccessToken(request);
    if (!token) {
      response.status(401).json({
        error: "Unauthorized",
        message: "Enter a Floyo API key or app access token.",
      });
      return;
    }

    const access = await resolveAccess(token);
    if (access.ok) {
      response.json({
        ok: true,
        mode: access.mode,
        accountId: access.accountId,
        cached: access.cached,
        expiresAt: access.expiresAt,
      });
      return;
    }

    response.status(access.status || 401).json({
      error: access.status === 503 ? "Access token not configured" : "Unauthorized",
      message: access.message,
    });
  } catch (error) {
    next(error);
  }
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

    const floyoContext = request.floyoContext || {};
    const run = await createRun(workflowPayload, floyoContext);
    const shouldWait = parsed.waitForCompletion ?? true;
    const finalRun = shouldWait
      ? await pollRun(run.id, { timeoutMs: parsed.pollTimeoutMs || 180000, ...floyoContext })
      : await retrieveRun(run.id, floyoContext);
    const normalizedResult = await normalizeRunResult(finalRun, floyoContext);

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
    const floyoContext = request.floyoContext || {};
    const run = await retrieveRun(request.params.runId, floyoContext);
    const normalizedResult = await normalizeRunResult(run, floyoContext);
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
    response.json(await cancelRun(request.params.runId, request.floyoContext || {}));
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

app.use((error, request, response, _next) => {
  if (errorLooksLikeInvalidFloyoKey(error)) {
    cacheInvalidAccessToken(providedAccessToken(request));
  }

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
