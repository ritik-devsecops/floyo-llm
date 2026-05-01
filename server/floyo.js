const DONE_STATUSES = new Set(["done", "failed", "cancelled"]);
const TEXT_MIME_PREFIXES = ["text/", "application/json"];
const TEXT_FILE_EXTENSIONS = [".txt", ".json", ".md", ".csv", ".log"];
const RUN_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function envApiBaseUrl() {
  return (process.env.FLOYO_API_BASE_URL || "https://api.floyo.ai").replace(/\/+$/, "");
}

function normalizeApiBaseUrl(apiBaseUrl = "") {
  return (apiBaseUrl || envApiBaseUrl()).replace(/\/+$/, "");
}

function authHeaders(apiKeyOverride = "") {
  const apiKey = apiKeyOverride || process.env.FLOYO_API_KEY;
  if (!apiKey || apiKey === "YOUR_FLOYO_API_KEY") {
    const error = new Error("FLOYO_API_KEY is missing. Copy .env.example to .env and add your API key.");
    error.status = 500;
    throw error;
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

function candidateApiBaseUrls() {
  return [...new Set([envApiBaseUrl(), "https://api.floyo.ai", "https://api-dev.floyo.ai"].map(normalizeApiBaseUrl))];
}

function createAccessProbeRunId() {
  let suffix = "";
  for (let index = 0; index < 16; index += 1) {
    suffix += RUN_ID_ALPHABET[Math.floor(Math.random() * RUN_ID_ALPHABET.length)];
  }
  return `run_${suffix}`;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function floyoRequest(path, options = {}, context = {}) {
  const response = await fetch(`${normalizeApiBaseUrl(context.apiBaseUrl)}${path}`, {
    ...options,
    headers: {
      ...authHeaders(context.apiKey),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await parseResponse(response);

  if (!response.ok) {
    const message =
      typeof data === "object" && data
        ? data.message || data.error || JSON.stringify(data)
        : String(data || response.statusText);
    const error = new Error(`Floyo API ${response.status}: ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function getResponseMessage(data) {
  if (typeof data === "object" && data) {
    return String(data.message || data.error || JSON.stringify(data));
  }
  return String(data || "");
}

async function probeApiKeyOnBase(apiKey, apiBaseUrl) {
  const response = await fetch(`${normalizeApiBaseUrl(apiBaseUrl)}/runs/${createAccessProbeRunId()}`, {
    headers: {
      ...authHeaders(apiKey),
    },
  });
  const data = await parseResponse(response);
  const message = getResponseMessage(data).toLowerCase();

  if (response.status === 401 || response.status === 403 || message.includes("invalid api key")) {
    return { ok: false };
  }

  if (response.status === 200 || response.status === 404 || message.includes("run not found")) {
    return { ok: true, apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl) };
  }

  return { ok: false };
}

export async function validateFloyoApiKey(apiKey) {
  const token = String(apiKey || "").trim();
  if (!token.startsWith("flo_")) {
    return { ok: false };
  }

  for (const apiBaseUrl of candidateApiBaseUrls()) {
    try {
      const result = await probeApiKeyOnBase(token, apiBaseUrl);
      if (result.ok) {
        return result;
      }
    } catch {
      // Try the next known Floyo API base URL.
    }
  }

  return { ok: false };
}

export async function createRun(payload, context = {}) {
  return floyoRequest("/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  }, context);
}

export async function retrieveRun(runId, { expandOutputs = true, presignedUrlExpiresIn = 600, apiKey = "", apiBaseUrl = "" } = {}) {
  void expandOutputs;
  void presignedUrlExpiresIn;
  return floyoRequest(`/runs/${encodeURIComponent(runId)}`, {}, { apiKey, apiBaseUrl });
}

export async function cancelRun(runId, context = {}) {
  return floyoRequest(`/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  }, context);
}

export async function pollRun(runId, { timeoutMs = 180000, intervalMs = 1600, apiKey = "", apiBaseUrl = "" } = {}) {
  const startedAt = Date.now();
  let latestRun = await retrieveRun(runId, { apiKey, apiBaseUrl });

  while (!DONE_STATUSES.has(latestRun.status) && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    latestRun = await retrieveRun(runId, { apiKey, apiBaseUrl });
  }

  return latestRun;
}

function getValueByPossibleKeys(object, keys) {
  if (!object || typeof object !== "object") {
    return "";
  }
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isTextOutput(output = {}) {
  const mimeType = String(output["mime type"] || output.mime_type || "").toLowerCase();
  const fileName = String(output["file name"] || output.file_name || "").toLowerCase();
  return (
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  );
}

async function fetchTextOutput(output, context = {}) {
  if (!isTextOutput(output)) {
    return "";
  }

  try {
    const url = output["presigned url"] || output.presigned_url || output.url;
    const fileId = output.id;
    let resolvedUrl = url;
    if (!resolvedUrl && fileId) {
      const fileMetadata = await floyoRequest(`/files/${encodeURIComponent(fileId)}?expand=presigned_url`, {}, context);
      resolvedUrl = fileMetadata.presigned_url || fileMetadata["presigned url"];
    }
    const response = url
      ? await fetch(url)
      : resolvedUrl
        ? await fetch(resolvedUrl)
        : null;
    if (!response) {
      return "";
    }
    if (!response.ok) {
      return "";
    }
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function extractPreviewText(run) {
  const preview = run?.preview_output || run?.previewOutput;
  return getValueByPossibleKeys(preview, ["content", "text", "value", "output"]);
}

function extractStructuredText(run) {
  const candidates = [
    run?.result,
    run?.response,
    run?.data,
    run?.output,
    run?.outputs,
    run?.execution_result,
    run?.executionResult,
  ];
  const keyGroups = [
    ["output", "answer", "content", "text", "message"],
    ["reasoning", "reasoning_content"],
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        for (const keys of keyGroups) {
          const value = getValueByPossibleKeys(item, keys);
          if (value) return value;
        }
      }
    }

    for (const keys of keyGroups) {
      const value = getValueByPossibleKeys(candidate, keys);
      if (value) return value;
    }
  }

  return "";
}

export async function normalizeRunResult(run, context = {}) {
  const outputs = Array.isArray(run?.outputs) ? run.outputs : [];
  const outputTexts = [];

  for (const output of outputs) {
    const directText = getValueByPossibleKeys(output, ["content", "text", "value", "output", "output_text"]);
    if (directText) {
      outputTexts.push(directText);
      continue;
    }

    const fileText = await fetchTextOutput(output, context);
    if (fileText) {
      outputTexts.push(fileText);
    }
  }

  const answer =
    outputTexts[0] ||
    extractPreviewText(run) ||
    extractStructuredText(run) ||
    (run?.status === "done"
      ? "Run completed, but Floyo did not expose a text field in the run response. Check raw run data and outputs."
      : "");

  return {
    answer,
    status: run?.status || "unknown",
    outputs,
    run,
  };
}

export function getPublicConfig() {
  return {
    hasApiKey: Boolean(process.env.FLOYO_API_KEY && process.env.FLOYO_API_KEY !== "YOUR_FLOYO_API_KEY"),
  };
}
