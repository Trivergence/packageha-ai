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
      // Filter models that support generateContent AND exclude problematic models
      const models = (data.models || [])
        .filter((m: any) => {
          const supportsGenerateContent = m.supportedGenerationMethods?.includes('generateContent');
          if (!supportsGenerateContent) {
            return false;
          }
          
          // Exclude problematic models:
          // - Interaction-only models
          // - Preview/research models (they often have restrictions)
          const modelName = (m.name || '').toLowerCase();
          const displayName = (m.displayName || '').toLowerCase();
          
          const isInteractionOnly = modelName.includes('interactive') || 
                                    modelName.includes('interaction') ||
                                    modelName.includes('live');
          
          const isPreviewOrResearch = modelName.includes('preview') ||
                                      modelName.includes('research') ||
                                      modelName.includes('deep-research') ||
                                      modelName.includes('experimental') ||
                                      displayName.includes('preview') ||
                                      displayName.includes('research');
          
          if (isInteractionOnly) {
            console.log("[listGeminiModels] Excluding Interaction-only model:", m.name);
            return false;
          }
          
          if (isPreviewOrResearch) {
            console.log("[listGeminiModels] Excluding preview/research model:", m.name);
            return false;
          }
          
          return true;
        })
        .map((m: any) => m.name.replace('models/', ''))
        .sort();
      
      console.log("[listGeminiModels] Available models (after filtering):", models);
      return models;
    } catch (error: any) {
      console.error("[listGeminiModels] Error:", error);
      return [];
    }
  }

  /**
   * Get a working Gemini model for TEXT tasks (package matching, conversations)
   * Prioritizes text-optimized models, avoids image-specific models
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
    
    // Filter out image-specific models for text tasks
    const textModels = availableModels.filter(m => {
      const lower = m.toLowerCase();
      // Exclude image-specific models
      return !lower.includes('image') && 
             !lower.includes('nano') && 
             !lower.includes('banana');
    });
    
    // Use text models if available, otherwise fall back to all models
    const modelsToUse = textModels.length > 0 ? textModels : availableModels;
    
    // Priority order for TEXT tasks:
    // 1. gemini-1.5-flash (fast, good for text)
    // 2. gemini-1.5-pro (best quality for text)
    // 3. gemini-pro (reliable fallback)
    // 4. Any flash model (fast)
    // 5. Any 1.5 model (newer)
    // 6. First available
    
    const flash15 = modelsToUse.find(m => m.includes('1.5-flash') && !m.includes('image'));
    if (flash15) {
      console.log("[getWorkingGeminiModel] Selected 1.5-flash for text:", flash15);
      return flash15;
    }
    
    const pro15 = modelsToUse.find(m => m.includes('1.5-pro') && !m.includes('image') && !m.includes('preview'));
    if (pro15) {
      console.log("[getWorkingGeminiModel] Selected 1.5-pro for text:", pro15);
      return pro15;
    }
    
    const pro = modelsToUse.find(m => m.includes('pro') && !m.includes('1.5') && !m.includes('image') && !m.includes('preview'));
    if (pro) {
      console.log("[getWorkingGeminiModel] Selected pro for text:", pro);
      return pro;
    }
    
    // Any flash model (but not image-specific)
    const flash = modelsToUse.find(m => m.toLowerCase().includes('flash') && !m.toLowerCase().includes('image'));
    if (flash) {
      console.log("[getWorkingGeminiModel] Selected flash for text:", flash);
      return flash;
    }
    
    // Any 1.5 model
    const v15 = modelsToUse.find(m => m.includes('1.5') && !m.includes('image'));
    if (v15) {
      console.log("[getWorkingGeminiModel] Selected 1.5 for text:", v15);
      return v15;
    }
    
    console.log("[getWorkingGeminiModel] Using first available model for text:", modelsToUse[0]);
    return modelsToUse[0];
  }

  /**
   * Get best Gemini model for image generation (creative tasks)
   * Prioritizes models that support image generation (Nano Banana = Gemini 2.5 Flash Image)
   * Excludes Interaction-only models and preview/research models
   */
  async getBestImageModel(apiKey: string): Promise<string> {
    const availableModels = await this.listGeminiModels(apiKey);
    
    if (availableModels.length === 0) {
      console.warn("[getBestImageModel] No models available, using fallback");
      return "gemini-2.5-flash-image"; // Nano Banana fallback
    }
    
    // Filter out problematic models:
    // - Interaction-only models
    // - Preview/research models (they often have restrictions)
    // - Models with "deep-research", "preview", "experimental" in name
    const validModels = availableModels.filter(m => {
      const lower = m.toLowerCase();
      return !lower.includes('interactive') && 
             !lower.includes('interaction') &&
             !lower.includes('live') &&
             !lower.includes('preview') &&
             !lower.includes('deep-research') &&
             !lower.includes('research-pro') &&
             !lower.includes('research') &&
             !lower.includes('experimental');
    });
    
    console.log("[getBestImageModel] Valid models after filtering:", validModels);
    
    if (validModels.length === 0) {
      console.warn("[getBestImageModel] No valid models after filtering, using fallback");
      return "gemini-2.5-flash-image"; // Nano Banana fallback
    }
    
    // Prioritize models for image generation (Nano Banana = Gemini 2.5 Flash Image):
    // 1. Models with "2.5" and "image" or "flash" (Nano Banana / Gemini 2.5 Flash Image)
    // 2. Models with "2.5" and "flash"
    // 3. Models with "2.0" and "flash"
    // 4. Models with "1.5" and "pro"
    // 5. Models with "1.5" and "flash"
    // 6. Other models
    
    // Priority 1: 2.5 Flash Image (Nano Banana)
    const flash25Image = validModels.find(m => {
      const lower = m.toLowerCase();
      return (lower.includes('2.5') || lower.includes('2_5')) && 
             (lower.includes('image') || lower.includes('flash'));
    });
    if (flash25Image) {
      console.log("[SovereignSwitch] Selected 2.5 Flash Image (Nano Banana) for image generation:", flash25Image);
      return flash25Image;
    }
    
    // Priority 2: 2.5 Flash
    const flash25 = validModels.find(m => {
      const lower = m.toLowerCase();
      return (lower.includes('2.5') || lower.includes('2_5')) && lower.includes('flash');
    });
    if (flash25) {
      console.log("[SovereignSwitch] Selected 2.5 Flash for image generation:", flash25);
      return flash25;
    }
    
    // Priority 3: 2.0 Flash
    const flash20 = validModels.find(m => m.includes('2.0-flash') || m.includes('2_0-flash'));
    if (flash20) {
      console.log("[SovereignSwitch] Selected 2.0 Flash for image generation:", flash20);
      return flash20;
    }
    
    // Priority 4: 1.5 Pro
    const pro15 = validModels.find(m => m.includes('1.5-pro') && !m.includes('preview'));
    if (pro15) {
      console.log("[SovereignSwitch] Selected 1.5 Pro for image generation:", pro15);
      return pro15;
    }
    
    // Priority 5: 1.5 Flash
    const flash15 = validModels.find(m => m.includes('1.5-flash'));
    if (flash15) {
      console.log("[SovereignSwitch] Selected 1.5 Flash for image generation:", flash15);
      return flash15;
    }
    
    // Priority 6: Any model with "image" in name
    const imageModel = validModels.find(m => m.toLowerCase().includes('image'));
    if (imageModel) {
      console.log("[SovereignSwitch] Selected image model for image generation:", imageModel);
      return imageModel;
    }
    
    // Priority 7: Any other pro model
    const pro = validModels.find(m => m.includes('pro') && !m.includes('1.5') && !m.includes('preview'));
    if (pro) {
      console.log("[SovereignSwitch] Selected pro model for image generation:", pro);
      return pro;
    }
    
    console.log("[SovereignSwitch] Using first valid model for image generation:", validModels[0]);
    return validModels[0];
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

