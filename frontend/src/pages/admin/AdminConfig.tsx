import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConfigItem {
  key: string;
  value: string;
  type: string;
  default: string;
  label: string;
  description: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LLM_MODELS = [
  { label: "Gemma 4 31B (Google)", value: "gemini/gemma-4-31b-it" },
  { label: "Gemma 4 26B A4B (Google)", value: "gemini/gemma-4-26b-a4b-it" },
  { label: "Gemini 2.0 Flash (Google)", value: "gemini/gemini-2.0-flash" },
  { label: "Llama 3.1 8B (Groq)", value: "groq/llama-3.1-8b-instant" },
  { label: "Llama 3.1 70B (Groq)", value: "groq/llama-3.1-70b-versatile" },
  { label: "GPT-4o Mini (OpenAI)", value: "gpt-4o-mini" },
  { label: "GPT-4o (OpenAI)", value: "gpt-4o" },
  { label: "Claude 3 Haiku (Anthropic)", value: "claude-3-haiku-20240307" },
  { label: "Claude Sonnet 4 (Anthropic)", value: "claude-sonnet-4-20250514" },
];

const PARSING_LEVELS = [
  { label: "Basic", value: "basic" },
  { label: "Smart", value: "smart" },
  { label: "Full", value: "full" },
];

// ── Config Row ─────────────────────────────────────────────────────────────────

function ConfigRow({ item, onSaved }: { item: ConfigItem; onSaved: (key: string) => void }) {
  const [value, setValue] = useState(item.value);
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isModelKey = item.key === "llm.default_model";
  const isParsingLevelKey = item.key === "llm.default_parsing_level";

  // Determine if current value matches a known model
  const knownModelValues = LLM_MODELS.map((m) => m.value);
  const isCustomModel = isModelKey && value !== "" && !knownModelValues.includes(value);

  // On mount, if it's a model key and value is custom, populate custom input
  useEffect(() => {
    if (isModelKey && value !== "" && !knownModelValues.includes(value)) {
      setCustomModel(value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getEffectiveValue() {
    if (isModelKey && value === "__custom__") return customModel.trim();
    return value;
  }

  async function handleSave() {
    const effectiveValue = getEffectiveValue();
    if (!effectiveValue) return;
    setSaving(true);
    try {
      await client.patch(`/admin/config/${encodeURIComponent(item.key)}`, { value: effectiveValue });
      setSaved(true);
      onSaved(item.key);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save";
      window.alert(msg);
    } finally {
      setSaving(false);
    }
  }

  const selectValue = isModelKey
    ? (isCustomModel ? "__custom__" : value)
    : value;

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">{item.label}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{item.description}</p>
          <code className="text-[11px] text-outline mt-1 block">{item.key}</code>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-primary font-medium">
              <Check size={13} /> Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !getEffectiveValue()}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
              "bg-primary hover:bg-primary/90 disabled:opacity-50 text-on-primary"
            )}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {isModelKey ? (
        <div className="space-y-2">
          <select
            value={selectValue}
            onChange={(e) => {
              setValue(e.target.value === "__custom__" ? "__custom__" : e.target.value);
            }}
            className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {LLM_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
          {(value === "__custom__" || isCustomModel) && (
            <input
              type="text"
              placeholder="Enter custom model identifier (e.g. provider/model-name)"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
        </div>
      ) : isParsingLevelKey ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PARSING_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={item.type === "int" || item.type === "float" ? "number" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
      )}

      {item.default && (
        <p className="text-xs text-outline mt-2">Default: <code className="font-mono">{item.default}</code></p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminConfig() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    client.get<ConfigItem[]>("/admin/config")
      .then((r) => setConfigs(r.data))
      .catch((err: unknown) => {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to load config";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSaved(key: string) {
    setRecentlySaved((prev) => new Set(prev).add(key));
  }

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-on-surface">System Config</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Configure system-wide settings</p>
        </div>
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-on-surface">System Config</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Configure system-wide settings</p>
        </div>
        <div className="bg-error-container/20 border border-error/20 rounded-2xl p-6 text-center">
          <p className="text-sm text-error">{error}</p>
          <p className="text-xs text-on-surface-variant mt-1">The /admin/config endpoint may not be available yet.</p>
        </div>
      </div>
    );
  }

  // Group configs by section (prefix before the dot)
  const sections = configs.reduce<Record<string, ConfigItem[]>>((acc, item) => {
    const section = item.key.includes(".") ? item.key.split(".")[0] : "general";
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">System Config</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Configure system-wide settings</p>
      </div>

      {configs.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-8 text-center">
          <p className="text-sm text-outline">No configuration options available.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(sections).map(([section, items]) => (
            <div key={section}>
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3 px-1">
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </h2>
              <div className="space-y-3">
                {items.map((item) => (
                  <ConfigRow
                    key={item.key}
                    item={item}
                    onSaved={handleSaved}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {recentlySaved.size > 0 && (
        <p className="text-xs text-outline mt-6 text-center">
          {recentlySaved.size} setting{recentlySaved.size !== 1 ? "s" : ""} saved this session
        </p>
      )}
    </div>
  );
}
