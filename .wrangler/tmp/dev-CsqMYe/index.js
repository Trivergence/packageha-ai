var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/shopify.ts
async function getActiveProducts(shopUrl, token) {
  const cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, "").replace(/\/$/, "");
  const url = `https://${cleanShop}/admin/api/2024-01/products.json?status=active&limit=50`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API Error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    return data.products || [];
  } catch (error) {
    console.error("[getActiveProducts] Error:", error);
    throw new Error(`Failed to fetch products: ${error.message}`);
  }
}
__name(getActiveProducts, "getActiveProducts");
async function createDraftOrder(shopUrl, token, variantId, qty, note = "", customLineItems) {
  const cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, "").replace(/\/$/, "");
  const url = `https://${cleanShop}/admin/api/2024-01/draft_orders.json`;
  const lineItems = [];
  if (variantId) {
    lineItems.push({
      variant_id: variantId,
      quantity: qty
    });
  }
  if (customLineItems && customLineItems.length > 0) {
    customLineItems.forEach((item) => {
      lineItems.push({
        title: item.title,
        price: item.price,
        quantity: item.quantity
      });
    });
  }
  if (lineItems.length === 0) {
    throw new Error("At least one line item (product variant or custom item) is required");
  }
  const payload = {
    draft_order: {
      line_items: lineItems,
      note: note.trim(),
      tags: "studium-ai-generated"
    }
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API Error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    const draftOrderId = data.draft_order?.id;
    if (!draftOrderId) {
      throw new Error("No draft order ID returned from Shopify");
    }
    const adminUrl = `https://${cleanShop}/admin/draft_orders/${draftOrderId}`;
    return {
      draftOrderId,
      adminUrl,
      invoiceUrl: data.draft_order?.invoice_url
    };
  } catch (error) {
    console.error("[createDraftOrder] Error:", error);
    throw new Error(`Failed to create draft order: ${error.message}`);
  }
}
__name(createDraftOrder, "createDraftOrder");

// src/charter.ts
var SALES_CHARTER = {
  meta: {
    name: "Packageha Sales Associate",
    tone: "Professional, thorough, and consultative. Always helpful, never pushy.",
    version: "3.0"
  },
  // PHASE 1: FINDING THE PACKAGE (Packageha's packages, not client's product)
  discovery: {
    mission: "Find the best match ID for the user's request from the provided inventory list.",
    rules: [
      "IGNORE prefixes like 'TEST' or 'rs-' in package titles.",
      "MATCH LOOSELY: 'Box' matches 'Custom Box Calculator'. 'Photo' matches '\u062E\u062F\u0645\u0629 \u062A\u0635\u0648\u064A\u0631'.",
      "If multiple matches exist, pick the most relevant one based on the user's specific keywords.",
      "Be culturally aware - support both English and Arabic product names.",
      "If the user is just greeting or chatting, respond warmly but guide them to search.",
      "Return ONLY a JSON object with 'type' and relevant fields. NO MARKDOWN."
    ]
  },
  // PHASE 2: REFINING THE OPTION
  variant: {
    mission: "Identify which specific product option (variant) the user wants.",
    rules: [
      "Analyze the user's input against the provided Options list.",
      "Match by keywords, synonyms, or partial matches.",
      "If the user wants to switch products entirely, return 'RESTART'.",
      "If unclear, ask for clarification by listing the available options.",
      "Return ONLY a JSON object. NO MARKDOWN."
    ]
  },
  // STEP 1: Product Details - Information about what goes inside the package
  productDetails: {
    mission: "Collect information about the product that will go inside the package to help recommend the right packaging solution.",
    steps: [
      {
        id: "product_description",
        question: "First, tell me about your product. What is it? What does it do?"
      },
      {
        id: "product_dimensions",
        question: "What are your product dimensions? (Length x Width x Height in cm or inches)",
        validation: /* @__PURE__ */ __name((answer) => {
          const hasNumbers = /\d/.test(answer);
          if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
          return true;
        }, "validation")
      },
      {
        id: "product_weight",
        question: "Approximately how much does your product weigh? (grams or ounces)"
      },
      {
        id: "fragility",
        question: "Is your product fragile? Does it need special protection?",
        options: ["Not fragile", "Somewhat fragile", "Very fragile", "Needs cushioning/protection"],
        multiple: false
      },
      {
        id: "budget",
        question: "What's your budget range for packaging? (per unit or total)",
        options: ["Under 1 SAR/unit", "1-5 SAR/unit", "5-10 SAR/unit", "10-20 SAR/unit", "20+ SAR/unit", "Budget flexible", "Will discuss"],
        multiple: false
      }
    ]
  },
  // STEP 2: Package Selection - Packageha package search/selection with specifications
  // This uses discovery + variant for finding the Packageha package, then collects package specs
  // Note: "package" here refers to Packageha's packages (what we sell), NOT the client's product
  packageSpecs: {
    mission: "Collect package specifications (material, dimensions, print) after Packageha package is selected.",
    steps: [
      {
        id: "material",
        question: "Do you have a preference for Material?",
        options: ["Corrugated", "Folding Carton", "Rigid Box", "Paperboard", "Kraft", "White Cardboard"],
        multiple: false
        // Single selection (radio buttons)
      },
      {
        id: "dimensions",
        question: "What are the internal Dimensions for the package? (Length x Width x Height in cm or inches)",
        validation: /* @__PURE__ */ __name((answer) => {
          const hasNumbers = /\d/.test(answer);
          if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
          return true;
        }, "validation")
      },
      {
        id: "print",
        question: "Tell me about the Printing/Finish.",
        // Grouped options: first array is mutually exclusive (radio), second array can be combined (checkboxes)
        options: [
          // Printing type - mutually exclusive (choose one)
          ["Full color printing", "Logo only", "No printing"],
          // Finishing options - can be combined (select multiple)
          ["Gold foil", "Silver foil", "Matte lamination", "Glossy lamination", "UV coating", "Embossing", "Debossing"]
        ],
        multiple: "grouped"
        // Special mode: first group is radio, second group is checkboxes
      }
    ]
  },
  // STEP 3: Fulfilment Specs - Order fulfillment information
  fulfillmentSpecs: {
    mission: "Collect all information needed for order fulfillment and delivery.",
    steps: [
      {
        id: "quantity",
        question: "What quantity would you like to order?",
        validation: /* @__PURE__ */ __name((answer) => {
          const match = answer.match(/(\d+(?:\.\d+)?)/);
          if (!match) {
            return "Please provide a valid quantity (e.g., 100, 500, 1000).";
          }
          const num = Math.floor(parseFloat(match[1]));
          if (!num || num < 1) {
            return "Please provide a valid quantity (e.g., 100, 500, 1000).";
          }
          return true;
        }, "validation")
      },
      {
        id: "timeline",
        question: "When is your deadline for delivery?",
        options: ["1-2 weeks", "2-4 weeks", "1-2 months", "2-3 months", "3+ months", "Flexible"],
        multiple: false
      },
      {
        id: "shipping_address",
        question: "Where should we deliver the order? (Please provide shipping address or city/region)"
      },
      {
        id: "special_instructions",
        question: "Any special fulfillment instructions or requirements? (optional - type 'none' to skip)"
      }
    ]
  },
  // STEP 4: Launch Kit - Brand launch services
  launchKit: {
    mission: "Offer and collect information for brand launch services.",
    steps: [
      {
        id: "service_selection",
        question: "Would you like to add any brand launch services? (Select all that apply)",
        options: [
          "Hero shot photography",
          "Stop-motion unboxing video",
          "E-commerce product photos",
          "3D render with packaging for website",
          "Package design consultation",
          "Brand styling consultation",
          "None - skip launch services"
        ],
        multiple: true
        // Checkboxes - can select multiple
      },
      {
        id: "service_timeline",
        question: "What's your timeline for these services?",
        options: ["ASAP", "1-2 weeks", "2-4 weeks", "1-2 months", "Flexible"],
        multiple: false
      },
      {
        id: "service_notes",
        question: "Any specific requirements or details for the launch services? (optional - type 'none' to skip)"
      }
    ]
  },
  // Legacy consultation - kept for backward compatibility but not used in new flow
  consultation: {
    mission: "Legacy - not used in new flow structure",
    steps: []
  }
};
var PACKAGE_ORDER_CHARTER = {
  meta: {
    name: "Packageha Package Ordering Assistant",
    tone: "Professional, efficient, and helpful. Guide users to order packages quickly.",
    version: "1.0"
  },
  discovery: {
    mission: "Help user select a package from the available catalog.",
    rules: SALES_CHARTER.discovery.rules
    // Reuse discovery rules
  },
  variant: {
    mission: "Help user select package variant.",
    rules: SALES_CHARTER.variant.rules
    // Reuse variant rules
  },
  consultation: {
    mission: "Collect package order details efficiently.",
    steps: [
      {
        id: "quantity",
        question: "What quantity would you like to order?",
        validation: SALES_CHARTER.consultation.steps[0]?.validation
      },
      {
        id: "notes",
        question: "Any special requirements or notes for this order? (optional - type 'none' to skip)"
      }
    ]
  }
};
var LAUNCH_KIT_CHARTER = {
  meta: {
    name: "Packageha Launch Kit Assistant",
    tone: "Professional and consultative. Help clients select studio services for their products.",
    version: "1.0"
  },
  discovery: {
    mission: "Present Launch Kit services to the user.",
    rules: [
      "Present services clearly and professionally.",
      "Explain what each service includes.",
      "Help user understand which services they need."
    ]
  },
  variant: SALES_CHARTER.variant,
  // Not used but required by interface
  consultation: {
    mission: "Collect project details for Launch Kit services.",
    steps: [
      {
        id: "services",
        question: "Which services would you like? (Product Photography, Package Design, Brand Consultation)"
      },
      {
        id: "product_info",
        question: "Tell me about your product(s) - name, description, or what you're launching."
      },
      {
        id: "timeline",
        question: "What's your target timeline for this project?"
      },
      {
        id: "budget",
        question: "Do you have a budget range for this project?"
      },
      {
        id: "notes",
        question: "Any additional requirements or special requests?"
      }
    ]
  }
};
var PACKAGING_ASSISTANT_CHARTER = {
  meta: {
    name: "Packageha Packaging Consultant",
    tone: "Consultative and expert. Help users understand their packaging needs and recommend the best solutions.",
    version: "1.0"
  },
  discovery: {
    mission: "Understand the user's product and packaging needs.",
    rules: [
      "Ask clarifying questions to understand the product.",
      "Be thorough but conversational.",
      "Collect all necessary information before recommending."
    ]
  },
  variant: SALES_CHARTER.variant,
  // Not used but required
  consultation: {
    mission: "Collect product information to recommend the best packaging solution.",
    steps: [
      {
        id: "product_description",
        question: "First, tell me about your product. What is it? What does it do?"
      },
      {
        id: "dimensions",
        question: "What are the product dimensions? (Length x Width x Height in cm or inches)",
        validation: /* @__PURE__ */ __name((answer) => {
          const hasNumbers = /\d/.test(answer);
          if (!hasNumbers) return "Please include dimensions with numbers (e.g., 20x15x10 cm).";
          return true;
        }, "validation")
      },
      {
        id: "weight",
        question: "Approximately how much does it weigh? (grams or ounces)"
      },
      {
        id: "fragility",
        question: "Is the product fragile? Does it need special protection?"
      },
      {
        id: "brand_requirements",
        question: "Any specific branding or design requirements? (logo, colors, finish)"
      },
      {
        id: "budget",
        question: "What's your budget range for packaging? (per unit or total)"
      },
      {
        id: "quantity",
        question: "What quantity are you planning to order?",
        validation: /* @__PURE__ */ __name((answer) => {
          const match = answer.match(/(\d+(?:\.\d+)?)/);
          if (!match) return "Please provide a quantity (e.g., 100, 500, 1000).";
          return true;
        }, "validation")
      }
    ]
  }
};
function buildCharterPrompt(phase, charter = SALES_CHARTER) {
  let prompt = `You are ${charter.meta.name}. ${charter.meta.tone}

`;
  if (phase === "discovery") {
    prompt += `MISSION: ${charter.discovery.mission}

`;
    prompt += `RULES:
${charter.discovery.rules.map((r) => `- ${r}`).join("\n")}
`;
  } else if (phase === "variant") {
    prompt += `MISSION: ${charter.variant.mission}

`;
    prompt += `RULES:
${charter.variant.rules.map((r) => `- ${r}`).join("\n")}
`;
  } else if (phase === "consultation") {
    prompt += `MISSION: ${charter.consultation.mission}

`;
  }
  prompt += `
Always follow these rules strictly. Return valid JSON only.`;
  return prompt;
}
__name(buildCharterPrompt, "buildCharterPrompt");

// src/sovereign-switch.ts
var SovereignSwitch = class {
  static {
    __name(this, "SovereignSwitch");
  }
  mode;
  env;
  constructor(env) {
    this.env = env;
    this.mode = env.SOVEREIGN_MODE || "COMMERCIAL";
  }
  /**
   * Get the appropriate AI configuration based on mode
   */
  getAIConfig() {
    switch (this.mode) {
      case "COMMERCIAL":
        return {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct"
        };
      case "COMMERCIAL_OPENAI":
        if (!this.env.OPENAI_API_KEY) {
          throw new Error("OPENAI_API_KEY is required for COMMERCIAL_OPENAI mode");
        }
        return {
          provider: "openai",
          model: "gpt-4o-mini",
          // Cost-effective, fast. Use "gpt-4o" for best quality
          apiKey: this.env.OPENAI_API_KEY
        };
      case "COMMERCIAL_GEMINI":
        if (!this.env.GEMINI_API_KEY) {
          throw new Error("GEMINI_API_KEY is required for COMMERCIAL_GEMINI mode");
        }
        return {
          provider: "gemini",
          // Model will be auto-selected from available models at runtime
          model: void 0,
          // Will be determined by getWorkingGeminiModel()
          apiKey: this.env.GEMINI_API_KEY
        };
      case "SOVEREIGN":
        return {
          provider: "vertex",
          endpoint: this.env.VERTEX_AI_ENDPOINT || "https://aiplatform.googleapis.com/v1",
          model: "gemini-pro",
          headers: {
            "Authorization": `Bearer ${this.env.VERTEX_AI_PROJECT}`,
            "Content-Type": "application/json"
          }
        };
      case "AIR_GAPPED":
        return {
          provider: "local",
          endpoint: this.env.LOCAL_LLAMA_ENDPOINT || "http://localhost:8080/v1/chat/completions",
          model: "llama-3.1-70b"
        };
      default:
        if (this.env.GEMINI_API_KEY) {
          return {
            provider: "gemini",
            model: "gemini-pro",
            apiKey: this.env.GEMINI_API_KEY
          };
        }
        return {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct"
        };
    }
  }
  /**
   * Execute AI call through the appropriate provider
   */
  async callAI(prompt, systemPrompt) {
    const config = this.getAIConfig();
    try {
      switch (config.provider) {
        case "cloudflare":
          return await this.callCloudflareAI(prompt, systemPrompt, config.model);
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
    } catch (error) {
      console.error(`[SovereignSwitch] Error in ${config.provider}:`, error);
      throw new Error(`AI call failed: ${error.message}`);
    }
  }
  async callCloudflareAI(prompt, systemPrompt, model) {
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
  async callOpenAI(prompt, systemPrompt, config) {
    const endpoint = "https://api.openai.com/v1/chat/completions";
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const payload = {
      model: config.model || "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 1024
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
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
  async listGeminiModels(apiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      const data = await response.json();
      const models = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace("models/", "")).sort();
      return models;
    } catch (error) {
      console.error("[listGeminiModels] Error:", error);
      return [];
    }
  }
  /**
   * Get a working Gemini model (tries to find one that works)
   */
  async getWorkingGeminiModel(apiKey, preferredModel) {
    const availableModels = await this.listGeminiModels(apiKey);
    if (availableModels.length === 0) {
      return preferredModel || "gemini-pro";
    }
    if (preferredModel && availableModels.includes(preferredModel)) {
      return preferredModel;
    }
    const flashModels = availableModels.filter((m) => m.toLowerCase().includes("flash"));
    if (flashModels.length > 0) {
      return flashModels[0];
    }
    const v15Models = availableModels.filter((m) => m.includes("1.5"));
    if (v15Models.length > 0) {
      return v15Models[0];
    }
    return availableModels[0];
  }
  async callGemini(prompt, systemPrompt, config) {
    if (!config.apiKey) {
      throw new Error("Gemini API key is required");
    }
    const model = config.model || await this.getWorkingGeminiModel(config.apiKey);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}

${prompt}`;
    }
    const payload = {
      contents: [{
        parts: [{
          text: fullPrompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
  async callVertexAI(prompt, systemPrompt, config) {
    const endpoint = `${config.endpoint}/projects/${this.env.VERTEX_AI_PROJECT}/locations/${this.env.VERTEX_AI_LOCATION || "asia-southeast1"}/publishers/google/models/${config.model}:predict`;
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const payload = {
      instances: [{
        messages
      }],
      parameters: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: config.headers || {},
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Vertex AI error: ${response.status}`);
    }
    const data = await response.json();
    return data.predictions?.[0]?.content || "";
  }
  async callLocalAI(prompt, systemPrompt, config) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const payload = {
      model: config.model,
      messages,
      temperature: 0.7
    };
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
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
  getMode() {
    return this.mode;
  }
};

// src/session.ts
var DEFAULT_MEMORY_TEMPLATE = {
  flow: "direct_sales",
  step: "start",
  clipboard: {},
  questionIndex: 0
};
var GREETINGS = ["hi", "hello", "hey", "hola", "\u0645\u0631\u062D\u0628\u0627", "\u0647\u0644\u0627", "\u0623\u0647\u0644\u0627"];
var RESET_KEYWORDS = ["reset", "\u0625\u0639\u0627\u062F\u0629", "start over", "new", "\u062C\u062F\u064A\u062F"];
var PackagehaSession = class {
  static {
    __name(this, "PackagehaSession");
  }
  state;
  env;
  sovereignSwitch;
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sovereignSwitch = new SovereignSwitch(env);
  }
  async fetch(request) {
    try {
      const body = await this.parseRequestBody(request);
      const userMessage = (body.message || "").trim();
      if (this.shouldReset(userMessage) || body.reset === true) {
        return await this.handleReset();
      }
      let memory = await this.loadMemory();
      const oneHourAgo = Date.now() - 60 * 60 * 1e3;
      if (memory.lastActivity && memory.lastActivity < oneHourAgo) {
        console.log("[PackagehaSession] Stale session detected (older than 1 hour) - resetting");
        await this.state.storage.delete("memory");
        memory = await this.loadMemory();
      }
      const requestedFlow = body.flow || memory.flow || "direct_sales";
      if (!memory.flow || memory.flow !== requestedFlow) {
        memory.flow = requestedFlow;
        memory.step = "start";
        memory.clipboard = {};
        memory.questionIndex = 0;
      }
      const hasProductDetails = memory.clipboard && (memory.clipboard["product_description"] || memory.clipboard["product_dimensions"] || memory.clipboard["product_weight"]);
      if ((memory.step === "select_package_specs" || memory.step === "select_package_variant" || memory.step === "fulfillment_specs" || memory.step === "launch_kit") && !memory.packageId) {
        console.log("[PackagehaSession] Invalid memory state: in package steps without package selected - resetting to start");
        memory.step = "start";
        memory.questionIndex = 0;
        memory.clipboard = {};
      } else if ((memory.step === "select_package" || memory.step === "select_package_discovery") && !hasProductDetails) {
        console.log("[PackagehaSession] Invalid memory state: in package selection without product details - resetting to product_details");
        memory.step = "product_details";
        memory.questionIndex = 0;
      }
      let reply;
      let memoryWasReset = false;
      let draftOrder = void 0;
      let productMatches = void 0;
      switch (memory.flow) {
        case "direct_sales":
          const directSalesResult = await this.handleDirectSalesFlow(userMessage, memory);
          reply = directSalesResult.reply;
          memoryWasReset = directSalesResult.memoryReset || false;
          draftOrder = directSalesResult.draftOrder;
          productMatches = directSalesResult.productMatches;
          break;
        case "package_order":
          const packageOrderResult = await this.handlePackageOrderFlow(userMessage, memory);
          reply = packageOrderResult.reply;
          memoryWasReset = packageOrderResult.memoryReset || false;
          draftOrder = packageOrderResult.draftOrder;
          productMatches = packageOrderResult.productMatches;
          break;
        case "launch_kit":
          const launchKitResult = await this.handleLaunchKitFlow(userMessage, memory);
          reply = launchKitResult.reply;
          memoryWasReset = launchKitResult.memoryReset || false;
          draftOrder = launchKitResult.draftOrder;
          break;
        case "packaging_assistant":
          const assistantResult = await this.handlePackagingAssistantFlow(userMessage, memory);
          reply = assistantResult.reply;
          memoryWasReset = assistantResult.memoryReset || false;
          break;
        default:
          reply = "I'm not sure what to do. Type 'reset' to start over.";
          const now = Date.now();
          memory = {
            flow: DEFAULT_MEMORY_TEMPLATE.flow,
            step: DEFAULT_MEMORY_TEMPLATE.step,
            clipboard: {},
            questionIndex: DEFAULT_MEMORY_TEMPLATE.questionIndex,
            createdAt: now,
            lastActivity: now
          };
      }
      if (!memoryWasReset) {
        memory.lastActivity = Date.now();
        await this.state.storage.put("memory", memory);
      }
      const response = { reply };
      if (draftOrder) response.draftOrder = draftOrder;
      if (productMatches) response.productMatches = productMatches;
      response.flowState = {
        step: memory.step,
        packageName: memory.packageName,
        // Packageha's package (what we sell), NOT client's product
        variantName: memory.selectedVariantName,
        hasPackage: !!memory.packageId,
        // Packageha's package selected, NOT client's product
        hasVariant: !!memory.selectedVariantId,
        questionIndex: memory.questionIndex
      };
      if (memory.packageId && memory.variants && !memory.selectedVariantId) {
        if (memory.step === "ask_variant" || memory.step === "select_package_variant" || memory.step === "consultation" && memory.variants.length > 1) {
          response.variants = memory.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: v.price
          }));
        }
      }
      let consultationPhase = null;
      if (memory.step === "product_details" && SALES_CHARTER.productDetails) {
        consultationPhase = SALES_CHARTER.productDetails;
      } else if (memory.step === "select_package_specs" && SALES_CHARTER.packageSpecs) {
        consultationPhase = SALES_CHARTER.packageSpecs;
      } else if (memory.step === "fulfillment_specs" && SALES_CHARTER.fulfillmentSpecs) {
        consultationPhase = SALES_CHARTER.fulfillmentSpecs;
      } else if (memory.step === "launch_kit" && SALES_CHARTER.launchKit) {
        consultationPhase = SALES_CHARTER.launchKit;
      } else if (memory.step === "consultation") {
        let charter;
        if (memory.flow === "direct_sales") {
          charter = SALES_CHARTER;
        } else if (memory.flow === "package_order") {
          charter = PACKAGE_ORDER_CHARTER;
        }
        if (charter && charter.consultation) {
          consultationPhase = charter.consultation;
        }
      }
      if (consultationPhase) {
        const steps = consultationPhase.steps;
        const currentIndex = memory.questionIndex;
        if (currentIndex < steps.length) {
          const currentStep = steps[currentIndex];
          let defaultValue = null;
          if (currentStep.id === "quantity" && memory.clipboard["quantity"]) {
            defaultValue = memory.clipboard["quantity"];
          } else if (currentStep.id === "dimensions" || currentStep.id === "product_dimensions") {
            defaultValue = "";
          }
          response.currentQuestion = {
            id: currentStep.id,
            question: currentStep.question,
            options: currentStep.options || null,
            multiple: currentStep.multiple !== void 0 ? currentStep.multiple : true,
            // Default to multiple if not specified
            defaultValue
          };
        }
      }
      return this.jsonResponse(response);
    } catch (error) {
      console.error("[PackagehaSession] Error:", error);
      return this.jsonResponse({
        reply: "I encountered an error. Please try again or type 'reset' to start over."
      }, 500);
    }
  }
  // ==================== FLOW HANDLERS ====================
  /**
   * Direct Sales Flow - New structure with multiple steps
   * Steps: product_details -> select_package -> fulfillment_specs -> launch_kit -> draft_order
   */
  async handleDirectSalesFlow(userMessage, memory) {
    switch (memory.step) {
      case "start":
        memory.step = "product_details";
        memory.questionIndex = 0;
        if (!SALES_CHARTER.productDetails) {
          return { reply: "Error: Product details configuration missing." };
        }
        return { reply: SALES_CHARTER.productDetails.steps[0].question };
      case "product_details":
        return await this.handleConsultationPhase(
          userMessage,
          memory,
          SALES_CHARTER.productDetails,
          "select_package"
        );
      case "select_package":
      case "select_package_discovery":
        return await this.handlePackageSelection(userMessage, memory);
      case "select_package_variant":
        return await this.handleVariantSelection(userMessage, memory, SALES_CHARTER);
      case "select_package_specs":
        return await this.handleConsultationPhase(
          userMessage,
          memory,
          SALES_CHARTER.packageSpecs,
          "fulfillment_specs"
        );
      case "fulfillment_specs":
        return await this.handleConsultationPhase(
          userMessage,
          memory,
          SALES_CHARTER.fulfillmentSpecs,
          "launch_kit"
        );
      case "launch_kit":
        return await this.handleConsultationPhase(
          userMessage,
          memory,
          SALES_CHARTER.launchKit,
          "draft_order"
        );
      case "draft_order":
        return await this.createProjectQuote(memory);
      default:
        memory.step = "start";
        return await this.handleDirectSalesFlow(userMessage, memory);
    }
  }
  /**
   * Package Ordering Flow (simplified MVP)
   */
  async handlePackageOrderFlow(userMessage, memory) {
    switch (memory.step) {
      case "start":
      case "select_product":
        return await this.handleDiscovery(userMessage, memory, PACKAGE_ORDER_CHARTER);
      case "ask_variant":
        return await this.handleVariantSelection(userMessage, memory, PACKAGE_ORDER_CHARTER);
      case "consultation":
        return await this.handleConsultation(userMessage, memory, PACKAGE_ORDER_CHARTER);
      default:
        memory.step = "start";
        return await this.handleDiscovery(userMessage, memory, PACKAGE_ORDER_CHARTER);
    }
  }
  /**
   * Launch Kit Flow
   */
  async handleLaunchKitFlow(userMessage, memory) {
    switch (memory.step) {
      case "start":
        return { reply: await this.handleLaunchKitStart(userMessage, memory) };
      case "select_services":
        return await this.handleLaunchKitServiceSelection(userMessage, memory);
      case "consultation":
        return await this.handleConsultation(userMessage, memory, LAUNCH_KIT_CHARTER);
      default:
        memory.step = "start";
        return { reply: await this.handleLaunchKitStart(userMessage, memory) };
    }
  }
  /**
   * Packaging Assistant Flow
   */
  async handlePackagingAssistantFlow(userMessage, memory) {
    switch (memory.step) {
      case "start":
        return { reply: await this.handlePackagingAssistantStart(userMessage, memory) };
      case "consultation":
        return await this.handlePackagingAssistantConsultation(userMessage, memory);
      case "show_recommendations":
        return await this.handlePackagingAssistantRecommendations(userMessage, memory);
      default:
        memory.step = "start";
        return { reply: await this.handlePackagingAssistantStart(userMessage, memory) };
    }
  }
  // ==================== SHARED HANDLERS ====================
  /**
   * Get products (with caching for 5 minutes)
   */
  async getCachedProducts() {
    const cacheKey = "products_cache";
    const cacheTimestampKey = "products_cache_timestamp";
    const CACHE_TTL = 5 * 60 * 1e3;
    try {
      const cached = await this.state.storage.get(cacheKey);
      const timestamp = await this.state.storage.get(cacheTimestampKey);
      if (cached && timestamp && Date.now() - timestamp < CACHE_TTL) {
        console.log("[getCachedProducts] Using cached products");
        return cached;
      }
      console.log("[getCachedProducts] Fetching fresh products");
      const products = await getActiveProducts(
        this.env.SHOP_URL,
        this.env.SHOPIFY_ACCESS_TOKEN
      );
      await this.state.storage.put(cacheKey, products);
      await this.state.storage.put(cacheTimestampKey, Date.now());
      return products;
    } catch (error) {
      console.error("[getCachedProducts] Error:", error);
      throw error;
    }
  }
  async handleDiscovery(userMessage, memory, charter) {
    if ((memory.step === "select_product" || memory.step === "select_package_discovery") && memory.pendingMatches) {
      const numMatch = userMessage.trim().match(/^(\d+)$/);
      if (numMatch) {
        const selectedNum = parseInt(numMatch[1]) - 1;
        if (selectedNum >= 0 && selectedNum < memory.pendingMatches.length) {
          const selectedPackageIndex2 = memory.pendingMatches[selectedNum].id;
          let products2;
          try {
            products2 = await this.getCachedProducts();
          } catch (error) {
            return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
          }
          const packageProduct = products2[selectedPackageIndex2];
          if (!packageProduct) {
            return { reply: "I found a match but couldn't load the package details. Please try again." };
          }
          memory.packageName = packageProduct.title;
          memory.packageId = packageProduct.id;
          memory.variants = packageProduct.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: v.price
          }));
          memory.pendingMatches = void 0;
          if (memory.variants.length === 1) {
            memory.selectedVariantId = memory.variants[0].id;
            memory.selectedVariantName = "Default";
            if (memory.flow === "direct_sales") {
              memory.step = "select_package_specs";
              memory.questionIndex = 0;
              if (!SALES_CHARTER.packageSpecs) {
                return { reply: "Error: Package specs configuration missing." };
              }
              return { reply: `Found **${packageProduct.title}**.

${SALES_CHARTER.packageSpecs.steps[0].question}` };
            } else {
              memory.step = "consultation";
              memory.questionIndex = 0;
              return { reply: `Found **${packageProduct.title}**.

Let's get your project details.

${charter.consultation.steps[0].question}` };
            }
          }
          if (memory.flow === "direct_sales") {
            memory.step = "select_package_variant";
          } else {
            memory.step = "ask_variant";
          }
          const options = memory.variants.map((v) => v.title).join(", ");
          return { reply: `Found **${packageProduct.title}**.

Which type are you interested in?

Options: ${options}` };
        } else {
          const matchesList = memory.pendingMatches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
          return {
            reply: `Please select a number between 1 and ${memory.pendingMatches.length}:

${matchesList}`,
            productMatches: memory.pendingMatches
          };
        }
      } else {
        memory.pendingMatches = void 0;
        if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
          memory.step = "start";
        }
      }
    }
    if (this.isGreeting(userMessage)) {
      return { reply: "Hello! I'm your packaging consultant. What are you looking for? (e.g., 'Custom Boxes', 'Bags', 'Printing Services')" };
    }
    let products;
    try {
      products = await this.getCachedProducts();
    } catch (error) {
      console.error("[handleDiscovery] Error fetching packages:", error);
      return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
    }
    if (products.length === 0) {
      return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
    }
    const inventoryList = products.map((p, index) => {
      const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
      return `ID ${index}: ${cleanTitle}`;
    }).join("\n");
    const systemPrompt = buildCharterPrompt("discovery", charter);
    let productContext = "";
    if (memory.clipboard && Object.keys(memory.clipboard).length > 0) {
      const contextParts = [];
      if (memory.clipboard.product_description) {
        contextParts.push(`Product: ${memory.clipboard.product_description}`);
      }
      if (memory.clipboard.product_dimensions) {
        contextParts.push(`Dimensions: ${memory.clipboard.product_dimensions}`);
      }
      if (memory.clipboard.product_weight) {
        contextParts.push(`Weight: ${memory.clipboard.product_weight}`);
      }
      if (memory.clipboard.fragility) {
        contextParts.push(`Fragility: ${memory.clipboard.fragility}`);
      }
      if (memory.clipboard.budget) {
        contextParts.push(`Budget: ${memory.clipboard.budget}`);
      }
      if (contextParts.length > 0) {
        productContext = `

Product Details:
${contextParts.join("\n")}

Use this context to recommend the most suitable packaging solution.`;
      }
    }
    const userPrompt = `Inventory:
${inventoryList}

User Input: "${userMessage}"${productContext}

Return JSON:
- If single match: { "type": "found", "id": <index>, "reason": "..." }
- If multiple matches: { "type": "multiple", "matches": [{"id": <index>, "name": "<product_name>", "reason": "..."}, ...] }
- If chatting: { "type": "chat", "reply": "..." }
- If no match: { "type": "none", "reason": "..." }`;
    const decision = await this.getAIDecision(userPrompt, systemPrompt);
    if (decision.type === "chat") {
      return { reply: decision.reply || "I focus on packaging solutions. What are you looking for?" };
    }
    if (decision.type === "none") {
      const fallbackMessage = "I couldn't find an exact match for that. Let me suggest some options:\n\n\u2022 Try a simpler search like 'box', 'bag', or 'packaging'\n\u2022 Or describe what you're looking for in different words\n\u2022 You can also browse our catalog by searching for 'show all packages'\n\nWhat type of packaging are you looking for?";
      return { reply: fallbackMessage };
    }
    if (decision.type === "multiple" && decision.matches && decision.matches.length > 0) {
      const matches = decision.matches.filter((m) => m.id !== void 0 && products[m.id]).slice(0, 5).map((m) => ({
        id: m.id,
        packageId: products[m.id].id,
        // Packageha's package ID
        name: products[m.id].title,
        reason: m.reason || "Matches your search"
      }));
      if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
        memory.step = "select_product";
      }
      memory.pendingMatches = matches;
      const matchesList = matches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
      return {
        reply: `I found ${matches.length} matching packages:

${matchesList}

Please select a package by number (1-${matches.length}) or describe what you need more specifically.`,
        productMatches: matches
      };
    }
    const selectedPackageIndex = decision.id;
    if (selectedPackageIndex !== void 0 && products[selectedPackageIndex]) {
      const packageProduct = products[selectedPackageIndex];
      if (!packageProduct) {
        return { reply: "I found a match but couldn't load the package details. Please try again." };
      }
      memory.packageName = packageProduct.title;
      memory.packageId = packageProduct.id;
      memory.variants = packageProduct.variants.map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price
      }));
      if (memory.variants.length === 1) {
        memory.selectedVariantId = memory.variants[0].id;
        memory.selectedVariantName = "Default";
        if (memory.flow === "direct_sales") {
          memory.step = "select_package_specs";
          memory.questionIndex = 0;
          if (!SALES_CHARTER.packageSpecs) {
            return { reply: "Error: Package specs configuration missing." };
          }
          return { reply: `Found **${packageProduct.title}**.

${SALES_CHARTER.packageSpecs.steps[0].question}` };
        } else {
          memory.step = "consultation";
          memory.questionIndex = 0;
          return { reply: `Found **${packageProduct.title}**.

Let's get your project details.

${charter.consultation.steps[0].question}` };
        }
      }
      if (memory.flow === "direct_sales") {
        memory.step = "select_package_variant";
      } else {
        memory.step = "ask_variant";
      }
      const options = memory.variants.map((v) => v.title).join(", ");
      return { reply: `Found **${packageProduct.title}**.

Which type are you interested in?

Options: ${options}` };
    }
    return { reply: "I'm not sure how to help with that. What packaging solution are you looking for?" };
  }
  async handleVariantSelection(userMessage, memory, charter) {
    if (this.shouldRestartSearch(userMessage)) {
      await this.state.storage.delete("memory");
      return {
        reply: "Okay, let's start over. What are you looking for?",
        memoryReset: true
      };
    }
    if (!memory.variants || memory.variants.length === 0) {
      return {
        reply: "I lost track of the product options. Type 'reset' to start over."
      };
    }
    const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
    const systemPrompt = buildCharterPrompt("variant", charter);
    const userPrompt = `Options:
${optionsContext}

User: "${userMessage}"

Return JSON:
- If match: { "match": true, "id": <index> }
- If no match: { "match": false, "reply": "..." }`;
    const decision = await this.getVariantDecision(userPrompt, systemPrompt);
    if (decision.match && decision.id !== void 0 && memory.variants[decision.id]) {
      const selected = memory.variants[decision.id];
      memory.selectedVariantId = selected.id;
      memory.selectedVariantName = selected.title === "Default Title" ? "Default" : selected.title;
      memory.step = "select_package_specs";
      memory.questionIndex = 0;
      if (!SALES_CHARTER.packageSpecs) {
        return { reply: "Error: Package specs configuration missing." };
      }
      return {
        reply: `Selected **${selected.title}**.

${SALES_CHARTER.packageSpecs.steps[0].question}`
      };
    }
    return {
      reply: decision.reply || "Please select one of the options listed above."
    };
  }
  /**
   * Generic consultation handler for any consultation phase
   * @param nextStep - The step to move to after this consultation is complete
   */
  async handleConsultationPhase(userMessage, memory, consultationPhase, nextStep) {
    const steps = consultationPhase.steps;
    const currentIndex = memory.questionIndex;
    if (!userMessage || userMessage.trim() === "") {
      if (currentIndex >= steps.length) {
        memory.step = nextStep;
        memory.questionIndex = 0;
        if (nextStep === "draft_order") {
          return await this.createProjectQuote(memory);
        }
        return this.getNextStepPrompt(nextStep);
      }
      const currentStep2 = steps[currentIndex];
      return { reply: currentStep2.question };
    }
    if (currentIndex >= steps.length) {
      memory.step = nextStep;
      memory.questionIndex = 0;
      if (nextStep === "draft_order") {
        return await this.createProjectQuote(memory);
      }
      return this.getNextStepPrompt(nextStep);
    }
    const currentStep = steps[currentIndex];
    if (currentStep.validation) {
      const validationResult = currentStep.validation(userMessage);
      if (validationResult !== true) {
        return {
          reply: typeof validationResult === "string" ? validationResult : "Please provide a valid answer."
        };
      }
    }
    memory.clipboard[currentStep.id] = userMessage;
    if (currentIndex < steps.length - 1) {
      memory.questionIndex = currentIndex + 1;
      const nextStepQ = steps[memory.questionIndex];
      return { reply: nextStepQ.question };
    }
    memory.step = nextStep;
    memory.questionIndex = 0;
    if (nextStep === "draft_order") {
      return await this.createProjectQuote(memory);
    }
    return this.getNextStepPrompt(nextStep);
  }
  /**
   * Helper to get the prompt for the next step after a consultation phase completes
   */
  getNextStepPrompt(nextStep) {
    if (nextStep === "select_package") {
      return { reply: "Great! Now let's find the perfect package for your product. What type of packaging are you looking for?" };
    } else if (nextStep === "fulfillment_specs") {
      if (!SALES_CHARTER.fulfillmentSpecs) {
        return { reply: "Error: Fulfillment specs configuration missing." };
      }
      return { reply: SALES_CHARTER.fulfillmentSpecs.steps[0].question };
    } else if (nextStep === "launch_kit") {
      if (!SALES_CHARTER.launchKit) {
        return { reply: "Error: Launch kit configuration missing." };
      }
      return { reply: SALES_CHARTER.launchKit.steps[0].question };
    }
    return { reply: "Moving to next step..." };
  }
  /**
   * Handle package selection (discovery -> variant -> specs)
   */
  async handlePackageSelection(userMessage, memory) {
    if (!memory.packageId) {
      if (!userMessage || userMessage.trim() === "") {
        memory.step = "select_package_discovery";
        return { reply: "Great! Now let's find the perfect package for your product. What type of packaging are you looking for?" };
      }
      memory.step = "select_package_discovery";
      const result = await this.handleDiscovery(userMessage, memory, SALES_CHARTER);
      if (result.productMatches && result.productMatches.length > 0) {
        return result;
      }
      if (memory.packageId && memory.variants) {
        if (memory.variants.length === 1) {
          memory.selectedVariantId = memory.variants[0].id;
          memory.selectedVariantName = "Default";
          memory.step = "select_package_specs";
          memory.questionIndex = 0;
          if (!SALES_CHARTER.packageSpecs) {
            return { reply: "Error: Package specs configuration missing." };
          }
          return { reply: SALES_CHARTER.packageSpecs.steps[0].question };
        } else {
          memory.step = "select_package_variant";
          const options = memory.variants.map((v) => v.title).join(", ");
          return { reply: `Found **${memory.packageName}**.

Which type are you interested in?

Options: ${options}` };
        }
      }
      return result;
    }
    return { reply: "Package already selected. Moving forward..." };
  }
  async handleConsultation(userMessage, memory, charter) {
    const steps = charter.consultation.steps;
    const currentIndex = memory.questionIndex;
    if (currentIndex >= steps.length) {
      return { reply: "I've collected all the information. Generating your quote..." };
    }
    const currentStep = steps[currentIndex];
    if (currentStep.validation) {
      const validationResult = currentStep.validation(userMessage);
      if (validationResult !== true) {
        return {
          reply: typeof validationResult === "string" ? validationResult : "Please provide a valid answer."
        };
      }
    }
    memory.clipboard[currentStep.id] = userMessage;
    if (currentIndex < steps.length - 1) {
      memory.questionIndex = currentIndex + 1;
      const nextStep = steps[memory.questionIndex];
      return { reply: nextStep.question };
    }
    return await this.createProjectQuote(memory);
  }
  // ==================== HELPER METHODS ====================
  async createProjectQuote(memory) {
    const allAnswers = [];
    if (SALES_CHARTER.productDetails) {
      SALES_CHARTER.productDetails.steps.forEach((step) => {
        const answer = memory.clipboard[step.id];
        if (answer) {
          allAnswers.push(`- ${step.id.toUpperCase()}: ${answer}`);
        }
      });
    }
    if (SALES_CHARTER.packageSpecs) {
      SALES_CHARTER.packageSpecs.steps.forEach((step) => {
        const answer = memory.clipboard[step.id];
        if (answer) {
          allAnswers.push(`- PACKAGE ${step.id.toUpperCase()}: ${answer}`);
        }
      });
    }
    if (SALES_CHARTER.fulfillmentSpecs) {
      SALES_CHARTER.fulfillmentSpecs.steps.forEach((step) => {
        const answer = memory.clipboard[step.id];
        if (answer) {
          allAnswers.push(`- FULFILLMENT ${step.id.toUpperCase()}: ${answer}`);
        }
      });
    }
    if (SALES_CHARTER.launchKit) {
      SALES_CHARTER.launchKit.steps.forEach((step) => {
        const answer = memory.clipboard[step.id];
        if (answer) {
          allAnswers.push(`- LAUNCH KIT ${step.id.toUpperCase()}: ${answer}`);
        }
      });
    }
    const briefNote = `--- PROJECT BRIEF ---
Package: ${memory.selectedVariantName || memory.packageName || "Not selected"}
${allAnswers.join("\n")}
---------------------
Generated by Studium AI Agent (${SALES_CHARTER.meta.name})
Timestamp: ${(/* @__PURE__ */ new Date()).toISOString()}
`;
    const qtyRaw = memory.clipboard["quantity"] || "1";
    const qtyNum = parseInt(qtyRaw.replace(/\D/g, "")) || 1;
    const customLineItems = [];
    const serviceSelection = memory.clipboard["service_selection"];
    if (serviceSelection && serviceSelection !== "None - skip launch services") {
      const services = serviceSelection.split(",").map((s) => s.trim()).filter((s) => s && s !== "None - skip launch services");
      const servicePricing = {
        "Hero shot photography": "500.00",
        "Stop-motion unboxing video": "800.00",
        "E-commerce product photos": "400.00",
        "3D render with packaging for website": "600.00",
        "Package design consultation": "300.00",
        "Brand styling consultation": "350.00"
      };
      services.forEach((service) => {
        const price = servicePricing[service] || "500.00";
        customLineItems.push({
          title: service,
          price,
          quantity: 1
        });
      });
    }
    try {
      const draftOrder = await createDraftOrder(
        this.env.SHOP_URL,
        this.env.SHOPIFY_ACCESS_TOKEN,
        memory.selectedVariantId || null,
        // Allow null if no package selected
        qtyNum,
        briefNote,
        customLineItems.length > 0 ? customLineItems : void 0
      );
      await this.state.storage.delete("memory");
      return {
        reply: `\u2705 **Project Brief Created!**

I've attached all your specifications to the order. Please review and complete your purchase.

Type 'reset' to start a new project.`,
        memoryReset: true,
        draftOrder: {
          id: draftOrder.draftOrderId,
          adminUrl: draftOrder.adminUrl,
          invoiceUrl: draftOrder.invoiceUrl
        }
      };
    } catch (error) {
      console.error("[createProjectQuote] Error:", error);
      return {
        reply: `\u26A0\uFE0F I encountered an error while creating your quote. Please try again or contact support.`
      };
    }
  }
  async getAIDecision(prompt, systemPrompt) {
    try {
      const response = await this.sovereignSwitch.callAI(prompt, systemPrompt);
      const cleanJson = this.sanitizeJSON(response);
      const decision = JSON.parse(cleanJson);
      if (!decision.type || !["found", "chat", "none", "multiple"].includes(decision.type)) {
        throw new Error("Invalid decision type");
      }
      return decision;
    } catch (error) {
      console.error("[getAIDecision] Error:", error);
      return {
        type: "chat",
        reply: "I'm having trouble processing that. Could you rephrase your request?"
      };
    }
  }
  async getVariantDecision(prompt, systemPrompt) {
    try {
      const response = await this.sovereignSwitch.callAI(prompt, systemPrompt);
      const cleanJson = this.sanitizeJSON(response);
      const decision = JSON.parse(cleanJson);
      return decision;
    } catch (error) {
      console.error("[getVariantDecision] Error:", error);
      return { match: false, reply: "I'm having trouble understanding. Please select an option from the list." };
    }
  }
  sanitizeJSON(text) {
    return text.replace(/```json|```/g, "").trim();
  }
  async loadMemory() {
    const stored = await this.state.storage.get("memory");
    if (!stored) {
      const now = Date.now();
      return {
        flow: DEFAULT_MEMORY_TEMPLATE.flow,
        step: DEFAULT_MEMORY_TEMPLATE.step,
        clipboard: {},
        // Fresh object, not shared reference
        questionIndex: DEFAULT_MEMORY_TEMPLATE.questionIndex,
        createdAt: now,
        lastActivity: now
      };
    }
    if (!stored.flow) {
      stored.flow = "direct_sales";
    }
    return stored;
  }
  async handleReset() {
    await this.state.storage.delete("memory");
    return this.jsonResponse({
      reply: "\u267B\uFE0F Memory reset. Starting fresh! What packaging solution are you looking for?"
    });
  }
  async parseRequestBody(request) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }
  shouldReset(message) {
    const lower = message.toLowerCase().trim();
    return RESET_KEYWORDS.some((keyword) => {
      const keywordLower = keyword.toLowerCase();
      const escapedKeyword = keywordLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, "i");
      return regex.test(lower);
    });
  }
  shouldRestartSearch(message) {
    const lower = message.toLowerCase();
    return lower.includes("search") || lower.includes("change") || lower.includes("different");
  }
  isGreeting(message) {
    return GREETINGS.includes(message.toLowerCase());
  }
  jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    if (request.method === "POST") {
      const cfIp = request.headers.get("CF-Connecting-IP");
      const forwardedFor = request.headers.get("X-Forwarded-For");
      let ip = "anonymous";
      if (cfIp) {
        ip = cfIp.trim();
      } else if (forwardedFor) {
        ip = forwardedFor.split(",")[0].trim();
      }
      const sessionId = env.PackagehaSession.idFromName(ip);
      const session = env.PackagehaSession.get(sessionId);
      return session.fetch(request);
    }
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.pathname === "/models" || url.searchParams.get("list") === "models") {
        try {
          const sovereignSwitch = new SovereignSwitch(env);
          if (env.GEMINI_API_KEY) {
            const models = await sovereignSwitch.listGeminiModels(env.GEMINI_API_KEY);
            const selected = await sovereignSwitch.getWorkingGeminiModel(env.GEMINI_API_KEY);
            return new Response(
              JSON.stringify({
                provider: "gemini",
                models,
                selected
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
                }
              }
            );
          } else {
            return new Response(
              JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
                }
              }
            );
          }
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }
      }
      return new Response(
        JSON.stringify({
          service: "Studium Agent",
          version: "2.0",
          campus: "Packageha",
          practice: "Sales",
          status: "operational"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  }
};

// C:/Users/akhod/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/akhod/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-QDVGqt/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// C:/Users/akhod/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-QDVGqt/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  PackagehaSession,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
