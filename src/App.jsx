import {
  Archive,
  Bot,
  Boxes,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  Copy,
  Cpu,
  FileJson,
  FolderOpen,
  LibraryBig,
  Loader2,
  MessageSquarePlus,
  Mic,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const SETTINGS_STORAGE_KEY = "floyo-llm-codex-settings";
const CONVERSATIONS_STORAGE_KEY = "floyo-llm-codex-conversations";
const ACCESS_TOKEN_STORAGE_KEY = "floyo-llm-codex-access-token";
const ACCESS_ACCOUNT_STORAGE_KEY = "floyo-llm-codex-access-account";
const DEFAULT_ACCOUNT_ID = "guest";
const FLOYO_ACCESS_INSTRUCTIONS_URL =
  "https://shared.archbee.space/public/PREVIEW-WejOAlhAmyJ3PP37IK_LR/PREVIEW-eANCv0feHV1nQbGY0KMmo";
const LEGACY_DEFAULT_SYSTEM_PROMPT =
  "You are Floyo Codex, a precise coding and multimodal assistant. Answer directly, keep code runnable, and mention assumptions when needed.";

const FALLBACK_MODELS = [
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-2.5-flash",
  "openai/gpt-4.1",
  "deepseek/deepseek-v3.2",
  "Custom",
];

const DEFAULT_SETTINGS = {
  model: "anthropic/claude-opus-4.6",
  customModelName: "",
  systemPrompt:
    "You are Floyo LLM, a precise coding and writing assistant. Answer in clean Markdown. Put runnable code in fenced code blocks with the correct language label.",
  temperature: 1,
  reasoning: true,
  maxTokens: 0,
};

const PRESETS = [
  {
    id: "codex",
    label: "Codex",
    icon: Code2,
    patch: {
      systemPrompt:
        "You are Floyo LLM, a senior software engineering assistant. Give concrete implementation-ready answers in clean Markdown. Put every code snippet in fenced code blocks with the correct language label.",
      reasoning: true,
      temperature: 0.7,
    },
  },
  {
    id: "reason",
    label: "Reason",
    icon: Sparkles,
    patch: {
      systemPrompt:
        "You are Floyo LLM, a careful reasoning assistant. Think through complex tasks, make assumptions explicit, and answer in clean Markdown.",
      reasoning: true,
      temperature: 0.4,
    },
  },
  {
    id: "creative",
    label: "Creative",
    icon: MessageSquarePlus,
    patch: {
      systemPrompt: "You are Floyo LLM, a creative writing assistant. Give polished, structured, useful responses in clean Markdown.",
      reasoning: false,
      temperature: 1.2,
    },
  },
  {
    id: "json",
    label: "JSON",
    icon: Braces,
    patch: {
      systemPrompt: "Return only valid JSON. Do not include markdown fences, comments, or extra prose.",
      reasoning: false,
      temperature: 0,
    },
  },
];

const QUICK_PROMPTS = [
  "Write Python code for a centered star pyramid.",
  "Create a launch plan for a Floyo API product.",
  "Compare Claude Opus, Sonnet, Gemini, and GPT for coding use.",
];

const PRIMARY_NAV_ITEMS = [
  { label: "New chat", icon: MessageSquarePlus, active: true },
  { label: "Search chats", icon: Search },
  { label: "Library", icon: LibraryBig },
  { label: "Archived chats", icon: Archive },
  { label: "Apps", icon: Boxes },
  { label: "Agents", icon: Bot, badge: "New" },
  { label: "Deep research", icon: Sparkles },
  { label: "Codex", icon: Code2 },
  { label: "GPTs", icon: Cpu },
  { label: "Projects", icon: FolderOpen },
];

const FEATURED_MODEL_OPTIONS = [
  {
    label: "Auto",
    model: "anthropic/claude-opus-4.6",
    description: "Balanced default",
  },
  {
    label: "Thinking",
    model: "anthropic/claude-opus-4.6",
    description: "Reasoning on",
    reasoning: true,
  },
  {
    label: "Pro",
    model: "anthropic/claude-sonnet-4.6",
    description: "Strong writing and code",
  },
  {
    label: "Instant",
    model: "google/gemini-2.5-flash-lite",
    description: "Fastest lightweight mode",
  },
];

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function createSeedMessage() {
  return {
    id: "seed",
    role: "assistant",
    content: "Floyo LLM ready.",
    createdAt: Date.now(),
  };
}

function createConversation(title = "New chat") {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [createSeedMessage()],
  };
}

function cleanTitle(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "New chat";
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function modelDisplayName(model) {
  if (model === "Custom") {
    return "Custom";
  }
  const shortName = String(model || "")
    .split("/")
    .pop()
    .replace(/[-_]/g, " ")
    .replace(/:free$/i, " free")
    .trim();
  if (!shortName) {
    return "Model";
  }
  return shortName.replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueModels(models = []) {
  return [...new Set(models.filter(Boolean))];
}

function normalizeSavedSettings(saved) {
  const systemPrompt =
    !saved?.systemPrompt || saved.systemPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT
      ? DEFAULT_SETTINGS.systemPrompt
      : saved.systemPrompt;
  return {
    ...DEFAULT_SETTINGS,
    ...(saved || {}),
    systemPrompt,
    imagePaths: undefined,
    inputVideoUrl: undefined,
    enableThinking: undefined,
    topP: undefined,
  };
}

function readSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") {
      return DEFAULT_SETTINGS;
    }
    return normalizeSavedSettings(saved);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function conversationStorageKey(accountId = DEFAULT_ACCOUNT_ID) {
  return `${CONVERSATIONS_STORAGE_KEY}:${accountId || DEFAULT_ACCOUNT_ID}`;
}

function readSavedConversations(accountId = DEFAULT_ACCOUNT_ID) {
  try {
    const key = conversationStorageKey(accountId);
    let saved = JSON.parse(localStorage.getItem(key) || "[]");
    if ((!Array.isArray(saved) || saved.length === 0) && accountId === DEFAULT_ACCOUNT_ID) {
      saved = JSON.parse(localStorage.getItem(CONVERSATIONS_STORAGE_KEY) || "[]");
    }
    if (!Array.isArray(saved) || saved.length === 0) {
      return [createConversation()];
    }
    return saved
      .filter((conversation) => conversation && Array.isArray(conversation.messages))
      .map((conversation) => ({
        ...conversation,
        title: conversation.title || "New chat",
        updatedAt: conversation.updatedAt || Date.now(),
      }))
      .slice(0, 24);
  } catch {
    return [createConversation()];
  }
}

function readSavedAccessAccount() {
  try {
    return localStorage.getItem(ACCESS_ACCOUNT_STORAGE_KEY) || DEFAULT_ACCOUNT_ID;
  } catch {
    return DEFAULT_ACCOUNT_ID;
  }
}

function readSavedAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function readInitialAccessState() {
  const accountId = readSavedAccessAccount();
  const conversations = readSavedConversations(accountId);
  return {
    accountId,
    conversations,
    activeConversationId: conversations[0]?.id,
  };
}

async function apiRequest(path, options = {}, accessToken = "") {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { "X-Floyo-App-Token": accessToken } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || data.error || `Request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function copyText(value) {
  return navigator.clipboard.writeText(value);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function StatusPill({ config }) {
  const ready = config?.hasApiKey;
  return (
    <span className={classNames("status-pill", ready ? "ready" : "blocked")}>
      {ready ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {ready ? "API key set" : "API key missing"}
    </span>
  );
}

function AccessGate({ accessToken, accessDenied, isCheckingAccess, onVerifyAccessToken, onCancel }) {
  const [draftToken, setDraftToken] = useState(accessToken);

  useEffect(() => {
    setDraftToken(accessToken);
  }, [accessToken]);

  return (
    <div className="access-gate" role="dialog" aria-modal="true" aria-label="Floyo app access">
      <form
        className="access-card"
        onSubmit={(event) => {
          event.preventDefault();
          onVerifyAccessToken(draftToken);
        }}
      >
        <div className="access-mark">
          <Check size={22} />
        </div>
        <h2>FloyoGPT access</h2>
        <p>
          Enter a valid Floyo API key or app access token to continue this request. Generate a Floyo API key from the Floyo panel.{" "}
          <a href={FLOYO_ACCESS_INSTRUCTIONS_URL} target="_blank" rel="noreferrer">
            Setup instructions
          </a>
        </p>
        <input
          name="accessToken"
          type="password"
          value={draftToken}
          placeholder="Enter Floyo API key or app access token"
          onChange={(event) => setDraftToken(event.target.value)}
          autoFocus
        />
        {accessDenied ? <span className="access-error">Invalid Floyo API key or app access token.</span> : null}
        <button type="submit" disabled={!draftToken.trim() || isCheckingAccess}>
          {isCheckingAccess ? "Checking..." : "Continue"}
        </button>
        <button type="button" className="access-secondary-button" onClick={onCancel} disabled={isCheckingAccess}>
          Cancel
        </button>
      </form>
    </div>
  );
}

function RunProgress({ phase = "thinking" }) {
  const labels = {
    thinking: {
      title: "Thinking",
      detail: "The selected LLM is reading the context and planning the answer.",
    },
    processing: {
      title: "Running workflow",
      detail: "Floyo is executing the LLM node through the API.",
    },
    writing: {
      title: "Writing",
      detail: "Formatting the final response for the chat.",
    },
  };
  const orderedSteps = ["thinking", "processing", "writing"];
  const activeIndex = Math.max(0, orderedSteps.indexOf(phase));
  const state = labels[phase] || labels.thinking;

  return (
    <div className="run-progress">
      <div className="run-progress-main">
        <span className="progress-orb" />
        <div>
          <div className="progress-title">
            {state.title}
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
          <p>{state.detail}</p>
        </div>
      </div>
      <div className="progress-steps" aria-label="Run progress">
        {orderedSteps.map((step, index) => (
          <span key={step} className={classNames(index <= activeIndex && "active", index === activeIndex && "current")}>
            {labels[step].title}
          </span>
        ))}
      </div>
    </div>
  );
}

function languageLabel(language = "") {
  const normalized = language.toLowerCase().replace(/[^a-z0-9#+.-]/g, "");
  const labels = {
    bash: "bash",
    sh: "shell",
    shell: "shell",
    zsh: "zsh",
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    python: "python",
    json: "json",
    html: "html",
    css: "css",
    md: "markdown",
    markdown: "markdown",
    txt: "text",
    text: "text",
  };
  return labels[normalized] || normalized || "text";
}

function extractText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }
  if (value && typeof value === "object" && "props" in value) {
    return extractText(value.props.children);
  }
  return "";
}

function CodeBlock({ code, language, children, onCopy }) {
  const [copied, setCopied] = useState(false);
  const label = languageLabel(language);

  const handleCopyCode = async () => {
    await onCopy(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{label}</span>
        <button type="button" onClick={handleCopyCode} title="Copy code">
          <Copy size={14} />
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="code-block-body">
        <code className={language ? `language-${language}` : undefined}>{children || code}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content, onCopy }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          code({ inline, className = "", children, node, ...props }) {
            const code = extractText(children).replace(/\n$/, "");
            const language = /language-([^\s]+)/.exec(className)?.[1] || "";
            const spansMultipleLines = node?.position?.start?.line !== node?.position?.end?.line;
            const isInline = inline || (!language && !code.includes("\n") && !spansMultipleLines);

            if (isInline) {
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock code={code} language={language} onCopy={onCopy}>
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function Message({
  message,
  onCopy,
  onEditStart,
  editingMessageId,
  editingText,
  setEditingText,
  onEditCancel,
  onEditSubmit,
  isRunning,
}) {
  const isAssistant = message.role === "assistant";
  const isEditing = !isAssistant && editingMessageId === message.id;

  return (
    <article className={classNames("message", message.role)}>
      <div className="message-avatar">
        {isAssistant ? <img className="floyo-robo-avatar" src="/floyo-robo-avatar.svg" alt="Floyo robo" /> : <UserRound size={18} />}
      </div>
      <div className={classNames("message-body", isEditing && "editing")}>
        <div className="message-meta">
          <span>{isAssistant ? "Floyo LLM" : "You"}</span>
          {message.status ? <span className={`run-status ${message.status}`}>{message.status}</span> : null}
          {message.runId ? <span className="run-id">{message.runId}</span> : null}
          {message.loading ? <Loader2 className="spin" size={15} /> : null}
        </div>
        {message.loading && !message.content ? (
          <RunProgress phase={message.phase} />
        ) : isEditing ? (
          <div className="message-edit-box">
            <textarea
              value={editingText}
              rows={4}
              onChange={(event) => setEditingText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onEditSubmit(message.id);
                }
              }}
              autoFocus
            />
            <div className="message-edit-actions">
              <button type="button" onClick={onEditCancel}>
                Cancel
              </button>
              <button type="button" className="edit-send-button" disabled={!editingText.trim() || isRunning} onClick={() => onEditSubmit(message.id)}>
                {isRunning ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                Send
              </button>
            </div>
          </div>
        ) : isAssistant ? (
          <MarkdownContent content={message.content} onCopy={onCopy} />
        ) : (
          <pre className="message-content">{message.content}</pre>
        )}
        {Array.isArray(message.outputs) && message.outputs.length > 0 ? (
          <div className="output-list">
            {message.outputs.map((output, index) => {
              const fileName = output["file name"] || output.file_name || output.id || `output-${index + 1}`;
              const url = output["presigned url"] || output.presigned_url || output.url;
              return (
                <a key={`${fileName}-${index}`} href={url || "#"} target="_blank" rel="noreferrer">
                  {fileName}
                </a>
              );
            })}
          </div>
        ) : null}
        {!isAssistant && !isEditing ? (
          <div className="message-actions user-actions">
            <button type="button" onClick={() => onEditStart(message)} title="Edit message">
              <Pencil size={15} />
              Edit
            </button>
          </div>
        ) : null}
        {isAssistant && message.content ? (
          <div className="message-actions">
            <button type="button" onClick={() => onCopy(message.content)} title="Copy response">
              <Copy size={15} />
              Copy
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SliderField({ label, value, min, max, step, onChange }) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </label>
  );
}

function ModelPicker({ settings, modelOptions, onModelSelect, onToggleReasoning }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const availableModels = uniqueModels(modelOptions);
  const featuredOptions = FEATURED_MODEL_OPTIONS.filter((option) => availableModels.includes(option.model));
  const featuredModels = new Set(featuredOptions.map((option) => option.model));
  const remainingModels = availableModels.filter((model) => !featuredModels.has(model));

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const selectModel = (model, patch = {}) => {
    onModelSelect(model, patch);
    setOpen(false);
  };

  return (
    <div className="model-picker" ref={pickerRef}>
      <button
        type="button"
        className="model-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{modelDisplayName(settings.model === "Custom" ? settings.customModelName || "Custom" : settings.model)}</span>
        <ChevronDown size={15} />
      </button>

      {open ? (
        <div className="model-menu" role="listbox">
          <div className="model-menu-section-label">Latest</div>
          <div className="model-menu-list">
            {featuredOptions.map((option) => {
              const active = settings.model === option.model;
              return (
                <button
                  key={`${option.label}-${option.model}`}
                  type="button"
                  className={classNames("model-option", active && "active")}
                  onClick={() => selectModel(option.model, option.reasoning === undefined ? {} : { reasoning: option.reasoning })}
                  role="option"
                  aria-selected={active}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {active ? <Check size={18} /> : null}
                </button>
              );
            })}
          </div>

          <div className="model-menu-divider" />
          <div className="model-menu-section-label">All Floyo models</div>
          <div className="model-menu-list compact">
            {remainingModels.map((model) => {
              const active = settings.model === model;
              return (
                <button
                  key={model}
                  type="button"
                  className={classNames("model-option", active && "active")}
                  onClick={() => selectModel(model)}
                  role="option"
                  aria-selected={active}
                >
                  <span>
                    <strong>{modelDisplayName(model)}</strong>
                    <small>{model}</small>
                  </span>
                  {active ? <Check size={18} /> : null}
                </button>
              );
            })}
          </div>

          <div className="model-menu-divider" />
          <button type="button" className="model-option reasoning-option" onClick={onToggleReasoning}>
            <span>
              <strong>Reasoning</strong>
              <small>{settings.reasoning ? "On for deeper answers" : "Off for faster answers"}</small>
            </span>
            <span className={classNames("reasoning-switch", settings.reasoning && "on")}>
              <i />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarNavButton({ item, onClick }) {
  const Icon = item.icon;
  return (
    <button type="button" className={classNames("sidebar-nav-button", item.active && "active")} onClick={onClick}>
      <Icon size={19} />
      <span>{item.label}</span>
      {item.badge ? <small>{item.badge}</small> : null}
    </button>
  );
}

function HistorySidebar({ conversations, activeConversationId, onSelect, onNew, onDelete, onReset }) {
  return (
    <aside className="history-sidebar">
      <div className="sidebar-brand">
        <h1>FloyoGPT</h1>
        <button type="button" className="icon-button ghost" title="Collapse sidebar">
          <PanelLeft size={18} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="FloyoGPT navigation">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <SidebarNavButton key={item.label} item={item} onClick={item.label === "New chat" ? onNew : undefined} />
        ))}
      </nav>

      <div className="history-list" aria-label="Recent chats">
        <h2>Recents</h2>
        {conversations.slice(0, 8).map((conversation) => (
          <div
            key={conversation.id}
            className={classNames("history-row", activeConversationId === conversation.id && "active")}
          >
            <button type="button" onClick={() => onSelect(conversation.id)}>
              <span>{conversation.title}</span>
              <small>{Math.max(0, conversation.messages.length - 1)} messages</small>
            </button>
            <button type="button" className="icon-button ghost" onClick={() => onDelete(conversation.id)} title="Delete chat">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-account">
        <button type="button" className="sidebar-reset" onClick={onReset}>
          <RotateCcw size={15} />
          Reset current
        </button>
        <div className="workspace-chip">
          <span>F</span>
          <div>
            <strong>Floyo</strong>
            <small>API workspace</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AdvancedPanel({
  settings,
  setSettings,
  activePreset,
  setActivePreset,
  config,
  models,
  workflowPreview,
  lastRun,
  onPreviewWorkflow,
  onCopy,
  onClose,
}) {
  const update = useCallback(
    (patch) => {
      setSettings((current) => ({ ...current, ...patch }));
    },
    [setSettings],
  );
  const payload = workflowPreview || lastRun?.workflow || null;
  const json = payload ? JSON.stringify(payload, null, 2) : "";
  const modelOptions = models?.length ? models : FALLBACK_MODELS;

  return (
    <aside className="advanced-panel">
      <div className="panel-head">
        <div>
          <h2>Advanced</h2>
          <p>{config?.hasApiKey ? "Server-side Floyo API" : "API key missing"}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close advanced settings">
          <X size={16} />
        </button>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <Settings2 size={15} />
          Model
        </div>
        <label className="field compact">
          <span>Model selection</span>
          <select value={settings.model} onChange={(event) => update({ model: event.target.value })}>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        {settings.model === "Custom" ? (
          <label className="field compact">
            <span>Custom model name</span>
            <input
              type="text"
              placeholder="provider/model-name"
              value={settings.customModelName}
              onChange={(event) => update({ customModelName: event.target.value })}
            />
          </label>
        ) : null}
      </div>

      <div className="panel-section">
        <div className="section-title">
          <Sparkles size={15} />
          Presets
        </div>
        <div className="preset-grid">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                className={classNames("preset-button", activePreset === preset.id && "active")}
                onClick={() => {
                  setActivePreset(preset.id);
                  update(preset.patch);
                }}
              >
                <Icon size={16} />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <Bot size={15} />
          Node settings
        </div>
        <SliderField label="Temperature" value={settings.temperature} min={0} max={2} step={0.1} onChange={(temperature) => update({ temperature })} />
        <label className="field compact">
          <span>Max tokens</span>
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={settings.maxTokens}
            onChange={(event) => update({ maxTokens: Number(event.target.value) })}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.reasoning}
            onChange={(event) => update({ reasoning: event.target.checked })}
          />
          <span>Reasoning</span>
        </label>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <Code2 size={15} />
          System prompt
        </div>
        <textarea
          value={settings.systemPrompt}
          onChange={(event) => update({ systemPrompt: event.target.value })}
          rows={7}
        />
      </div>

      <div className="panel-section workflow-section">
        <div className="section-title row-between">
          <span>
            <FileJson size={15} />
            Workflow JSON
          </span>
          <button type="button" className="icon-button" disabled={!json} onClick={() => onCopy(json)} title="Copy JSON">
            <Clipboard size={15} />
          </button>
        </div>
        <button type="button" className="wide-button" onClick={onPreviewWorkflow}>
          <FileJson size={16} />
          Preview workflow
        </button>
        <pre className="json-panel">{json || "Workflow JSON will appear here."}</pre>
      </div>
    </aside>
  );
}

export default function App() {
  const initialAccessState = useMemo(readInitialAccessState, []);
  const [config, setConfig] = useState(null);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [settings, setSettings] = useState(readSavedSettings);
  const [activePreset, setActivePreset] = useState("codex");
  const [accessAccountId, setAccessAccountId] = useState(initialAccessState.accountId);
  const [conversations, setConversations] = useState(initialAccessState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(initialAccessState.activeConversationId);
  const [draft, setDraft] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [notice, setNotice] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [accessToken, setAccessToken] = useState(readSavedAccessToken);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessVerified, setAccessVerified] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [showAccessPrompt, setShowAccessPrompt] = useState(false);
  const [pendingAccessAction, setPendingAccessAction] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const modelOptions = models?.length ? models : FALLBACK_MODELS;

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0],
    [activeConversationId, conversations],
  );
  const messages = activeConversation?.messages || [];
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.id !== "seed"),
    [messages],
  );
  const isEmptyChat = visibleMessages.length === 0;
  const requiresAccessToken = Boolean(config?.requiresAccessToken);
  const isAccessLocked = requiresAccessToken && !accessVerified;

  useEffect(() => {
    apiRequest("/api/config")
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (Array.isArray(nextConfig.models) && nextConfig.models.length) {
          setModels(nextConfig.models);
        }
        if (nextConfig.defaults) {
          setSettings((current) => ({ ...nextConfig.defaults, ...current }));
        }
      })
      .catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(conversationStorageKey(accessAccountId), JSON.stringify(conversations));
  }, [accessAccountId, conversations]);

  useEffect(() => {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  }, [accessToken]);

  useEffect(() => {
    localStorage.setItem(ACCESS_ACCOUNT_STORAGE_KEY, accessAccountId || DEFAULT_ACCOUNT_ID);
  }, [accessAccountId]);

  const loadAccountConversations = useCallback((accountId) => {
    const nextConversations = readSavedConversations(accountId);
    setConversations(nextConversations);
    setActiveConversationId(nextConversations[0]?.id);
    setDraft("");
    setEditingMessageId("");
    setEditingText("");
    setLastRun(null);
    setWorkflowPreview(null);
  }, []);

  const verifyAccessToken = useCallback(async (tokenValue) => {
    const nextToken = String(tokenValue || "").trim();
    if (!nextToken) {
      setAccessVerified(false);
      setAccessDenied(true);
      return false;
    }

    setIsCheckingAccess(true);
    setAccessDenied(false);

    try {
      const verification = await apiRequest(
        "/api/access/verify",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        nextToken,
      );
      const nextAccountId = verification.accountId || DEFAULT_ACCOUNT_ID;
      setAccessToken(nextToken);
      setAccessAccountId(nextAccountId);
      if (nextAccountId !== accessAccountId) {
        loadAccountConversations(nextAccountId);
      }
      setAccessVerified(true);
      setShowAccessPrompt(false);
      return true;
    } catch (error) {
      setAccessVerified(false);
      setAccessDenied(true);
      return false;
    } finally {
      setIsCheckingAccess(false);
    }
  }, [accessAccountId, loadAccountConversations]);

  useEffect(() => {
    if (!config) {
      return undefined;
    }
    if (!requiresAccessToken) {
      setAccessVerified(true);
      setAccessDenied(false);
      return undefined;
    }
    if (!accessToken.trim()) {
      setAccessVerified(false);
      return undefined;
    }

    let isCancelled = false;
    setIsCheckingAccess(true);
    setAccessDenied(false);

    apiRequest(
      "/api/access/verify",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
      accessToken,
    )
      .then((verification) => {
        if (!isCancelled) {
          const nextAccountId = verification.accountId || DEFAULT_ACCOUNT_ID;
          setAccessAccountId(nextAccountId);
          if (nextAccountId !== accessAccountId) {
            loadAccountConversations(nextAccountId);
          }
          setAccessVerified(true);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setAccessVerified(false);
          setAccessDenied(true);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCheckingAccess(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [accessAccountId, accessToken, config, loadAccountConversations, requiresAccessToken]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const requestSettings = useMemo(
    () => ({
      model: settings.model,
      customModelName: settings.customModelName,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      reasoning: settings.reasoning,
      maxTokens: settings.maxTokens,
    }),
    [settings],
  );

  const showNotice = useCallback((value) => {
    setNotice(value);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const handleCopy = useCallback(
    async (value) => {
      await copyText(value);
      showNotice("Copied");
    },
    [showNotice],
  );

  const promptForAccess = useCallback((action) => {
    setPendingAccessAction(action);
    setAccessDenied(false);
    setShowAccessPrompt(true);
  }, []);

  const updateModelSelection = useCallback((model, patch = {}) => {
    setSettings((current) => ({ ...current, ...patch, model }));
    if (model === "Custom") {
      setShowAdvanced(true);
    }
  }, []);

  const toggleReasoning = useCallback(() => {
    setSettings((current) => ({ ...current, reasoning: !current.reasoning }));
  }, []);

  const updateActiveMessages = useCallback(
    (updater, titleSource = "") => {
      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== activeConversationId) {
            return conversation;
          }
          const nextMessages = typeof updater === "function" ? updater(conversation.messages) : updater;
          const shouldRename = conversation.title === "New chat" && titleSource;
          return {
            ...conversation,
            title: shouldRename ? cleanTitle(titleSource) : conversation.title,
            messages: nextMessages,
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeConversationId],
  );

  const createNewChat = useCallback(() => {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current].slice(0, 24));
    setActiveConversationId(conversation.id);
    setDraft("");
    setEditingMessageId("");
    setEditingText("");
    setLastRun(null);
    setWorkflowPreview(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const deleteChat = useCallback(
    (conversationId) => {
      setConversations((current) => {
        if (current.length === 1) {
          const replacement = createConversation();
          setActiveConversationId(replacement.id);
          return [replacement];
        }
        const next = current.filter((conversation) => conversation.id !== conversationId);
        if (conversationId === activeConversationId) {
          setActiveConversationId(next[0]?.id);
        }
        return next;
      });
    },
    [activeConversationId],
  );

  const resetCurrentChat = useCallback(() => {
    updateActiveMessages([createSeedMessage()]);
    setDraft("");
    setEditingMessageId("");
    setEditingText("");
    setLastRun(null);
    setWorkflowPreview(null);
  }, [updateActiveMessages]);

  const previewWorkflow = useCallback(async ({ skipAccessCheck = false, promptOverride = "" } = {}) => {
    if (settings.model === "Custom" && !settings.customModelName.trim()) {
      setShowAdvanced(true);
      showNotice("Add a custom model name first.");
      return;
    }
    if (isAccessLocked && !skipAccessCheck) {
      promptForAccess({ type: "preview", prompt: draft.trim() });
      return;
    }
    const prompt = promptOverride || draft.trim() || "Write a concise launch plan for Floyo API integrations.";
    let preview;
    try {
      preview = await apiRequest(
        "/api/workflow/preview",
        {
          method: "POST",
          body: JSON.stringify({
            prompt,
            messages: messages.filter((message) => message.id !== "seed" && !message.loading),
            options: requestSettings,
          }),
        },
        accessToken,
      );
    } catch (error) {
      if (error.status === 401) {
        setAccessVerified(false);
        setAccessDenied(true);
        promptForAccess({ type: "preview" });
        return;
      }
      throw error;
    }
    setWorkflowPreview(preview);
    setShowAdvanced(true);
  }, [accessToken, draft, isAccessLocked, messages, promptForAccess, requestSettings, settings.customModelName, settings.model, showNotice]);

  const runFloyoPrompt = useCallback(
    async ({ prompt, history, pendingMessageId }) => {
      setIsRunning(true);
    const processingTimer = window.setTimeout(() => {
      updateActiveMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId && message.loading
            ? {
                ...message,
                phase: "processing",
                status: "processing",
              }
            : message,
        ),
      );
    }, 900);

    try {
      const result = await apiRequest(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({
            prompt,
            messages: history,
            options: requestSettings,
            waitForCompletion: true,
            pollTimeoutMs: 180000,
          }),
        },
        accessToken,
      );

      window.clearTimeout(processingTimer);
      const answer = result.answer || "No text response was returned.";
      setLastRun(result);
      setWorkflowPreview(result.workflow);
      updateActiveMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content: "",
                loading: true,
                phase: "writing",
                status: "writing",
                runId: result.runId,
                outputs: result.outputs,
              }
            : message,
        ),
      );
      await sleep(Math.min(1100, Math.max(520, answer.length * 3)));
      updateActiveMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content: answer,
                loading: false,
                phase: "done",
                status: result.status,
              }
            : message,
        ),
      );
    } catch (error) {
      window.clearTimeout(processingTimer);
      if (error.status === 401) {
        setAccessVerified(false);
        setAccessDenied(true);
      }
      updateActiveMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                content: error.message,
                loading: false,
                phase: "failed",
                status: "failed",
              }
            : message,
        ),
      );
    } finally {
      setIsRunning(false);
      inputRef.current?.focus();
    }
    },
    [accessToken, requestSettings, updateActiveMessages],
  );

  const sendMessage = useCallback(async ({ skipAccessCheck = false, promptOverride = "" } = {}) => {
    const prompt = promptOverride || draft.trim();
    if (!prompt || isRunning) {
      return;
    }
    if (isAccessLocked && !skipAccessCheck) {
      promptForAccess({ type: "send", prompt });
      return;
    }
    if (settings.model === "Custom" && !settings.customModelName.trim()) {
      setShowAdvanced(true);
      showNotice("Add a custom model name first.");
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    };
    const pendingMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      loading: true,
      phase: "thinking",
      status: "thinking",
      createdAt: Date.now(),
    };
    const history = [...messages.filter((message) => message.id !== "seed" && !message.loading), userMessage];

    setDraft("");
    setEditingMessageId("");
    setEditingText("");
    updateActiveMessages((current) => [...current, userMessage, pendingMessage], prompt);
    await runFloyoPrompt({ prompt, history, pendingMessageId: pendingMessage.id });
  }, [
    draft,
    isAccessLocked,
    isRunning,
    messages,
    promptForAccess,
    runFloyoPrompt,
    settings.customModelName,
    settings.model,
    showNotice,
    updateActiveMessages,
  ]);

  const startEditingMessage = useCallback((message) => {
    if (isRunning) {
      return;
    }
    setEditingMessageId(message.id);
    setEditingText(message.content);
  }, [isRunning]);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId("");
    setEditingText("");
  }, []);

  const submitEditedMessage = useCallback(
    async (messageId, { skipAccessCheck = false } = {}) => {
      const prompt = editingText.trim();
      if (!prompt || isRunning) {
        return;
      }
      if (isAccessLocked && !skipAccessCheck) {
        promptForAccess({ type: "edit", messageId });
        return;
      }
      if (settings.model === "Custom" && !settings.customModelName.trim()) {
        setShowAdvanced(true);
        showNotice("Add a custom model name first.");
        return;
      }

      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return;
      }

      const editedMessage = {
        ...messages[messageIndex],
        content: prompt,
        editedAt: Date.now(),
      };
      const baseMessages = [
        ...messages.slice(0, messageIndex).filter((message) => !message.loading),
        editedMessage,
      ];
      const pendingMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        loading: true,
        phase: "thinking",
        status: "thinking",
        createdAt: Date.now(),
      };
      const history = baseMessages.filter((message) => message.id !== "seed" && !message.loading);

      setEditingMessageId("");
      setEditingText("");
      setLastRun(null);
      setWorkflowPreview(null);
      updateActiveMessages([...baseMessages, pendingMessage], prompt);
      await runFloyoPrompt({ prompt, history, pendingMessageId: pendingMessage.id });
    },
    [
      editingText,
      isAccessLocked,
      isRunning,
      messages,
      promptForAccess,
      runFloyoPrompt,
      settings.customModelName,
      settings.model,
      showNotice,
      updateActiveMessages,
    ],
  );

  useEffect(() => {
    if (!accessVerified || !pendingAccessAction) {
      return;
    }

    const action = pendingAccessAction;
    setPendingAccessAction(null);

    if (action.type === "send") {
      void sendMessage({ skipAccessCheck: true, promptOverride: action.prompt || "" });
    }

    if (action.type === "preview") {
      void previewWorkflow({ skipAccessCheck: true, promptOverride: action.prompt || "" });
    }

    if (action.type === "edit" && action.messageId) {
      void submitEditedMessage(action.messageId, { skipAccessCheck: true });
    }
  }, [accessVerified, pendingAccessAction, previewWorkflow, sendMessage, submitEditedMessage]);

  return (
    <div className={classNames("app-shell", showAdvanced && "advanced-open")}>
      <HistorySidebar
        conversations={conversations}
        activeConversationId={activeConversation?.id}
        onSelect={(conversationId) => {
          setActiveConversationId(conversationId);
          setDraft("");
          setEditingMessageId("");
          setEditingText("");
          setWorkflowPreview(null);
          setLastRun(null);
        }}
        onNew={createNewChat}
        onDelete={deleteChat}
        onReset={resetCurrentChat}
      />

      <section className={classNames("chat-shell", isEmptyChat && "empty-chat")}>
        <header className="chat-header">
          <div>
            <h2>{isEmptyChat ? "FloyoGPT" : activeConversation?.title || "New chat"}</h2>
            <p>{settings.model === "Custom" ? settings.customModelName || "Custom model" : settings.model}</p>
          </div>
          <div className="chat-header-actions">
            <StatusPill config={config} />
            <button type="button" className={classNames("pill-button", showAdvanced && "active")} onClick={() => setShowAdvanced((value) => !value)}>
              <Settings2 size={16} />
              Advanced
            </button>
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          {isEmptyChat ? (
            <div className="empty-state">
              <h1>What's on the agenda today?</h1>
            </div>
          ) : (
            visibleMessages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onCopy={handleCopy}
                onEditStart={startEditingMessage}
                editingMessageId={editingMessageId}
                editingText={editingText}
                setEditingText={setEditingText}
                onEditCancel={cancelEditingMessage}
                onEditSubmit={submitEditedMessage}
                isRunning={isRunning}
              />
            ))
          )}
          {isEmptyChat ? (
            <button type="button" className="knowledge-chip" onClick={() => setDraft(QUICK_PROMPTS[1])}>
              <Sparkles size={17} />
              Floyo knowledge
            </button>
          ) : null}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <div className="composer-box">
            <button type="button" className="composer-plus-button" onClick={() => setShowAdvanced(true)} title="Advanced options">
              <Plus size={23} />
            </button>
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              placeholder="Ask anything"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <div className="composer-actions">
              <ModelPicker
                settings={settings}
                modelOptions={modelOptions}
                onModelSelect={updateModelSelection}
                onToggleReasoning={toggleReasoning}
              />
              <button
                type="button"
                className={classNames("reasoning-toggle-button", settings.reasoning && "active")}
                onClick={toggleReasoning}
                aria-pressed={settings.reasoning}
                title={settings.reasoning ? "Turn reasoning off" : "Turn reasoning on"}
              >
                <span />
                {settings.reasoning ? "Reasoning on" : "Reasoning off"}
              </button>
              <button type="button" className="icon-button ghost composer-icon" onClick={() => setShowAdvanced(true)} title="Node settings">
                <SlidersHorizontal size={18} />
              </button>
              <button type="button" className="icon-button ghost composer-icon" title="Voice input">
                <Mic size={19} />
              </button>
              <button type="button" className="icon-button" onClick={previewWorkflow} title="Preview workflow JSON">
                <FileJson size={17} />
              </button>
              <button type="submit" className="send-button" disabled={!draft.trim() || isRunning} title="Run workflow">
                {isRunning ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
              </button>
            </div>
          </div>
          <div className="drop-hint">
            <Sparkles size={14} />
            LLM_floyo · Temperature {settings.temperature} · Max tokens {settings.maxTokens || "auto"}
          </div>
        </form>
      </section>

      <AdvancedPanel
        settings={settings}
        setSettings={setSettings}
        activePreset={activePreset}
        setActivePreset={setActivePreset}
        config={config}
        models={models}
        workflowPreview={workflowPreview}
        lastRun={lastRun}
        onPreviewWorkflow={previewWorkflow}
        onCopy={handleCopy}
        onClose={() => setShowAdvanced(false)}
      />

      {showAccessPrompt ? (
        <AccessGate
          accessToken={accessToken}
          accessDenied={accessDenied}
          isCheckingAccess={isCheckingAccess}
          onVerifyAccessToken={verifyAccessToken}
          onCancel={() => {
            setShowAccessPrompt(false);
            setPendingAccessAction(null);
            setAccessDenied(false);
          }}
        />
      ) : null}

      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  );
}
