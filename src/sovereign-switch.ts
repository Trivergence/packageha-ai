/**
 * The Hybrid Sovereign Switch
 * Routes AI calls based on SOVEREIGN_MODE configuration
 */

import { Env, SovereignMode } from "./types";

export interface AIConfig {
  provider: "cloudflare" | "vertex" | "local";
  model?: string;
  endpoint?: string;
  headers?: Record<string, string>;
}

export class SovereignSwitch {
  private mode: SovereignMode;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.mode = (env.SOVEREIGN_MODE || "COMMERCIAL") as SovereignMode;
  }

  /**
   * Get the appropriate AI configuration based on mode
   */
  getAIConfig(): AIConfig {
    switch (this.mode) {
      case "COMMERCIAL":
        // Mode A: Cloudflare AI (OpenAI/Gemini Flash via US)
        return {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct", // Can be upgraded to @cf/google/gemini-flash-1.5-8b
        };

      case "SOVEREIGN":
        // Mode B: Google Vertex AI (Dammam Region) via Cloudflare AI Gateway
        return {
          provider: "vertex",
          endpoint: this.env.VERTEX_AI_ENDPOINT || "https://aiplatform.googleapis.com/v1",
          model: "gemini-pro", // Or llama-3 for legal reasoning
          headers: {
            "Authorization": `Bearer ${this.env.VERTEX_AI_PROJECT}`,
            "Content-Type": "application/json",
          },
        };

      case "AIR_GAPPED":
        // Mode C: Local Llama 3.1 GPU server via Docker
        return {
          provider: "local",
          endpoint: this.env.LOCAL_LLAMA_ENDPOINT || "http://localhost:8080/v1/chat/completions",
          model: "llama-3.1-70b",
        };

      default:
        // Fallback to commercial
        return {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct",
        };
    }
  }

  /**
   * Execute AI call through the appropriate provider
   */
  async callAI(prompt: string, systemPrompt?: string): Promise<string> {
    const config = this.getAIConfig();

    try {
      switch (config.provider) {
        case "cloudflare":
          return await this.callCloudflareAI(prompt, systemPrompt, config.model!);

        case "vertex":
          return await this.callVertexAI(prompt, systemPrompt, config);

        case "local":
          return await this.callLocalAI(prompt, systemPrompt, config);

        default:
          throw new Error(`Unknown provider: ${config.provider}`);
      }
    } catch (error: any) {
      console.error(`[SovereignSwitch] Error in ${config.provider}:`, error);
      throw new Error(`AI call failed: ${error.message}`);
    }
  }

  private async callCloudflareAI(
    prompt: string,
    systemPrompt: string | undefined,
    model: string
  ): Promise<string> {
    if (!this.env.AI) {
      throw new Error("Cloudflare AI binding not available");
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.env.AI.run(model, { messages });
    return response.response || "";
  }

  private async callVertexAI(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig
  ): Promise<string> {
    // Vertex AI via Cloudflare AI Gateway
    // This would typically go through Cloudflare's AI Gateway for routing
    const endpoint = `${config.endpoint}/projects/${this.env.VERTEX_AI_PROJECT}/locations/${this.env.VERTEX_AI_LOCATION || "asia-southeast1"}/publishers/google/models/${config.model}:predict`;

    const payload = {
      instances: [{
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ]
      }],
      parameters: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: config.headers || {},
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Vertex AI error: ${response.status}`);
    }

    const data = await response.json();
    return data.predictions?.[0]?.content || "";
  }

  private async callLocalAI(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig
  ): Promise<string> {
    // Local Llama server (OpenAI-compatible API)
    const payload = {
      model: config.model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
    };

    const response = await fetch(config.endpoint!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Local AI error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * Get current mode for logging/debugging
   */
  getMode(): SovereignMode {
    return this.mode;
  }
}

