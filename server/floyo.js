const DONE_STATUSES = new Set(["done", "failed", "cancelled"]);
const TEXT_MIME_PREFIXES = ["text/", "application/json"];
const TEXT_FILE_EXTENSIONS = [".txt", ".json", ".md", ".csv", ".log"];
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

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function buildFloyoError(response, data) {
  const message =
    typeof data === "object" && data
      ? data.message || data.error || JSON.stringify(data)
      : String(data || response.statusText);
  const error = new Error(`Floyo API ${response.status}: ${message}`);
  error.status = response.status;
  error.data = data;
  return error;
}

function isInvalidApiKeyResponse(error) {
  const message = getResponseMessage(error?.data).toLowerCase();
  return error?.status === 401 || error?.status === 403 || message.includes("invalid api key");
}

function requestBaseUrls(context = {}) {
  if (context.apiBaseUrl) {
    return [normalizeApiBaseUrl(context.apiBaseUrl)];
  }
  if (context.apiKey) {
    return candidateApiBaseUrls();
  }
  return [envApiBaseUrl()];
}

async function floyoRequest(path, options = {}, context = {}) {
  let lastAuthError = null;

  for (const apiBaseUrl of requestBaseUrls(context)) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        ...authHeaders(context.apiKey),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await parseResponse(response);

    if (response.ok) {
      context.apiBaseUrl = apiBaseUrl;
      return data;
    }

    const error = buildFloyoError(response, data);
    if (context.apiKey && !context.apiBaseUrl && isInvalidApiKeyResponse(error)) {
      lastAuthError = error;
      continue;
    }

    throw error;
  }

  throw lastAuthError || new Error("Floyo API request failed.");
}

function getResponseMessage(data) {
  if (typeof data === "object" && data) {
    return String(data.message || data.error || JSON.stringify(data));
  }
  return String(data || "");
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
