// AI Service Module — configurable OpenAI-compatible endpoint with graceful fallbacks.
// When AI is not configured (no API key), chatCompletion returns null and callers
// should fall back to rule-based logic.

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

let _config: AIConfig | null = null;

/** Load AI configuration from environment variables. */
export function getAIConfig(): AIConfig {
  if (!_config) {
    const apiKey = process.env.AI_API_KEY || "";
    _config = {
      endpoint: process.env.AI_ENDPOINT || "https://api.openai.com/v1",
      apiKey,
      model: process.env.AI_MODEL || "gpt-4o-mini",
      enabled: apiKey.length > 0,
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
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error("AI API request failed:", err);
    return null;
  }
}

/** Check if AI features are available. */
export function isAIEnabled(): boolean {
  return getAIConfig().enabled;
}
