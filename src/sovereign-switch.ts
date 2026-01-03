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
   * 
   * TASK ANALYSIS:
   * - Complex reasoning: Analyze product specs (dimensions, weight, fragility, budget, material)
   * - Multi-factor matching: Match products to packages considering multiple criteria
   * - Structured JSON output: Must return valid JSON with type, matches array, reasons
   * - Bilingual support: Handle English and Arabic product names
   * - Large context: Process inventory lists + product information
   * 
   * BEST MODEL: gemini-2.5-pro
   * - Superior reasoning capabilities for complex multi-factor analysis
   * - Excellent structured output (JSON) with high accuracy
   * - 1M token context window for large inventories
   * - Best quality for matching tasks requiring deep understanding
   * 
   * FALLBACK: gemini-2.5-flash (faster, good quality)
   * FALLBACK 2: gemini-pro-latest (widely available)
   */
  async getWorkingGeminiModel(apiKey: string, preferredModel?: string): Promise<string> {
    // Primary: gemini-2.5-pro - Best for complex reasoning and structured JSON output
    const bestModel = "gemini-2.5-pro";
    
    // Fallback 1: gemini-2.5-flash - Fast, good quality for text tasks
    const fallback1 = "gemini-2.5-flash";
    
    // Fallback 2: gemini-pro-latest - Widely available, reliable
    const fallback2 = "gemini-pro-latest";
    
    try {
      const availableModels = await this.listGeminiModels(apiKey);
      
      // Try best model first
      if (availableModels.includes(bestModel)) {
        console.log("[getWorkingGeminiModel] Using BEST model for text tasks (complex reasoning + JSON):", bestModel);
        return bestModel;
      }
      
      // Try fallback 1
      if (availableModels.includes(fallback1)) {
        console.log("[getWorkingGeminiModel] Using fallback 1 (fast, good quality):", fallback1);
        return fallback1;
      }
      
      // Try fallback 2
      if (availableModels.includes(fallback2)) {
        console.log("[getWorkingGeminiModel] Using fallback 2 (widely available):", fallback2);
        return fallback2;
      }
      
      // If preferred model is provided and available, use it
      if (preferredModel && availableModels.includes(preferredModel)) {
        console.log("[getWorkingGeminiModel] Using preferred model:", preferredModel);
        return preferredModel;
      }
      
      // Try to find any 2.5-pro variant (not preview, not image)
      const pro25 = availableModels.find(m => 
        m.includes('2.5-pro') && 
        !m.includes('preview') && 
        !m.includes('image')
      );
      if (pro25) {
        console.log("[getWorkingGeminiModel] Using alternative 2.5-pro:", pro25);
        return pro25;
      }
      
      // Try to find any 2.5-flash variant (not preview, not image)
      const flash25 = availableModels.find(m => 
        m.includes('2.5-flash') && 
        !m.includes('preview') && 
        !m.includes('image')
      );
      if (flash25) {
        console.log("[getWorkingGeminiModel] Using alternative 2.5-flash:", flash25);
        return flash25;
      }
      
      // Try any pro model (not preview, not image)
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
      
      // Use first available if we have any
      if (availableModels.length > 0) {
        console.log("[getWorkingGeminiModel] Using first available model:", availableModels[0]);
        return availableModels[0];
      }
    } catch (error) {
      console.warn("[getWorkingGeminiModel] Error checking models, using best model:", error);
    }
    
    // Return best model as final fallback
    console.log("[getWorkingGeminiModel] Using best model (gemini-2.5-pro):", bestModel);
    return bestModel;
  }

  /**
   * Get best Gemini model for image generation (creative tasks)
   * 
   * TASK ANALYSIS:
   * - Image understanding: Analyze product photos and package images
   * - Creative generation: Generate detailed, professional image descriptions
   * - Multimodal processing: Combine text prompts with image inputs
   * - Style specification: Create prompts for DALL-E/Midjourney/Stable Diffusion
   * - Professional quality: High-quality visual descriptions with lighting, composition details
   * 
   * BEST MODEL: gemini-2.5-flash-image (Nano Banana)
   * - Specifically designed for image understanding and generation
   * - Optimized for rapid creative workflows
   * - Supports multimodal inputs (text + images)
   * - Best balance of speed and quality for image tasks
   * 
   * FALLBACK: gemini-3-pro-image-preview (Nano Banana Pro) - Higher quality but preview
   * FALLBACK 2: gemini-2.5-flash - Good for text-to-image description generation
   */
  async getBestImageModel(apiKey: string): Promise<string> {
    // Primary: gemini-2.5-flash-image (Nano Banana) - Best for image understanding + generation
    const bestImageModel = "gemini-2.5-flash-image";
    
    // Fallback 1: gemini-3-pro-image-preview (Nano Banana Pro) - Higher quality but preview
    const fallback1 = "gemini-3-pro-image-preview";
    
    // Fallback 2: nano-banana-pro-preview - Alternative Nano Banana Pro
    const fallback2 = "nano-banana-pro-preview";
    
    // Fallback 3: gemini-2.5-flash - Good for text-to-image description
    const fallback3 = "gemini-2.5-flash";
    
    try {
      const availableModels = await this.listGeminiModels(apiKey);
      
      // Try best model first
      if (availableModels.includes(bestImageModel)) {
        console.log("[getBestImageModel] Using BEST model for image tasks (Nano Banana):", bestImageModel);
        return bestImageModel;
      }
      
      // Try fallback 1 (Nano Banana Pro - preview)
      if (availableModels.includes(fallback1)) {
        console.log("[getBestImageModel] Using fallback 1 (Nano Banana Pro - preview):", fallback1);
        return fallback1;
      }
      
      // Try fallback 2 (alternative Nano Banana Pro)
      if (availableModels.includes(fallback2)) {
        console.log("[getBestImageModel] Using fallback 2 (Nano Banana Pro - alternative):", fallback2);
        return fallback2;
      }
      
      // Try fallback 3 (2.5 Flash - good for text-to-image)
      if (availableModels.includes(fallback3)) {
        console.log("[getBestImageModel] Using fallback 3 (2.5 Flash):", fallback3);
        return fallback3;
      }
      
      // Try to find any 2.5-flash-image variant
      const flash25Image = availableModels.find(m => {
        const lower = m.toLowerCase();
        return (lower.includes('2.5') || lower.includes('2_5')) && 
               lower.includes('image') && 
               !lower.includes('preview');
      });
      if (flash25Image) {
        console.log("[getBestImageModel] Using alternative 2.5-flash-image:", flash25Image);
        return flash25Image;
      }
      
      // Try any image model (not preview)
      const imageModel = availableModels.find(m => {
        const lower = m.toLowerCase();
        return lower.includes('image') && !lower.includes('preview');
      });
      if (imageModel) {
        console.log("[getBestImageModel] Using alternative image model:", imageModel);
        return imageModel;
      }
      
      // Try 2.5 flash as last resort
      const flash25 = availableModels.find(m => {
        const lower = m.toLowerCase();
        return (lower.includes('2.5') || lower.includes('2_5')) && lower.includes('flash');
      });
      if (flash25) {
        console.log("[getBestImageModel] Using 2.5 flash as last resort:", flash25);
        return flash25;
      }
    } catch (error) {
      console.warn("[getBestImageModel] Error checking models, using best model:", error);
    }
    
    // Return best model as final fallback
    console.log("[getBestImageModel] Using best model (Nano Banana, no verification):", bestImageModel);
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
   * Generate an actual image using Gemini's image generation capabilities
   * This method creates a visual representation showing the product inside the package
   */
  async generateImage(
    prompt: string,
    apiKey: string,
    productImageUrl?: string,
    packageImageUrl?: string
  ): Promise<string> {
    console.log("[SovereignSwitch] generateImage called with prompt length:", prompt.length);
    console.log("[SovereignSwitch] Product image URL:", productImageUrl);
    console.log("[SovereignSwitch] Package image URL:", packageImageUrl);
    
    // Use the best image generation model
    const model = await this.getBestImageModel(apiKey);
    console.log("[SovereignSwitch] Using image generation model:", model);
    
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Build multimodal prompt with images if available
    const parts: any[] = [];
    
    // Add product image if available
    if (productImageUrl) {
      try {
        const productImageResponse = await fetch(productImageUrl);
        const productImageBuffer = await productImageResponse.arrayBuffer();
        const productImageBase64 = btoa(String.fromCharCode(...new Uint8Array(productImageBuffer)));
        const productImageMimeType = productImageResponse.headers.get('content-type') || 'image/jpeg';
        
        parts.push({
          inlineData: {
            mimeType: productImageMimeType,
            data: productImageBase64
          }
        });
        console.log("[SovereignSwitch] Added product image to prompt");
      } catch (error: any) {
        console.warn("[SovereignSwitch] Failed to load product image:", error.message);
      }
    }
    
    // Add package image if available
    if (packageImageUrl) {
      try {
        const packageImageResponse = await fetch(packageImageUrl);
        const packageImageBuffer = await packageImageResponse.arrayBuffer();
        const packageImageBase64 = btoa(String.fromCharCode(...new Uint8Array(packageImageBuffer)));
        const packageImageMimeType = packageImageResponse.headers.get('content-type') || 'image/jpeg';
        
        parts.push({
          inlineData: {
            mimeType: packageImageMimeType,
            data: packageImageBase64
          }
        });
        console.log("[SovereignSwitch] Added package image to prompt");
      } catch (error: any) {
        console.warn("[SovereignSwitch] Failed to load package image:", error.message);
      }
    }
    
    // Add text prompt - explicitly request image generation
    parts.push({
      text: `Generate an image showing: ${prompt}\n\nCreate a high-quality, professional product photography image that clearly shows the product inside or with the package. The image should be realistic, well-lit, and suitable for e-commerce and marketing purposes.`
    });
    
    const payload = {
      contents: [{
        parts: parts
      }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048,
        topP: 0.95,
        topK: 40
      }
    };
    
    console.log("[SovereignSwitch] Sending image generation request with", parts.length, "parts");
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[SovereignSwitch] Image generation error:", response.status, errorText);
      throw new Error(`Image generation failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log("[SovereignSwitch] Image generation response keys:", Object.keys(data));
    console.log("[SovereignSwitch] Full response (first 2000 chars):", JSON.stringify(data).substring(0, 2000));
    
    // Check for image data in the response
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidate in response: " + JSON.stringify(data).substring(0, 500));
    }
    
    if (!candidate.content?.parts) {
      throw new Error("No parts in candidate content: " + JSON.stringify(candidate).substring(0, 500));
    }
    
    console.log("[SovereignSwitch] Number of parts in response:", candidate.content.parts.length);
    
    // Look for image data in the response parts
    for (let i = 0; i < candidate.content.parts.length; i++) {
      const part = candidate.content.parts[i];
      console.log(`[SovereignSwitch] Part ${i} keys:`, Object.keys(part));
      
      // Check for inline data (base64 image) - this is how Gemini returns generated images
      if (part.inlineData) {
        const imageData = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        console.log("[SovereignSwitch] Found generated image in response (mimeType:", mimeType, ", data length:", imageData?.length || 0, ")");
        // Return as data URL
        return `data:${mimeType};base64,${imageData}`;
      }
      
      // Check for image URL (if Gemini returns URLs)
      if (part.url) {
        console.log("[SovereignSwitch] Found image URL in response:", part.url);
        return part.url;
      }
    }
    
    // If no image found, check for text (might be an error message or description)
    const textResponse = candidate.content.parts.find((p: any) => p.text)?.text;
    if (textResponse) {
      console.log("[SovereignSwitch] Model returned text instead of image:", textResponse.substring(0, 200));
      // Some image models might return text descriptions - log this for debugging
      throw new Error(`Model returned text instead of image: ${textResponse.substring(0, 100)}`);
    }
    
    throw new Error("No image data found in response. Response structure: " + JSON.stringify(data).substring(0, 1000));
  }

  /**
   * Get current mode for logging/debugging
   */
  getMode(): SovereignMode {
    return this.mode;
  }
}

