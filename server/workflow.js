export const LLM_MODELS = [
  "minimax/minimax-m2.5",
  "stepfun/step-3.5-flash:free",
  "deepseek/deepseek-v3.2",
  "google/gemini-3-flash-preview",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
  "openrouter/hunter-alpha",
  "google/gemini-2.5-flash",
  "moonshotai/kimi-k2.5",
  "x-ai/grok-4.1-fast",
  "google/gemini-2.5-flash-lite",
  "arcee-ai/trinity-large-preview:free",
  "openai/gpt-oss-120b",
  "anthropic/claude-sonnet-4.5",
  "xiaomi/mimo-v2-flash",
  "z-ai/glm-5",
  "openai/gpt-5-nano",
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1",
  "meta-llama/llama-4-maverick",
  "Custom",
];

const DEFAULT_MODEL = "anthropic/claude-opus-4.6";

export const DEFAULT_OPTIONS = {
  model: DEFAULT_MODEL,
  customModelName: "",
  systemPrompt:
    "You are Floyo LLM, a precise coding and writing assistant. Answer in clean Markdown. Put runnable code in fenced code blocks with the correct language label.",
  temperature: 1,
  reasoning: true,
  maxTokens: 0,
};

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numericValue));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeOptions(options = {}) {
  const requestedModel = cleanText(options.model) || DEFAULT_OPTIONS.model;
  const model = LLM_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_OPTIONS.model;

  return {
    model,
    customModelName: cleanText(options.customModelName ?? options.custom_model_name),
    systemPrompt: cleanText(options.systemPrompt ?? options.system_prompt) || DEFAULT_OPTIONS.systemPrompt,
    temperature: clampNumber(options.temperature, 0, 2, DEFAULT_OPTIONS.temperature),
    reasoning: Boolean(options.reasoning ?? DEFAULT_OPTIONS.reasoning),
    maxTokens: Math.round(clampNumber(options.maxTokens ?? options.max_tokens, 0, 100000, DEFAULT_OPTIONS.maxTokens)),
  };
}

export function buildPromptFromMessages(messages = [], prompt = "") {
  const currentPrompt = cleanText(prompt);
  const normalizedMessages = Array.isArray(messages)
    ? messages
        .filter((message) => message && typeof message.content === "string" && message.content.trim())
        .slice(-12)
    : [];

  if (!normalizedMessages.length) {
    return currentPrompt;
  }

  const transcript = normalizedMessages
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${message.content.trim()}`;
    })
    .join("\n\n");

  if (!currentPrompt || normalizedMessages[normalizedMessages.length - 1]?.content?.trim() === currentPrompt) {
    return transcript;
  }

  return `${transcript}\n\nUser: ${currentPrompt}`;
}

export function buildLLMWorkflow({ prompt, options = {}, name } = {}) {
  const normalizedOptions = normalizeOptions(options);
  const promptValue = cleanText(prompt);

  return {
    name: cleanText(name) || "LLM-Floyo",
    workflow: {
      "53": {
        inputs: {
          prompt: promptValue,
          model: normalizedOptions.model,
          system_prompt: normalizedOptions.systemPrompt,
          temperature: normalizedOptions.temperature,
          reasoning: normalizedOptions.reasoning,
          max_tokens: normalizedOptions.maxTokens,
          custom_model_name: normalizedOptions.customModelName,
        },
        class_type: "LLM_floyo",
        _meta: {
          title: "LLM (Floyo API)",
        },
      },
      "56": {
        inputs: {
          video_url: ["53", 0],
          filename: "floyo_llm_answer",
          output_dir: "",
        },
        class_type: "SaveVideoURL",
        _meta: {
          title: "Save LLM Answer",
        },
      },
    },
  };
}
