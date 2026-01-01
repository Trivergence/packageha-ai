/**
 * PackagehaSession: The Being (Agent)
 * Stateful Durable Object that maintains conversation memory and follows the Charter
 */

import { getActiveProducts, createDraftOrder } from "./shopify";
import { 
    SALES_CHARTER, 
    PACKAGE_ORDER_CHARTER, 
    LAUNCH_KIT_CHARTER, 
    PACKAGING_ASSISTANT_CHARTER,
    buildCharterPrompt 
} from "./charter";
import { SovereignSwitch } from "./sovereign-switch";
import { 
    Env, 
    Memory, 
    Product, 
    Variant, 
    AIDecision, 
    VariantDecision, 
    RequestBody,
    AgentFlow,
    PackageRecommendation
} from "./types";

// Default memory template - timestamps set when creating new memory
const DEFAULT_MEMORY_TEMPLATE: Omit<Memory, "createdAt" | "lastActivity"> = {
    flow: "direct_sales",
    step: "start",
    clipboard: {},
    questionIndex: 0,
};

const GREETINGS = ["hi", "hello", "hey", "hola", "مرحبا", "هلا", "أهلا"];
const RESET_KEYWORDS = ["reset", "إعادة", "start over", "new", "جديد"];

export class PackagehaSession {
    state: DurableObjectState;
    env: Env;
    private sovereignSwitch: SovereignSwitch;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
        this.sovereignSwitch = new SovereignSwitch(env);
    }

    async fetch(request: Request): Promise<Response> {
        try {
            // Parse request
            const body = await this.parseRequestBody(request);
            const userMessage = (body.message || "").trim();

            // Handle reset
            if (this.shouldReset(userMessage)) {
                return await this.handleReset();
            }

            // Load or initialize memory
            let memory = await this.loadMemory();

            // Determine flow (explicit from request or from memory)
            const requestedFlow = body.flow || memory.flow || "direct_sales";
            if (!memory.flow || memory.flow !== requestedFlow) {
                // Flow changed - reset to start of new flow
                memory.flow = requestedFlow as AgentFlow;
                memory.step = "start";
                memory.clipboard = {};
                memory.questionIndex = 0;
            }

            // Route to appropriate flow handler
            let reply: string;
            let memoryWasReset = false;
            let draftOrder: any = undefined;
            let productMatches: any[] | undefined = undefined;
            
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
                        lastActivity: now,
                    };
            }

            // Save memory if it wasn't reset (deleted)
            // Note: We always save when !memoryWasReset because:
            // - If memory exists in storage, we're updating it
            // - If memory doesn't exist, it was newly created by loadMemory() and should be persisted
            // - The only time we don't save is when memoryWasReset=true (explicitly deleted)
            if (!memoryWasReset) {
                // Update memory timestamp and save
                memory.lastActivity = Date.now();
                await this.state.storage.put("memory", memory);
            }

            // Build response with optional fields
            const response: any = { reply };
            if (draftOrder) response.draftOrder = draftOrder;
            if (productMatches) response.productMatches = productMatches;
            
            // Add flow state for UI tracking
            response.flowState = {
                step: memory.step,
                productName: memory.productName,
                variantName: memory.selectedVariantName,
                hasProduct: !!memory.productId,
                hasVariant: !!memory.selectedVariantId,
                questionIndex: memory.questionIndex
            };
            
            // Add variant options if we're in variant selection step OR if product is selected but variant isn't
            // This helps frontend know what variants are available even if we haven't explicitly asked yet
            if (memory.productId && memory.variants && !memory.selectedVariantId) {
                // Only include variants if step is ask_variant OR if we just selected product (to help frontend)
                if (memory.step === "ask_variant" || (memory.step === "consultation" && memory.variants.length > 1)) {
                    response.variants = memory.variants.map(v => ({
                        id: v.id,
                        title: v.title,
                        price: v.price
                    }));
                }
            }
            
            // Add current consultation question if we're in consultation step
            if (memory.step === "consultation") {
                let charter;
                if (memory.flow === "direct_sales") {
                    charter = SALES_CHARTER;
                } else if (memory.flow === "package_order") {
                    charter = PACKAGE_ORDER_CHARTER;
                }
                
                if (charter) {
                    const steps = charter.consultation.steps;
                    const currentIndex = memory.questionIndex;
                    if (currentIndex < steps.length) {
                        const currentStep = steps[currentIndex];
                        // Generate default value based on product/variant info if applicable
                        let defaultValue = null;
                        if (currentStep.id === "quantity" && memory.clipboard["quantity"]) {
                            defaultValue = memory.clipboard["quantity"];
                        } else if (currentStep.id === "dimensions") {
                            // Could suggest based on product type, but for now leave empty
                            defaultValue = "";
                        }
                        
                        response.currentQuestion = {
                            id: currentStep.id,
                            question: currentStep.question,
                            options: (currentStep as any).options || null,
                            multiple: (currentStep as any).multiple !== undefined ? (currentStep as any).multiple : true, // Default to multiple if not specified
                            defaultValue: defaultValue
                        };
                    }
                }
            }

            return this.jsonResponse(response);

        } catch (error: any) {
            console.error("[PackagehaSession] Error:", error);
            return this.jsonResponse({ 
                reply: "I encountered an error. Please try again or type 'reset' to start over." 
            }, 500);
        }
    }

    // ==================== FLOW HANDLERS ====================

    /**
     * Direct Sales Flow (existing flow - renamed for clarity)
     */
    private async handleDirectSalesFlow(
        userMessage: string, 
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any; productMatches?: any[] }> {
        switch (memory.step) {
            case "start":
            case "select_product":
                return await this.handleDiscovery(userMessage, memory, SALES_CHARTER);
            case "ask_variant":
                return await this.handleVariantSelection(userMessage, memory, SALES_CHARTER);
            case "consultation":
                return await this.handleConsultation(userMessage, memory, SALES_CHARTER);
            default:
                memory.step = "start";
                return await this.handleDiscovery(userMessage, memory, SALES_CHARTER);
        }
    }

    /**
     * Package Ordering Flow (simplified MVP)
     */
    private async handlePackageOrderFlow(
        userMessage: string,
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any; productMatches?: any[] }> {
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
    private async handleLaunchKitFlow(
        userMessage: string,
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean }> {
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
    private async handlePackagingAssistantFlow(
        userMessage: string,
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean }> {
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
    private async getCachedProducts(): Promise<any[]> {
        const cacheKey = "products_cache";
        const cacheTimestampKey = "products_cache_timestamp";
        const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

        try {
            // Check cache
            const cached = await this.state.storage.get<any[]>(cacheKey);
            const timestamp = await this.state.storage.get<number>(cacheTimestampKey);
            
            if (cached && timestamp && (Date.now() - timestamp) < CACHE_TTL) {
                console.log("[getCachedProducts] Using cached products");
                return cached;
            }

            // Fetch fresh products
            console.log("[getCachedProducts] Fetching fresh products");
            const products = await getActiveProducts(
                this.env.SHOP_URL,
                this.env.SHOPIFY_ACCESS_TOKEN
            );

            // Cache products
            await this.state.storage.put(cacheKey, products);
            await this.state.storage.put(cacheTimestampKey, Date.now());

            return products;
        } catch (error: any) {
            console.error("[getCachedProducts] Error:", error);
            throw error;
        }
    }

    private async handleDiscovery(userMessage: string, memory: Memory, charter: any): Promise<{ reply: string; productMatches?: any[] }> {
        // If we're in select_product step, check if user is selecting a number first
        if (memory.step === "select_product" && memory.pendingMatches) {
            const numMatch = userMessage.trim().match(/^(\d+)$/);
            if (numMatch) {
                const selectedNum = parseInt(numMatch[1]) - 1;
                if (selectedNum >= 0 && selectedNum < memory.pendingMatches.length) {
                    // User selected a product - get the product index from the match
                    const selectedProductIndex = memory.pendingMatches[selectedNum].id;
                    
                    // Fetch products to get full details
                    let products;
                    try {
                        products = await this.getCachedProducts();
                    } catch (error: any) {
                        return { reply: "I'm having trouble accessing the product catalog. Please try again later." };
                    }
                    
                    const product = products[selectedProductIndex];
                    if (!product) {
                        return { reply: "I found a match but couldn't load the product details. Please try again." };
                    }

                    // Store product info
                    memory.productName = product.title;
                    memory.productId = product.id;
                    memory.variants = product.variants.map((v: any) => ({
                        id: v.id,
                        title: v.title,
                        price: v.price,
                    }));
                    memory.pendingMatches = undefined; // Clear pending matches

                    // Auto-skip variant selection if only one variant
                    if (memory.variants.length === 1) {
                        memory.selectedVariantId = memory.variants[0].id;
                        memory.selectedVariantName = memory.variants[0].title;
                        memory.step = "consultation";
                        memory.questionIndex = 0;
                        return { reply: `Found **${product.title}**.\n\nLet's get your project details.\n\n${charter.consultation.steps[0].question}` };
                    }

                    // Ask for variant selection
                    memory.step = "ask_variant";
                    const options = memory.variants.map(v => v.title).join(", ");
                    return { reply: `Found **${product.title}**.\n\nWhich type are you interested in?\n\nOptions: ${options}` };
                } else {
                    // Invalid number
                    const matchesList = memory.pendingMatches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
                    return {
                        reply: `Please select a number between 1 and ${memory.pendingMatches.length}:\n\n${matchesList}`,
                        productMatches: memory.pendingMatches
                    };
                }
            } else {
                // User didn't provide a valid number - could be searching again or invalid input
                // Continue to search logic below
                memory.pendingMatches = undefined;
                memory.step = "start";
            }
        }
        
        // Handle greetings locally (save AI cost)
        if (this.isGreeting(userMessage)) {
            return { reply: "Hello! I'm your packaging consultant. What are you looking for? (e.g., 'Custom Boxes', 'Bags', 'Printing Services')" };
        }

        // Fetch products (with caching)
        let products;
        try {
            products = await this.getCachedProducts();
        } catch (error: any) {
            console.error("[handleDiscovery] Error fetching products:", error);
            return { reply: "I'm having trouble accessing the product catalog. Please try again later." };
        }

        if (products.length === 0) {
            return { reply: "I'm having trouble accessing the product catalog. Please try again later." };
        }

        // Prepare inventory context - include full product names (including Arabic) for better AI reasoning
        const inventoryList = products.map((p, index) => {
            const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
            return `ID ${index}: ${cleanTitle}`;
        }).join("\n");

        // Build AI prompt with Charter - request multiple matches if available
        const systemPrompt = buildCharterPrompt("discovery", charter);
        const userPrompt = `Inventory:\n${inventoryList}\n\nUser Input: "${userMessage}"\n\nReturn JSON:\n- If single match: { "type": "found", "id": <index>, "reason": "..." }\n- If multiple matches: { "type": "multiple", "matches": [{"id": <index>, "name": "<product_name>", "reason": "..."}, ...] }\n- If chatting: { "type": "chat", "reply": "..." }\n- If no match: { "type": "none", "reason": "..." }`;

        // Get AI decision
        const decision = await this.getAIDecision(userPrompt, systemPrompt);

        // Process decision
        if (decision.type === "chat") {
            return { reply: decision.reply || "I focus on packaging solutions. What are you looking for?" };
        }

        if (decision.type === "none") {
            return { reply: "I couldn't find that product. We offer Boxes, Bags, and Printing services. What do you need?" };
        }

        // Handle multiple matches - return for user selection
        if (decision.type === "multiple" && decision.matches && decision.matches.length > 0) {
            const matches = decision.matches
                .filter(m => m.id !== undefined && products[m.id])
                .slice(0, 5) // Limit to 5 matches
                .map(m => ({
                    id: m.id!,
                    productId: products[m.id!].id,
                    name: products[m.id!].title,
                    reason: m.reason || "Matches your search"
                }));

            memory.step = "select_product";
            memory.pendingMatches = matches;

            const matchesList = matches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
            return {
                reply: `I found ${matches.length} matching products:\n\n${matchesList}\n\nPlease select a product by number (1-${matches.length}) or describe what you need more specifically.`,
                productMatches: matches
            };
        }

        // Handle single match
        const selectedProductIndex = decision.id;

        if (selectedProductIndex !== undefined && products[selectedProductIndex]) {
            const product = products[selectedProductIndex];
            if (!product) {
                return { reply: "I found a match but couldn't load the product details. Please try again." };
            }

            // Store product info
            memory.productName = product.title;
            memory.productId = product.id;
            memory.variants = product.variants.map((v: any) => ({
                id: v.id,
                title: v.title,
                price: v.price,
            }));

            // Auto-skip variant selection if only one variant
            if (memory.variants.length === 1) {
                memory.selectedVariantId = memory.variants[0].id;
                memory.selectedVariantName = memory.variants[0].title;
                memory.step = "consultation";
                memory.questionIndex = 0;
                return { reply: `Found **${product.title}**.\n\nLet's get your project details.\n\n${charter.consultation.steps[0].question}` };
            }

            // Ask for variant selection
            memory.step = "ask_variant";
            const options = memory.variants.map(v => v.title).join(", ");
            return { reply: `Found **${product.title}**.\n\nWhich type are you interested in?\n\nOptions: ${options}` };
        }

        return { reply: "I'm not sure how to help with that. What packaging solution are you looking for?" };
    }

    private async handleVariantSelection(
        userMessage: string, 
        memory: Memory,
        charter: any
    ): Promise<{ reply: string; memoryReset?: boolean }> {
        // Allow restarting search
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

        // Build context
        const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");

        // Get AI decision
        const systemPrompt = buildCharterPrompt("variant", charter);
        const userPrompt = `Options:\n${optionsContext}\n\nUser: "${userMessage}"\n\nReturn JSON:\n- If match: { "match": true, "id": <index> }\n- If no match: { "match": false, "reply": "..." }`;

        const decision = await this.getVariantDecision(userPrompt, systemPrompt);

        if (decision.match && decision.id !== undefined && memory.variants[decision.id]) {
            const selected = memory.variants[decision.id];
            memory.selectedVariantId = selected.id;
            memory.selectedVariantName = selected.title;
            memory.step = "consultation";
            memory.questionIndex = 0;
            return { 
                reply: `Selected **${selected.title}**.\n\n${charter.consultation.steps[0].question}` 
            };
        }

        return { 
            reply: decision.reply || "Please select one of the options listed above." 
        };
    }

    private async handleConsultation(
        userMessage: string, 
        memory: Memory,
        charter: any
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any }> {
        const steps = charter.consultation.steps;
        const currentIndex = memory.questionIndex;

        if (currentIndex >= steps.length) {
            return { reply: "I've collected all the information. Generating your quote..." };
        }

        const currentStep = steps[currentIndex];

        // Validate answer if validator exists
        if (currentStep.validation) {
            const validationResult = currentStep.validation(userMessage);
            if (validationResult !== true) {
                return { 
                    reply: typeof validationResult === "string" 
                        ? validationResult 
                        : "Please provide a valid answer." 
                };
            }
        }

        // Store answer
        memory.clipboard[currentStep.id] = userMessage;

        // Check if there are more questions
        if (currentIndex < steps.length - 1) {
            memory.questionIndex = currentIndex + 1;
            const nextStep = steps[memory.questionIndex];
            return { reply: nextStep.question };
        }

        // All questions answered - create draft order
        return await this.createProjectQuote(memory);
    }

    // ==================== HELPER METHODS ====================

    private async createProjectQuote(
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any }> {
        if (!memory.selectedVariantId) {
            return { 
                reply: "Error: Missing product selection. Please type 'reset' to start over." 
            };
        }

        const steps = SALES_CHARTER.consultation.steps;
        
        // Format project brief
        const briefNote = `--- PROJECT BRIEF ---
Product: ${memory.selectedVariantName || "Unknown"}
${steps.map(s => `- ${s.id.toUpperCase()}: ${memory.clipboard[s.id] || "Not provided"}`).join("\n")}
---------------------
Generated by Studium AI Agent (${SALES_CHARTER.meta.name})
Timestamp: ${new Date().toISOString()}
`;

        // Parse quantity safely
        const qtyRaw = memory.clipboard['quantity'] || "1";
        const qtyNum = parseInt(qtyRaw.replace(/\D/g, '')) || 1;

        try {
            const draftOrder = await createDraftOrder(
                this.env.SHOP_URL,
                this.env.SHOPIFY_ACCESS_TOKEN,
                memory.selectedVariantId,
                qtyNum,
                briefNote
            );

            // createDraftOrder throws on error, so if we reach here, draftOrder is valid
            // Reset memory for new project
            await this.state.storage.delete("memory");
            
            // Return structured response with draft order info
            return { 
                reply: `✅ **Project Brief Created!**\n\nI've attached all your specifications to the order. Please review and complete your purchase.\n\nType 'reset' to start a new project.`,
                memoryReset: true,
                draftOrder: {
                    id: draftOrder.draftOrderId,
                    adminUrl: draftOrder.adminUrl,
                    invoiceUrl: draftOrder.invoiceUrl
                }
            };
        } catch (error: any) {
            console.error("[createProjectQuote] Error:", error);
            return { 
                reply: `⚠️ I encountered an error while creating your quote. Please try again or contact support.` 
            };
        }
    }

    private async getAIDecision(prompt: string, systemPrompt: string): Promise<AIDecision> {
        try {
            const response = await this.sovereignSwitch.callAI(prompt, systemPrompt);
            const cleanJson = this.sanitizeJSON(response);
            const decision = JSON.parse(cleanJson) as AIDecision;
            
            // Validate decision structure
            if (!decision.type || !["found", "chat", "none", "multiple"].includes(decision.type)) {
                throw new Error("Invalid decision type");
            }
            
            return decision;
        } catch (error: any) {
            console.error("[getAIDecision] Error:", error);
            return { 
                type: "chat", 
                reply: "I'm having trouble processing that. Could you rephrase your request?" 
            };
        }
    }

    private async getVariantDecision(prompt: string, systemPrompt: string): Promise<VariantDecision> {
        try {
            const response = await this.sovereignSwitch.callAI(prompt, systemPrompt);
            const cleanJson = this.sanitizeJSON(response);
            const decision = JSON.parse(cleanJson) as VariantDecision;
            return decision;
        } catch (error: any) {
            console.error("[getVariantDecision] Error:", error);
            return { match: false, reply: "I'm having trouble understanding. Please select an option from the list." };
        }
    }

    private sanitizeJSON(text: string): string {
        // Remove markdown code blocks
        return text.replace(/```json|```/g, "").trim();
    }

    private async loadMemory(): Promise<Memory> {
        const stored = await this.state.storage.get<Memory>("memory");
        if (!stored) {
            // Create new memory with fresh timestamps and a fresh clipboard object
            // Important: Create a new clipboard object to avoid sharing references
            const now = Date.now();
            return {
                flow: DEFAULT_MEMORY_TEMPLATE.flow,
                step: DEFAULT_MEMORY_TEMPLATE.step,
                clipboard: {}, // Fresh object, not shared reference
                questionIndex: DEFAULT_MEMORY_TEMPLATE.questionIndex,
                createdAt: now,
                lastActivity: now,
            };
        }
        // Ensure flow exists for old memories
        if (!stored.flow) {
            stored.flow = "direct_sales";
        }
        return stored;
    }

    private async handleReset(): Promise<Response> {
        await this.state.storage.delete("memory");
        return this.jsonResponse({ 
            reply: "♻️ Memory reset. Starting fresh! What packaging solution are you looking for?" 
        });
    }

    private async parseRequestBody(request: Request): Promise<RequestBody> {
        try {
            return await request.json() as RequestBody;
        } catch {
            return {};
        }
    }

    private shouldReset(message: string): boolean {
        const lower = message.toLowerCase().trim();
        // Use word boundary matching to avoid false positives
        // Match reset keywords as whole words only (not substrings)
        return RESET_KEYWORDS.some(keyword => {
            const keywordLower = keyword.toLowerCase();
            // Escape special regex characters in keyword
            const escapedKeyword = keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Match as whole word using word boundaries
            const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
            return regex.test(lower);
        });
    }

    private shouldRestartSearch(message: string): boolean {
        const lower = message.toLowerCase();
        return lower.includes("search") || lower.includes("change") || lower.includes("different");
    }

    private isGreeting(message: string): boolean {
        return GREETINGS.includes(message.toLowerCase());
    }

    private jsonResponse(data: any, status: number = 200): Response {
        return new Response(JSON.stringify(data), {
            status,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}
