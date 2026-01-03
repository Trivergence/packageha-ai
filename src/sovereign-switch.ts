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
   * @param prompt - The user prompt
   * @param systemPrompt - Optional system prompt
   * @param useImageModel - If true, uses best model for image generation (creative tasks)
   */
  async callAI(prompt: string, systemPrompt?: string, useImageModel: boolean = false): Promise<string> {
    const config = this.getAIConfig();

    try {
      switch (config.provider) {
        case "cloudflare":
          return await this.callCloudflareAI(prompt, systemPrompt, config.model!);

        case "openai":
          return await this.callOpenAI(prompt, systemPrompt, config);

        case "gemini":
          return await this.callGemini(prompt, systemPrompt, config, useImageModel);

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
      
      // Log ALL models from the API (before any filtering)
      const allModels = (data.models || []).map((m: any) => ({
        name: m.name.replace('models/', ''),
        fullName: m.name,
        displayName: m.displayName || '',
        supportedMethods: m.supportedGenerationMethods || []
      }));
      
      console.log("[listGeminiModels] ========== ALL MODELS FROM API ==========");
      console.log("[listGeminiModels] Total models returned:", allModels.length);
      allModels.forEach((m: any, index: number) => {
        console.log(`[listGeminiModels] ${index + 1}. ${m.name}${m.displayName ? ` (${m.displayName})` : ''} - Methods: [${m.supportedMethods.join(', ')}]`);
      });
      console.log("[listGeminiModels] =========================================");
      
      // First, get all models that support generateContent
      const allValidModels = allModels
        .filter((m: any) => m.supportedMethods.includes('generateContent'))
        .map((m: any) => ({
          name: m.name,
          fullName: m.fullName,
          displayName: m.displayName
        }));
      
      console.log("[listGeminiModels] Models supporting generateContent:", allValidModels.length);
      allValidModels.forEach((m: any, index: number) => {
        console.log(`[listGeminiModels]   ${index + 1}. ${m.name}${m.displayName ? ` (${m.displayName})` : ''}`);
      });
      
      // Try strict filtering first (exclude problematic models)
      const strictFiltered = allValidModels.filter((m: any) => {
        const modelName = m.name.toLowerCase();
        const displayName = (m.displayName || '').toLowerCase();
        
        // Exclude Interaction-only models (these definitely don't work)
        const isInteractionOnly = modelName.includes('interactive') || 
                                  modelName.includes('interaction') ||
                                  modelName.includes('live');
        
        if (isInteractionOnly) {
          console.log("[listGeminiModels] Excluding Interaction-only model:", m.name);
          return false;
        }
        
        // Exclude preview/research models (they often have restrictions)
        const isPreviewOrResearch = modelName.includes('preview') ||
                                    modelName.includes('deep-research') ||
                                    modelName.includes('experimental');
        
        if (isPreviewOrResearch) {
          console.log("[listGeminiModels] Excluding preview/research model:", m.name);
          return false;
        }
        
        return true;
      });
      
      console.log("[listGeminiModels] Models after strict filtering:", strictFiltered.length);
      strictFiltered.forEach((m: any, index: number) => {
        console.log(`[listGeminiModels]   ${index + 1}. ${m.name}${m.displayName ? ` (${m.displayName})` : ''}`);
      });
      
      // If strict filtering left us with models, use those
      // Otherwise, fall back to all valid models (less strict)
      const modelsToReturn = strictFiltered.length > 0 ? strictFiltered : allValidModels;
      const modelNames = modelsToReturn.map(m => m.name).sort();
      
      console.log("[listGeminiModels] ========== FINAL AVAILABLE MODELS ==========");
      console.log("[listGeminiModels] Selected models (after filtering):", modelNames);
      console.log("[listGeminiModels] ============================================");
      return modelNames;
    } catch (error: any) {
      console.error("[listGeminiModels] Error:", error);
      return [];
    }
  }

  /**
   * Get a working Gemini model for TEXT tasks (package matching, conversations)
   * HARDCODED: Uses gemini-pro (most reliable, widely available, proven to work)
   * This is the most basic model that definitely works for JSON/text tasks
   */
  async getWorkingGeminiModel(apiKey: string, preferredModel?: string): Promise<string> {
    // Use gemini-pro - the most reliable, basic model that definitely works
    // This was working before and is the most widely available
    const reliableModel = "gemini-pro";
    
    // Verify the model is available, but always fall back to gemini-pro
    try {
      const availableModels = await this.listGeminiModels(apiKey);
      
      // Check if gemini-pro is available
      if (availableModels.includes(reliableModel)) {
        console.log("[getWorkingGeminiModel] Using reliable model:", reliableModel);
        return reliableModel;
      }
      
      // If preferred model is provided and available, use it
      if (preferredModel && availableModels.includes(preferredModel)) {
        console.log("[getWorkingGeminiModel] Using preferred model:", preferredModel);
        return preferredModel;
      }
      
      // Try to find any pro model (not preview, not image)
      const pro = availableModels.find(m => 
        m.includes('pro') && 
        !m.includes('preview') && 
        !m.includes('image') &&
        !m.includes('research')
      );
      if (pro) {
        console.log("[getWorkingGeminiModel] Using available pro model:", pro);
        return pro;
      }
      
      // Try any flash model
      const flash = availableModels.find(m => 
        m.toLowerCase().includes('flash') && 
        !m.includes('preview') && 
        !m.includes('image')
      );
      if (flash) {
        console.log("[getWorkingGeminiModel] Using available flash model:", flash);
        return flash;
      }
      
      // Use first available if we have any
      if (availableModels.length > 0) {
        console.log("[getWorkingGeminiModel] Using first available model:", availableModels[0]);
        return availableModels[0];
      }
    } catch (error) {
      console.warn("[getWorkingGeminiModel] Error checking models, using reliable model:", error);
    }
    
    // Always return gemini-pro as final fallback - it's the most basic and should be available
    console.log("[getWorkingGeminiModel] Using reliable model (gemini-pro):", reliableModel);
    return reliableModel;
  }

  /**
   * Get best Gemini model for image generation (creative tasks)
   * HARDCODED: Uses gemini-2.5-flash-image (Nano Banana) - best for image understanding and generation
   * Based on Google's official recommendations for image tasks
   */
  async getBestImageModel(apiKey: string): Promise<string> {
    // Hardcoded best model for image tasks: gemini-2.5-flash-image (Nano Banana)
    // This model excels at:
    // - Image understanding (can analyze product/package photos)
    // - Image generation (can create detailed image descriptions)
    // - Multimodal tasks combining text and images
    const bestImageModel = "gemini-2.5-flash-image";
    
    // Verify the model is available (optional check)
    try {
      const availableModels = await this.listGeminiModels(apiKey);
      if (availableModels.includes(bestImageModel)) {
        console.log("[getBestImageModel] Using hardcoded best image model (Nano Banana):", bestImageModel);
        return bestImageModel;
      }
      // If not available, try alternatives
      const flash25Image = availableModels.find(m => {
        const lower = m.toLowerCase();
        return (lower.includes('2.5') || lower.includes('2_5')) && lower.includes('image');
      });
      if (flash25Image) {
        console.log("[getBestImageModel] Using alternative 2.5 image model:", flash25Image);
        return flash25Image;
      }
      // Try 2.5 flash as fallback
      const flash25 = availableModels.find(m => {
        const lower = m.toLowerCase();
        return (lower.includes('2.5') || lower.includes('2_5')) && lower.includes('flash');
      });
      if (flash25) {
        console.log("[getBestImageModel] Using alternative 2.5 flash:", flash25);
        return flash25;
      }
    } catch (error) {
      console.warn("[getBestImageModel] Error checking models, using hardcoded:", error);
    }
    
    // Return hardcoded model even if check fails (model should be available)
    console.log("[getBestImageModel] Using hardcoded best image model (Nano Banana, no verification):", bestImageModel);
    return bestImageModel;
  }

  private async callGemini(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig,
    useImageModel: boolean = false
  ): Promise<string> {
    if (!config.apiKey) {
      throw new Error("Gemini API key is required");
    }
    
    // Get appropriate model (best for image generation if requested, otherwise working model)
    let model: string;
    if (useImageModel) {
      model = await this.getBestImageModel(config.apiKey);
      console.log("[SovereignSwitch] Using image-optimized model:", model);
    } else {
      model = config.model || await this.getWorkingGeminiModel(config.apiKey);
      console.log("[SovereignSwitch] Using standard model:", model);
    }
    
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

    // Combine system prompt and user prompt for Gemini
    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n${prompt}`;
    }

    // Higher temperature and more tokens for creative/image generation tasks
    const generationConfig = useImageModel ? {
      temperature: 0.9, // Higher creativity for image prompts
      maxOutputTokens: 2048, // More tokens for detailed descriptions
      topP: 0.95,
      topK: 40
    } : {
      temperature: 0.7,
      maxOutputTokens: 1024,
    };

    const payload = {
      contents: [{
        parts: [{
          text: fullPrompt
        }]
      }],
      generationConfig
    };

    console.log("[SovereignSwitch] Calling Gemini API with model:", model);
    console.log("[SovereignSwitch] Prompt length:", fullPrompt.length);
    console.log("[SovereignSwitch] Generation config:", generationConfig);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[SovereignSwitch] Gemini API error:", response.status, errorText);
      
      // Check if this is an "Interactions API only" error
      if (errorText.includes("Interactions API") || errorText.includes("only supports Interactions")) {
        console.error("[SovereignSwitch] Model only supports Interactions API, trying fallback model");
        
        // Try with Nano Banana (Gemini 2.5 Flash Image) as fallback
        // First, get list of available models to find the best image generation model
        const availableModels = await this.listGeminiModels(config.apiKey);
        
        // Try to find 2.5 Flash Image (Nano Banana) first
        const nanoBananaModel = availableModels.find(m => {
          const lower = m.toLowerCase();
          return (lower.includes('2.5') || lower.includes('2_5')) && 
                 (lower.includes('image') || lower.includes('flash'));
        });
        
        // Fallback models in order of preference
        const fallbackModels = [
          nanoBananaModel,
          availableModels.find(m => {
            const lower = m.toLowerCase();
            return (lower.includes('2.5') || lower.includes('2_5')) && lower.includes('flash');
          }),
          availableModels.find(m => m.includes('2.0-flash')),
          availableModels.find(m => m.includes('1.5-flash')),
          "gemini-2.5-flash-image", // Hard-coded fallback (Nano Banana)
          "gemini-2.0-flash-exp"
        ].filter(m => m); // Remove undefined values
        
        console.log("[SovereignSwitch] Trying fallback models in order:", fallbackModels);
        
        for (const fallbackModel of fallbackModels) {
          try {
            console.log("[SovereignSwitch] Trying fallback model:", fallbackModel);
            const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${config.apiKey}`;
            
            const fallbackResponse = await fetch(fallbackEndpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              const fallbackResult = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text || "";
              console.log("[SovereignSwitch] Fallback model succeeded:", fallbackModel, "response length:", fallbackResult.length);
              return fallbackResult;
            } else {
              const fallbackErrorText = await fallbackResponse.text();
              console.warn("[SovereignSwitch] Fallback model failed:", fallbackModel, fallbackResponse.status, fallbackErrorText);
              // Continue to next fallback
            }
          } catch (fallbackError: any) {
            console.warn("[SovereignSwitch] Fallback model error:", fallbackModel, fallbackError.message);
            // Continue to next fallback
          }
        }
        
        // All fallbacks failed
        throw new Error(`Gemini API error: ${response.status} - ${errorText}. All fallback models failed.`);
      }
      
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("[SovereignSwitch] Gemini response length:", result.length);
    return result;
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

