// AI Service Module — configurable OpenAI-compatible endpoint with graceful fallbacks.
// When AI is not configured (no API key), chatCompletion returns null and callers
// should fall back to rule-based logic.

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  /** Whether the configured model/provider accepts image input. Not all
   *  text-capable providers do — verified false for the current DeepSeek
   *  setup (the API rejects `image_url` content outright), so this is
   *  explicit opt-in via AI_VISION_ENABLED rather than assumed from
   *  `enabled`. */
  visionEnabled: boolean;
}

let _config: AIConfig | null = null;

/** Load AI configuration from environment variables. */
export function getAIConfig(): AIConfig {
  if (!_config) {
    const apiKey = process.env.AI_API_KEY || "";
    const isPlaceholder = /^sk-rotated|^sk-replace|^sk-your|^sk-xxx|^sk-placeholder|^sk-test/i.test(apiKey);
    const enabled = apiKey.length > 0 && !isPlaceholder;
    _config = {
      endpoint: process.env.AI_ENDPOINT || "https://api.openai.com/v1",
      apiKey,
      model: process.env.AI_MODEL || "gpt-4o-mini",
      enabled,
      visionEnabled: enabled && process.env.AI_VISION_ENABLED === "true",
    };
  }
  return _config;
}

/**
 * Send a chat completion to the configured AI endpoint.
 * Returns null when AI is not configured — callers must handle this gracefully.
 */
export async function chatCompletion(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number; jsonMode?: boolean; imageUrl?: string }
): Promise<string | null> {
  const config = getAIConfig();
  if (!config.enabled) return null;

  const messages: Array<Record<string, unknown>> = [];

  if (opts?.imageUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: opts.imageUrl, detail: "high" } },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: opts?.maxTokens ?? 1024,
    temperature: opts?.temperature ?? 0.7,
  };

  if (opts?.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`AI API error ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content && data.choices?.[0]?.message?.reasoning_content) {
      // Reasoning models can spend the whole token budget "thinking" and
      // leave nothing for the actual answer — this is that case, not a
      // real API failure. Surfaced so it's diagnosable instead of a silent
      // fallback that looks identical to "AI is off".
      console.error(`AI response empty after reasoning consumed the token budget (maxTokens=${opts?.maxTokens ?? 1024}). Consider raising maxTokens for this call.`);
    }
    return content ?? null;
  } catch (err) {
    console.error("AI API request failed:", err);
    return null;
  }
}

/** Check if AI features are available. */
export function isAIEnabled(): boolean {
  return getAIConfig().enabled;
}

/** Check if the configured provider accepts image input (OCR needs this). */
export function isVisionEnabled(): boolean {
  return getAIConfig().visionEnabled;
}
