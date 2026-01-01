/**
 * The Hybrid Sovereign Switch
 * Routes AI calls based on SOVEREIGN_MODE configuration
 */

import { Env, SovereignMode } from "./types";

export interface AIConfig {
  provider: "cloudflare" | "openai" | "gemini" | "vertex" | "local";
  model?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  apiKey?: string;
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
        // Mode A: Cloudflare AI (Legacy - small models)
        return {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct",
        };

      case "COMMERCIAL_OPENAI":
        // Mode A1: OpenAI (ChatGPT) - GPT-4o or GPT-3.5-turbo
        if (!this.env.OPENAI_API_KEY) {
          throw new Error("OPENAI_API_KEY is required for COMMERCIAL_OPENAI mode");
        }
        return {
          provider: "openai",
          model: "gpt-4o-mini", // Cost-effective, fast. Use "gpt-4o" for best quality
          apiKey: this.env.OPENAI_API_KEY,
        };

      case "COMMERCIAL_GEMINI":
        // Mode A2: Google Gemini - Auto-selects working model
        if (!this.env.GEMINI_API_KEY) {
          throw new Error("GEMINI_API_KEY is required for COMMERCIAL_GEMINI mode");
        }
        return {
          provider: "gemini",
          // Model will be auto-selected from available models at runtime
          model: undefined, // Will be determined by getWorkingGeminiModel()
          apiKey: this.env.GEMINI_API_KEY,
        };

      case "SOVEREIGN":
        // Mode B: Google Vertex AI (Dammam Region) via Cloudflare AI Gateway
        return {
          provider: "vertex",
          endpoint: this.env.VERTEX_AI_ENDPOINT || "https://aiplatform.googleapis.com/v1",
          model: "gemini-pro",
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
        // Fallback to Gemini if key available, otherwise Cloudflare AI
        if (this.env.GEMINI_API_KEY) {
          return {
            provider: "gemini",
            model: "gemini-pro",
            apiKey: this.env.GEMINI_API_KEY,
          };
        }
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

        case "openai":
          return await this.callOpenAI(prompt, systemPrompt, config);

        case "gemini":
          return await this.callGemini(prompt, systemPrompt, config);

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

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.env.AI.run(model, { messages });
    return response.response || "";
  }

  private async callOpenAI(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig
  ): Promise<string> {
    const endpoint = "https://api.openai.com/v1/chat/completions";
    
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const payload = {
      model: config.model || "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
      max_tokens: 1024,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * List available Gemini models
   */
  async listGeminiModels(apiKey: string): Promise<string[]> {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      
      const data = await response.json();
      // Filter models that support generateContent
      const models = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''))
        .sort();
      
      return models;
    } catch (error: any) {
      console.error("[listGeminiModels] Error:", error);
      return [];
    }
  }

  /**
   * Get a working Gemini model (tries to find one that works)
   */
  async getWorkingGeminiModel(apiKey: string, preferredModel?: string): Promise<string> {
    // First, try to list available models
    const availableModels = await this.listGeminiModels(apiKey);
    
    if (availableModels.length === 0) {
      // Fallback if list fails
      return preferredModel || "gemini-pro";
    }
    
    // If preferred model is in the list, use it
    if (preferredModel && availableModels.includes(preferredModel)) {
      return preferredModel;
    }
    
    // Prefer models with "flash" in the name (faster, cheaper)
    const flashModels = availableModels.filter(m => m.toLowerCase().includes('flash'));
    if (flashModels.length > 0) {
      return flashModels[0];
    }
    
    // Prefer models with "1.5" in the name (newer)
    const v15Models = availableModels.filter(m => m.includes('1.5'));
    if (v15Models.length > 0) {
      return v15Models[0];
    }
    
    // Fallback to first available model
    return availableModels[0];
  }

  private async callGemini(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig
  ): Promise<string> {
    if (!config.apiKey) {
      throw new Error("Gemini API key is required");
    }
    
    // Get a working model (automatically selects from available models)
    const model = config.model || await this.getWorkingGeminiModel(config.apiKey);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

    // Combine system prompt and user prompt for Gemini
    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n${prompt}`;
    }

    const payload = {
      contents: [{
        parts: [{
          text: fullPrompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private async callVertexAI(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig
  ): Promise<string> {
    // Vertex AI via Cloudflare AI Gateway
    // This would typically go through Cloudflare's AI Gateway for routing
    const endpoint = `${config.endpoint}/projects/${this.env.VERTEX_AI_PROJECT}/locations/${this.env.VERTEX_AI_LOCATION || "asia-southeast1"}/publishers/google/models/${config.model}:predict`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const payload = {
      instances: [{
        messages: messages
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
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const payload = {
      model: config.model,
      messages: messages,
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

