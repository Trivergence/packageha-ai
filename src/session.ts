/**
 * PackagehaSession: The Being (Agent)
 * Stateful Durable Object that maintains conversation memory and follows the Charter
 */

import { getActiveProducts, createDraftOrder, CustomLineItem } from "./shopify";
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

            // Handle reset (via message keyword or explicit reset parameter)
            if (this.shouldReset(userMessage) || body.reset === true) {
                return await this.handleReset();
            }

            // Handle regenerate draft order request
            if (userMessage === "regenerate_order" || body.regenerateOrder === true) {
                const memory = await this.loadMemory();
                // Regenerate draft order without resetting memory
                const result = await this.createProjectQuote(memory, false); // false = don't reset memory
                return this.jsonResponse({
                    reply: result.reply,
                    flowState: {
                        step: memory.step,
                        packageName: memory.packageName,
                        variantName: memory.selectedVariantName,
                        hasPackage: !!memory.packageId,
                        hasVariant: !!memory.selectedVariantId,
                        questionIndex: memory.questionIndex
                    },
                    draftOrder: result.draftOrder
                });
            }

            // Handle edit requests (format: "edit:questionId")
            // SIMPLIFIED: Edit only updates the answer, doesn't reset flow or re-ask subsequent questions
            if (userMessage.startsWith("edit:")) {
                const questionId = userMessage.replace("edit:", "").trim();
                const memory = await this.loadMemory();
                
                // Store the original questionIndex and step before edit
                const originalQuestionIndex = memory.questionIndex;
                const originalStep = memory.step;
                
                // Determine which step this question belongs to and get the question
                let question: any = null;
                let stepName: string = "";
                
                if (SALES_CHARTER.productDetails && SALES_CHARTER.productDetails.steps.some(s => s.id === questionId)) {
                    const stepIndex = SALES_CHARTER.productDetails.steps.findIndex(s => s.id === questionId);
                    if (stepIndex >= 0) {
                        question = SALES_CHARTER.productDetails.steps[stepIndex];
                        stepName = "product_details";
                    }
                } else if (SALES_CHARTER.packageSpecs && SALES_CHARTER.packageSpecs.steps.some(s => s.id === questionId)) {
                    const stepIndex = SALES_CHARTER.packageSpecs.steps.findIndex(s => s.id === questionId);
                    if (stepIndex >= 0) {
                        question = SALES_CHARTER.packageSpecs.steps[stepIndex];
                        stepName = "select_package_specs";
                    }
                } else if (SALES_CHARTER.fulfillmentSpecs && SALES_CHARTER.fulfillmentSpecs.steps.some(s => s.id === questionId)) {
                    const stepIndex = SALES_CHARTER.fulfillmentSpecs.steps.findIndex(s => s.id === questionId);
                    if (stepIndex >= 0) {
                        question = SALES_CHARTER.fulfillmentSpecs.steps[stepIndex];
                        stepName = "fulfillment_specs";
                    }
                } else if (SALES_CHARTER.launchKit && SALES_CHARTER.launchKit.steps.some(s => s.id === questionId)) {
                    const stepIndex = SALES_CHARTER.launchKit.steps.findIndex(s => s.id === questionId);
                    if (stepIndex >= 0) {
                        question = SALES_CHARTER.launchKit.steps[stepIndex];
                        stepName = "launch_kit";
                    }
                }
                
                if (question) {
                    // Mark that we're editing (store in clipboard for later detection)
                    memory.clipboard['_editing'] = questionId;
                    // Store original state to restore after edit
                    memory.clipboard['_originalQuestionIndex'] = originalQuestionIndex.toString();
                    memory.clipboard['_originalStep'] = originalStep;
                    
                    // Set step to the question's step (for UI activation)
                    memory.step = stepName;
                    // DO NOT change questionIndex - keep it at current position
                    
                    await this.state.storage.put("memory", memory);
                    
                    return this.jsonResponse({ 
                        reply: question.question,
                        flowState: {
                            step: memory.step,
                            packageName: memory.packageName,
                            variantName: memory.selectedVariantName,
                            hasPackage: !!memory.packageId,
                            hasVariant: !!memory.selectedVariantId,
                            questionIndex: memory.questionIndex // Keep original questionIndex
                        },
                        currentQuestion: {
                            id: question.id,
                            question: question.question,
                            options: (question as any).options || null,
                            multiple: (question as any).multiple !== undefined ? (question as any).multiple : true,
                            defaultValue: memory.clipboard[questionId] || null // Show current answer as default
                        }
                    });
                }
            }

            // Load or initialize memory
            let memory = await this.loadMemory();
            
            // Auto-reset stale sessions (older than 1 hour)
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            if (memory.lastActivity && memory.lastActivity < oneHourAgo) {
                console.log("[PackagehaSession] Stale session detected (older than 1 hour) - resetting");
                await this.state.storage.delete("memory");
                memory = await this.loadMemory(); // Creates fresh memory
            }

            // Determine flow (explicit from request or from memory)
            const requestedFlow = body.flow || memory.flow || "direct_sales";
            if (!memory.flow || memory.flow !== requestedFlow) {
                // Flow changed - reset to start of new flow
                memory.flow = requestedFlow as AgentFlow;
                memory.step = "start";
                memory.clipboard = {};
                memory.questionIndex = 0;
            }
            
            // Validate memory state - if we're in an invalid state, reset appropriately
            // Invalid states: 
            // 1. In package specs/variant/fulfillment/launch_kit steps without a package selected
            // 2. In package selection steps without completing product_details first (no product_details in clipboard)
            // 3. Stale or corrupted memory states
            const hasProductDetails = memory.clipboard && (
                memory.clipboard["product_description"] || 
                memory.clipboard["product_dimensions"] || 
                memory.clipboard["product_weight"]
            );
            
            // Check if custom package is selected
            const hasCustomPackage = memory.clipboard && memory.clipboard['custom_package'] === 'true';
            const hasPackage = !!memory.packageId || hasCustomPackage;
            
            // Reset invalid states
            // CRITICAL: Preserve package specs (material, print) when resetting package selection
            if ((memory.step === "select_package_specs" || memory.step === "select_package_variant" || 
                 memory.step === "fulfillment_specs" || memory.step === "launch_kit") && !hasPackage) {
                console.log("[PackagehaSession] Invalid memory state: in package steps without package selected - resetting to start");
                
                // Preserve package specs before clearing clipboard
                const preservedPackageSpecs: { [key: string]: string } = {};
                if (memory.clipboard) {
                    // Preserve material, print, and dimensions if they exist
                    if (memory.clipboard['material']) preservedPackageSpecs['material'] = memory.clipboard['material'];
                    if (memory.clipboard['print']) preservedPackageSpecs['print'] = memory.clipboard['print'];
                    if (memory.clipboard['dimensions']) preservedPackageSpecs['dimensions'] = memory.clipboard['dimensions'];
                }
                
                memory.step = "start";
                memory.questionIndex = 0;
                memory.clipboard = {};
                
                // Restore preserved package specs
                Object.assign(memory.clipboard, preservedPackageSpecs);
                
                memory.packageId = undefined;
                memory.selectedVariantId = undefined;
                memory.packageName = undefined;
                memory.selectedVariantName = undefined;
            } else if ((memory.step === "select_package" || memory.step === "select_package_discovery") && !hasProductDetails) {
                console.log("[PackagehaSession] Invalid memory state: in package selection without product details - resetting to product_details");
                memory.step = "product_details";
                memory.questionIndex = 0;
            } else if (memory.step === "start" && userMessage === "" && hasProductDetails) {
                // If we're at start but have product details, something is wrong - reset
                console.log("[PackagehaSession] Invalid memory state: at start with product details - resetting");
                memory.step = "start";
                memory.questionIndex = 0;
                memory.clipboard = {};
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
                packageName: memory.packageName, // Packageha's package (what we sell), NOT client's product
                variantName: memory.selectedVariantName,
                hasPackage: !!memory.packageId, // Packageha's package selected, NOT client's product
                hasVariant: !!memory.selectedVariantId,
                questionIndex: memory.questionIndex
            };
            
            // Add variant options if we're in variant selection step OR if package is selected but variant isn't
            // This helps frontend know what variants are available even if we haven't explicitly asked yet
            if (memory.packageId && memory.variants && !memory.selectedVariantId) {
                // Include variants for variant selection steps
                if (memory.step === "ask_variant" || memory.step === "select_package_variant" || 
                    (memory.step === "consultation" && memory.variants.length > 1)) {
                    response.variants = memory.variants.map(v => ({
                        id: v.id,
                        title: v.title,
                        price: v.price
                    }));
                }
            }
            
            // Add current consultation question based on current step
            let consultationPhase: { mission: string; steps: any[] } | null = null;
            if (memory.step === "product_details" && SALES_CHARTER.productDetails) {
                consultationPhase = SALES_CHARTER.productDetails;
            } else if (memory.step === "select_package_specs" && SALES_CHARTER.packageSpecs) {
                consultationPhase = SALES_CHARTER.packageSpecs;
            } else if (memory.step === "fulfillment_specs" && SALES_CHARTER.fulfillmentSpecs) {
                consultationPhase = SALES_CHARTER.fulfillmentSpecs;
            } else if (memory.step === "launch_kit" && SALES_CHARTER.launchKit) {
                consultationPhase = SALES_CHARTER.launchKit;
            } else if (memory.step === "consultation") {
                // Legacy consultation step (for old flows)
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
                    // Generate default value based on product/variant info if applicable
                    let defaultValue = null;
                    if (currentStep.id === "quantity" && memory.clipboard["quantity"]) {
                        defaultValue = memory.clipboard["quantity"];
                    } else if (currentStep.id === "dimensions" || currentStep.id === "product_dimensions") {
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
     * Direct Sales Flow - New structure with multiple steps
     * Steps: product_details -> select_package -> fulfillment_specs -> launch_kit -> draft_order
     */
    private async handleDirectSalesFlow(
        userMessage: string, 
        memory: Memory
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any; productMatches?: any[] }> {
        switch (memory.step) {
            case "start":
                // Start with product details step
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
                    SALES_CHARTER.productDetails!,
                    "select_package"
                );
                
            case "select_package":
            case "select_package_discovery":
                // Handle package discovery/search
                return await this.handlePackageSelection(userMessage, memory);
                
            case "select_package_variant":
                // Handle variant selection
                return await this.handleVariantSelection(userMessage, memory, SALES_CHARTER);
                
            case "select_package_specs":
                // Handle package specifications (material, dimensions, print)
                return await this.handleConsultationPhase(
                    userMessage,
                    memory,
                    SALES_CHARTER.packageSpecs!,
                    "fulfillment_specs"
                );
                
            case "fulfillment_specs":
                return await this.handleConsultationPhase(
                    userMessage,
                    memory,
                    SALES_CHARTER.fulfillmentSpecs!,
                    "launch_kit"
                );
                
            case "launch_kit":
                return await this.handleConsultationPhase(
                    userMessage,
                    memory,
                    SALES_CHARTER.launchKit!,
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
        // If we're in select_product or select_package_discovery step, check if user is selecting a number first
        if ((memory.step === "select_product" || memory.step === "select_package_discovery") && memory.pendingMatches) {
            const numMatch = userMessage.trim().match(/^(\d+)$/);
            if (numMatch) {
                const selectedNum = parseInt(numMatch[1]) - 1;
                if (selectedNum >= 0 && selectedNum < memory.pendingMatches.length) {
                    // User selected a package - get the package index from the match
                    const selectedPackageIndex = memory.pendingMatches[selectedNum].id;
                    
                    // Fetch packages from Shopify (they call them "products" in their API)
                    let products;
                    try {
                        products = await this.getCachedProducts();
                    } catch (error: any) {
                        return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
                    }
                    
                    const packageProduct = products[selectedPackageIndex];
                    if (!packageProduct) {
                        return { reply: "I found a match but couldn't load the package details. Please try again." };
                    }

                    // Store package info (Packageha's package, not client's product)
                    memory.packageName = packageProduct.title;
                    memory.packageId = packageProduct.id;
                    memory.variants = packageProduct.variants.map((v: any) => ({
                        id: v.id,
                        title: v.title,
                        price: v.price,
                    }));
                    memory.pendingMatches = undefined; // Clear pending matches

                    // Auto-skip variant selection if only one variant
                    if (memory.variants.length === 1) {
                        memory.selectedVariantId = memory.variants[0].id;
                        // Use "Default" instead of the variant title when auto-selecting single variant
                        memory.selectedVariantName = "Default";
                        // For direct_sales flow, use select_package_specs instead of consultation
                        if (memory.flow === "direct_sales") {
                            const result = this.transitionToPackageSpecs(memory);
                            return { reply: `Found **${packageProduct.title}**.\n\n${result.reply}` };
                        } else {
                            // Legacy flow
                            memory.step = "consultation";
                            memory.questionIndex = 0;
                            return { reply: `Found **${packageProduct.title}**.\n\nLet's get your project details.\n\n${charter.consultation.steps[0].question}` };
                        }
                    }

                    // Ask for variant selection
                    // For direct_sales flow, use select_package_variant instead of ask_variant
                    if (memory.flow === "direct_sales") {
                        memory.step = "select_package_variant";
                    } else {
                        memory.step = "ask_variant";
                    }
                    const options = memory.variants.map(v => v.title).join(", ");
                    return { reply: `Found **${packageProduct.title}**.\n\nWhich type are you interested in?\n\nOptions: ${options}` };
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
                // Don't reset step to "start" if we're in select_package_discovery - keep the current step
                if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
                    memory.step = "start";
                }
            }
        }
        
        // Handle greetings locally (save AI cost)
        if (this.isGreeting(userMessage)) {
            return { reply: "Hello! I'm your packaging consultant. What are you looking for? (e.g., 'Custom Boxes', 'Bags', 'Printing Services')" };
        }

        // Fetch packages from Shopify (they call them "products" in their API, but these are Packageha packages)
        let products;
        try {
            products = await this.getCachedProducts();
        } catch (error: any) {
            console.error("[handleDiscovery] Error fetching packages:", error);
            return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
        }

        if (products.length === 0) {
            return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
        }

        // Prepare inventory context - include full product names (including Arabic) for better AI reasoning
        const inventoryList = products.map((p, index) => {
            const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
            return `ID ${index}: ${cleanTitle}`;
        }).join("\n");

        // Build AI prompt with Charter - request multiple matches if available
        const systemPrompt = buildCharterPrompt("discovery", charter);
        
        // Include product details context if available (for direct sales flow)
        let productContext = '';
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
                productContext = `\n\nProduct Details:\n${contextParts.join('\n')}\n\nUse this context to recommend the most suitable packaging solution.`;
            }
        }
        
        const userPrompt = `Inventory:\n${inventoryList}\n\nUser Input: "${userMessage}"${productContext}\n\nReturn JSON:\n- If single match: { "type": "found", "id": <index>, "reason": "..." }\n- If multiple matches: { "type": "multiple", "matches": [{"id": <index>, "name": "<product_name>", "reason": "..."}, ...] }\n- If chatting: { "type": "chat", "reply": "..." }\n- If no match: { "type": "none", "reason": "..." }`;

        // Get AI decision
        const decision = await this.getAIDecision(userPrompt, systemPrompt);

        // Process decision
        if (decision.type === "chat") {
            return { reply: decision.reply || "I focus on packaging solutions. What are you looking for?" };
        }

        if (decision.type === "none") {
            // Smart fallback: suggest simpler search terms or show popular packages
            const fallbackMessage = "I couldn't find an exact match for that. Let me suggest some options:\n\n" +
                "• Try a simpler search like 'box', 'bag', or 'packaging'\n" +
                "• Or describe what you're looking for in different words\n" +
                "• You can also browse our catalog by searching for 'show all packages'\n\n" +
                "What type of packaging are you looking for?";
            return { reply: fallbackMessage };
        }

        // Handle multiple matches - return for user selection
        if (decision.type === "multiple" && decision.matches && decision.matches.length > 0) {
            const matches = decision.matches
                .filter(m => m.id !== undefined && products[m.id])
                .slice(0, 5) // Limit to 5 matches
                .map(m => {
                    const product = products[m.id!];
                    // Get first image URL if available
                    const imageUrl = product.images && product.images.length > 0 
                        ? product.images[0].src 
                        : null;
                    // Get price from first variant
                    const price = product.variants && product.variants.length > 0
                        ? product.variants[0].price
                        : null;
                    
                    return {
                        id: m.id!,
                        packageId: product.id, // Packageha's package ID
                        name: product.title,
                        reason: m.reason || "Matches your search",
                        imageUrl: imageUrl,
                        price: price
                    };
                });

            // Keep the current step (select_package_discovery) instead of resetting to select_product
            // Only set to select_product if we're in the old flow
            if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
                memory.step = "select_product";
            }
            memory.pendingMatches = matches;

            const matchesList = matches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
            return {
                reply: `I found ${matches.length} matching packages:\n\n${matchesList}\n\nPlease select a package by number (1-${matches.length}) or describe what you need more specifically.`,
                productMatches: matches
            };
        }

        // Handle single match
        const selectedPackageIndex = decision.id;

        if (selectedPackageIndex !== undefined && products[selectedPackageIndex]) {
            const packageProduct = products[selectedPackageIndex];
            if (!packageProduct) {
                return { reply: "I found a match but couldn't load the package details. Please try again." };
            }

            // Store package info (Packageha's package, not client's product)
            memory.packageName = packageProduct.title;
            memory.packageId = packageProduct.id;
            memory.variants = packageProduct.variants.map((v: any) => ({
                id: v.id,
                title: v.title,
                price: v.price,
            }));

            // Auto-skip variant selection if only one variant
            if (memory.variants.length === 1) {
                memory.selectedVariantId = memory.variants[0].id;
                memory.selectedVariantName = "Default";
                // For direct_sales flow, use select_package_specs instead of consultation
                if (memory.flow === "direct_sales") {
                    const result = this.transitionToPackageSpecs(memory);
                    return { reply: `Found **${packageProduct.title}**.\n\n${result.reply}` };
                } else {
                    // Legacy flow
                    memory.step = "consultation";
                    memory.questionIndex = 0;
                    return { reply: `Found **${packageProduct.title}**.\n\nLet's get your project details.\n\n${charter.consultation.steps[0].question}` };
                }
            }

            // Ask for variant selection
            // For direct_sales flow, use select_package_variant instead of ask_variant
            if (memory.flow === "direct_sales") {
                memory.step = "select_package_variant";
            } else {
                memory.step = "ask_variant";
            }
            const options = memory.variants.map(v => v.title).join(", ");
            return { reply: `Found **${packageProduct.title}**.\n\nWhich type are you interested in?\n\nOptions: ${options}` };
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
            memory.selectedVariantName = selected.title === "Default Title" ? "Default" : selected.title;
            
            // Move to package specs phase (preserving existing specs)
            const result = this.transitionToPackageSpecs(memory);
            return { 
                reply: `Selected **${selected.title}**.\n\n${result.reply}` 
            };
        }

        return { 
            reply: decision.reply || "Please select one of the options listed above." 
        };
    }

    /**
     * Helper function to transition to package specs while preserving existing answers
     */
    private transitionToPackageSpecs(memory: Memory): { reply: string } {
        memory.step = "select_package_specs";
        
        // Preserve existing package specs - don't reset questionIndex if specs already exist
        const hasPackageSpecs = memory.clipboard && (
            memory.clipboard['material'] || 
            memory.clipboard['print'] || 
            memory.clipboard['dimensions']
        );
        
        if (hasPackageSpecs && SALES_CHARTER.packageSpecs) {
            // We have existing specs - find the next unanswered question
            const packageSpecsSteps = SALES_CHARTER.packageSpecs.steps;
            let nextQuestionIndex = packageSpecsSteps.length; // Default to end (all answered)
            
            for (let i = 0; i < packageSpecsSteps.length; i++) {
                const stepId = packageSpecsSteps[i].id;
                if (!memory.clipboard[stepId]) {
                    nextQuestionIndex = i;
                    break;
                }
            }
            
            memory.questionIndex = nextQuestionIndex;
            
            // If all questions are answered, move to next step
            if (nextQuestionIndex >= packageSpecsSteps.length) {
                memory.step = "fulfillment_specs";
                memory.questionIndex = 0;
                if (!SALES_CHARTER.fulfillmentSpecs) {
                    return { reply: "Error: Fulfillment specs configuration missing." };
                }
                return { reply: SALES_CHARTER.fulfillmentSpecs.steps[0].question };
            } else {
                // Return the next unanswered question
                return { reply: packageSpecsSteps[nextQuestionIndex].question };
            }
        } else {
            // No existing specs - start from the beginning
            memory.questionIndex = 0;
            if (!SALES_CHARTER.packageSpecs) {
                return { reply: "Error: Package specs configuration missing." };
            }
            return { reply: SALES_CHARTER.packageSpecs.steps[0].question };
        }
    }

    /**
     * Generic consultation handler for any consultation phase
     * @param nextStep - The step to move to after this consultation is complete
     */
    private async handleConsultationPhase(
        userMessage: string, 
        memory: Memory,
        consultationPhase: { mission: string; steps: any[] },
        nextStep: string
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any }> {
        const steps = consultationPhase.steps;
        const currentIndex = memory.questionIndex;

        // Check if we're in edit mode
        const editingQuestionId = memory.clipboard['_editing'];
        const originalQuestionIndex = memory.clipboard['_originalQuestionIndex'] ? parseInt(memory.clipboard['_originalQuestionIndex']) : currentIndex;
        const originalStep = memory.clipboard['_originalStep'] || memory.step;

        // If userMessage is empty, return the current question (this happens on initial load or after step transition)
        if (!userMessage || userMessage.trim() === "") {
            if (currentIndex >= steps.length) {
                // All questions answered - move to next step
                memory.step = nextStep;
                memory.questionIndex = 0;
                if (nextStep === "draft_order") {
                    return await this.createProjectQuote(memory);
                }
                return this.getNextStepPrompt(nextStep);
            }
            // Return current question
            const currentStep = steps[currentIndex];
            return { reply: currentStep.question };
        }

        // Handle edit mode: if we're editing a question, just update that answer and return to original state
        if (editingQuestionId) {
            // Find the question being edited
            const editingStepIndex = steps.findIndex(s => s.id === editingQuestionId);
            if (editingStepIndex >= 0) {
                const editingStep = steps[editingStepIndex];
                
                // Validate answer if validator exists
                if (editingStep.validation) {
                    const validationResult = editingStep.validation(userMessage);
                    if (validationResult !== true) {
                        return { 
                            reply: typeof validationResult === "string" 
                                ? validationResult 
                                : "Please provide a valid answer." 
                        };
                    }
                }
                
                // Update the answer
                memory.clipboard[editingQuestionId] = userMessage;
                
                // Restore original state
                memory.questionIndex = originalQuestionIndex;
                memory.step = originalStep;
                
                // Clear edit flags
                delete memory.clipboard['_editing'];
                delete memory.clipboard['_originalQuestionIndex'];
                delete memory.clipboard['_originalStep'];
                
                await this.state.storage.put("memory", memory);
                
                // Return success message - frontend will handle showing the updated answer
                return { 
                    reply: `✓ Answer updated for "${editingStep.question}". You can continue or edit other questions.`
                };
            }
        }

        if (currentIndex >= steps.length) {
            // All questions answered - move to next step
            // This shouldn't happen if we're handling questions properly, but handle gracefully
            memory.step = nextStep;
            memory.questionIndex = 0;
            if (nextStep === "draft_order") {
                return await this.createProjectQuote(memory);
            }
            return this.getNextStepPrompt(nextStep);
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
            const nextStepQ = steps[memory.questionIndex];
            return { reply: nextStepQ.question };
        }

        // Last question answered - move to next phase
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
    private getNextStepPrompt(nextStep: string): { reply: string } {
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
    private async handlePackageSelection(
        userMessage: string,
        memory: Memory
    ): Promise<{ reply: string; productMatches?: any[] }> {
        // Check for custom package selection
        const lowerMessage = userMessage.toLowerCase().trim();
        if (lowerMessage.startsWith("custom package:") || lowerMessage.includes("custom") || 
            memory.clipboard['package_selection'] === 'custom') {
            // Extract dimensions if provided
            const dimMatch = userMessage.match(/custom package:\s*(.+)/i);
            if (dimMatch) {
                memory.clipboard['custom_package_dimensions'] = dimMatch[1];
            }
            
            // Handle custom package - continue with package specs (material, print, etc.)
            memory.packageName = "Custom Package";
            memory.selectedVariantName = "Custom";
            memory.clipboard['custom_package'] = 'true';
            // Go to package specs instead of skipping to fulfillment_specs
            memory.step = "select_package_specs";
            memory.questionIndex = 0;
            if (!SALES_CHARTER.packageSpecs) {
                return { reply: "Error: Package specs configuration missing." };
            }
            return { reply: `Great! I've noted your custom package dimensions. Now let's specify the package details.\n\n${SALES_CHARTER.packageSpecs.steps[0].question}` };
        }
        
        // Check if this is an edit request (user wants to change package)
        // Detect edit by checking if we're in package selection/discovery step but packageId exists
        // This means user is trying to search/select a new package while one is already selected
        const isEditRequest = memory.packageId && (
            memory.step === "select_package" || 
            memory.step === "select_package_discovery"
        );
        
        if (isEditRequest) {
            console.log("[handlePackageSelection] Edit request detected - clearing existing package selection");
            console.log("[handlePackageSelection] Current packageId:", memory.packageId);
            console.log("[handlePackageSelection] Current step:", memory.step);
            
            // Clear package selection but preserve package specs
            const preservedPackageSpecs: { [key: string]: string } = {};
            if (memory.clipboard) {
                if (memory.clipboard['material']) preservedPackageSpecs['material'] = memory.clipboard['material'];
                if (memory.clipboard['print']) preservedPackageSpecs['print'] = memory.clipboard['print'];
                if (memory.clipboard['dimensions']) preservedPackageSpecs['dimensions'] = memory.clipboard['dimensions'];
                console.log("[handlePackageSelection] Preserving package specs:", preservedPackageSpecs);
            }
            
            // Clear package selection
            memory.packageId = undefined;
            memory.selectedVariantId = undefined;
            memory.packageName = undefined;
            memory.selectedVariantName = undefined;
            memory.variants = undefined;
            
            // Restore preserved package specs
            Object.assign(memory.clipboard, preservedPackageSpecs);
            
            // Reset step to discovery
            memory.step = "select_package_discovery";
            memory.questionIndex = 0;
            
            console.log("[handlePackageSelection] After edit - packageId cleared, step reset to discovery");
        }
        
        // If we haven't selected a package yet, do discovery
        if (!memory.packageId) {
            // If message is empty or just whitespace, return a prompt (don't call handleDiscovery)
            if (!userMessage || userMessage.trim() === "") {
                memory.step = "select_package_discovery";
                return { reply: "Great! Now let's find the perfect package for your product. What type of packaging are you looking for?" };
            }
            
            memory.step = "select_package_discovery";
            const result = await this.handleDiscovery(userMessage, memory, SALES_CHARTER);
            
            // If discovery returned productMatches (multiple matches), return them immediately
            if (result.productMatches && result.productMatches.length > 0) {
                return result;
            }
            
            // If discovery found a package, handle variant selection
            if (memory.packageId && memory.variants) {
                if (memory.variants.length === 1) {
                    // Auto-select single variant
                    memory.selectedVariantId = memory.variants[0].id;
                    memory.selectedVariantName = "Default";
                    const result = this.transitionToPackageSpecs(memory);
                    return result;
                } else {
                    // Ask for variant
                    memory.step = "select_package_variant";
                    const options = memory.variants.map(v => v.title).join(", ");
                    return { reply: `Found **${memory.packageName}**.\n\nWhich type are you interested in?\n\nOptions: ${options}` };
                }
            }
            
            return result;
        }
        
        // Package already selected - this shouldn't happen, but handle gracefully
        return { reply: "Package already selected. Moving forward..." };
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
        memory: Memory,
        resetMemory: boolean = true
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any }> {
        // Package selection is optional (might be services only)
        // But typically we need at least package or services
        
        // Collect all answers from all consultation phases
        const allAnswers: string[] = [];
        
        // Product Details
        if (SALES_CHARTER.productDetails) {
            SALES_CHARTER.productDetails.steps.forEach(step => {
                const answer = memory.clipboard[step.id];
                if (answer) {
                    allAnswers.push(`- ${step.id.toUpperCase()}: ${answer}`);
                }
            });
        }
        
        // Package Specs
        if (SALES_CHARTER.packageSpecs) {
            SALES_CHARTER.packageSpecs.steps.forEach(step => {
                const answer = memory.clipboard[step.id];
                if (answer) {
                    allAnswers.push(`- PACKAGE ${step.id.toUpperCase()}: ${answer}`);
                }
            });
        }
        
        // Fulfillment Specs
        if (SALES_CHARTER.fulfillmentSpecs) {
            SALES_CHARTER.fulfillmentSpecs.steps.forEach(step => {
                const answer = memory.clipboard[step.id];
                if (answer) {
                    allAnswers.push(`- FULFILLMENT ${step.id.toUpperCase()}: ${answer}`);
                }
            });
        }
        
        // Launch Kit
        if (SALES_CHARTER.launchKit) {
            SALES_CHARTER.launchKit.steps.forEach(step => {
                const answer = memory.clipboard[step.id];
                if (answer) {
                    allAnswers.push(`- LAUNCH KIT ${step.id.toUpperCase()}: ${answer}`);
                }
            });
        }
        
        // Format project brief
        const briefNote = `--- PROJECT BRIEF ---
Package: ${memory.selectedVariantName || memory.packageName || "Not selected"}
${allAnswers.join("\n")}
---------------------
Generated by Studium AI Agent (${SALES_CHARTER.meta.name})
Timestamp: ${new Date().toISOString()}
`;

        // Parse quantity safely
        const qtyRaw = memory.clipboard['quantity'] || "1";
        const qtyNum = parseInt(qtyRaw.replace(/\D/g, '')) || 1;

        // Build custom line items for Launch Kit services
        const customLineItems: CustomLineItem[] = [];
        const serviceSelection = memory.clipboard['service_selection'];
        if (serviceSelection && serviceSelection !== "None - skip launch services") {
            // Parse service selection (could be comma-separated or array-like)
            const services = serviceSelection.split(',').map(s => s.trim()).filter(s => s && s !== "None - skip launch services");
            
            // Pricing for services (Saudi Arabia market prices in SAR)
            // Prices are extracted from option text (format: "Service Name - X,XXX SAR")
            services.forEach(service => {
                // Extract price from service string if present (format: "Service Name - X,XXX SAR")
                const priceMatch = service.match(/-\s*([\d,]+)\s*SAR/i);
                let price = "500.00"; // Default fallback
                
                if (priceMatch) {
                    // Remove commas and convert to decimal format
                    price = priceMatch[1].replace(/,/g, '') + ".00";
                } else {
                    // Fallback pricing if format doesn't match
                    const servicePricing: Record<string, string> = {
                        "Hero shot photography": "1200.00",
                        "Stop-motion unboxing video": "1800.00",
                        "E-commerce product photos": "900.00",
                        "3D render with packaging for website": "1500.00",
                        "Package design consultation": "600.00",
                        "Brand styling consultation": "700.00"
                    };
                    
                    // Try to match service name (without price)
                    const serviceName = service.split(' - ')[0].trim();
                    price = servicePricing[serviceName] || "500.00";
                }
                
                // Extract service name (remove price part)
                const serviceName = service.split(' - ')[0].trim();
                
                customLineItems.push({
                    title: serviceName,
                    price: price,
                    quantity: 1
                });
            });
        }
        
        // Handle Custom Package option
        const customPackageSelected = memory.clipboard['custom_package'] === 'true' || 
                                     memory.clipboard['package_selection'] === 'custom';
        if (customPackageSelected) {
            // Get custom package dimensions and calculate price
            const customDimensions = memory.clipboard['custom_package_dimensions'] || 
                                   memory.clipboard['dimensions'] || 
                                   'Not specified';
            
            // Extract dimensions and calculate price: L × W × H / 10
            const dimMatch = customDimensions.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
            let customPackagePrice = "0.00";
            if (dimMatch) {
                const length = parseFloat(dimMatch[1]);
                const width = parseFloat(dimMatch[2]);
                const height = parseFloat(dimMatch[3]);
                customPackagePrice = ((length * width * height) / 10).toFixed(2);
            } else if (memory.clipboard['custom_package_price']) {
                customPackagePrice = memory.clipboard['custom_package_price'];
            }
            
            customLineItems.push({
                title: `Custom Package (${customDimensions})`,
                price: customPackagePrice,
                quantity: parseInt(memory.clipboard['quantity'] || "1")
            });
        }

        try {
            const draftOrder = await createDraftOrder(
                this.env.SHOP_URL,
                this.env.SHOPIFY_ACCESS_TOKEN,
                memory.selectedVariantId || null, // Allow null if no package selected
                qtyNum,
                briefNote,
                customLineItems.length > 0 ? customLineItems : undefined
            );

            // createDraftOrder throws on error, so if we reach here, draftOrder is valid
            // Reset memory for new project only if resetMemory is true
            if (resetMemory) {
                await this.state.storage.delete("memory");
            } else {
                // Update last activity timestamp
                memory.lastActivity = Date.now();
                await this.state.storage.put("memory", memory);
            }
            
            // Return structured response with draft order info
            const replyMessage = resetMemory 
                ? `✅ **Project Brief Created!**\n\nI've attached all your specifications to the order. Please review and complete your purchase.\n\nType 'reset' to start a new project.`
                : `✅ **Draft Order Regenerated!**\n\nI've updated the order with your latest specifications. Please review and complete your purchase.`;
            
            return { 
                reply: replyMessage,
                memoryReset: resetMemory,
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
