/**
 * PackagehaSession: The Being (Agent)
 * Stateful Durable Object that maintains conversation memory and follows the Charter
 */

import { getActiveProducts, createDraftOrder, CustomLineItem } from "./shopify";
import { 
    SALES_CHARTER, 
    LAUNCH_KIT_CHARTER, 
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
    AgentFlow
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

            // Handle cache warmup (internal)
            if (userMessage === "_warmup_cache_") {
                console.log("[PackagehaSession] Cache warmup requested");
                await this.getCachedProducts(); // This will fetch and cache products
                return this.jsonResponse({ reply: "Cache warmed up" });
            }

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

            // Handle Salla product selection (from store, image, or text)
            if (body.sallaAccessToken) {
                memory.sallaAccessToken = body.sallaAccessToken;
            }
            
            if (body.sallaProductId) {
                // Product selected from Salla store
                memory.sallaProductId = body.sallaProductId;
                // Fetch product details and populate clipboard
                if (body.sallaAccessToken) {
                    try {
                        const { getSallaProduct } = await import("./salla");
                        const sallaProduct = await getSallaProduct(body.sallaAccessToken, body.sallaProductId);
                        if (sallaProduct) {
                            // Populate product details from Salla product
                            if (sallaProduct.name) {
                                memory.clipboard["product_description"] = sallaProduct.name;
                                if (sallaProduct.description) {
                                    memory.clipboard["product_description"] += ` - ${sallaProduct.description}`;
                                }
                            }
                            if (sallaProduct.images && sallaProduct.images.length > 0) {
                                memory.sallaProductImageUrl = sallaProduct.images[0].url;
                            }
                            // If we have product info, skip to package selection
                            if (memory.step === "start" || memory.step === "product_details") {
                                memory.step = "select_package";
                                memory.questionIndex = 0;
                            }
                        }
                    } catch (error: any) {
                        console.error("[PackagehaSession] Error fetching Salla product:", error);
                    }
                }
            }
            
            if (body.productImageUrl || body.productImageBase64) {
                // Image uploaded or provided
                memory.uploadedProductImageUrl = body.productImageUrl || 
                    (body.productImageBase64 ? `data:image/jpeg;base64,${body.productImageBase64}` : undefined);
                // If we have an image, we can skip some product detail questions
                if (!memory.clipboard["product_description"] && memory.step === "start") {
                    memory.step = "product_details";
                    memory.questionIndex = 0;
                }
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
            let isAutoSearch: boolean | undefined = undefined;
            
            switch (memory.flow) {
                case "direct_sales":
                    const directSalesResult = await this.handleDirectSalesFlow(userMessage, memory);
                    reply = directSalesResult.reply;
                    memoryWasReset = directSalesResult.memoryReset || false;
                    draftOrder = directSalesResult.draftOrder;
                    productMatches = directSalesResult.productMatches;
                    isAutoSearch = directSalesResult.isAutoSearch;
                    break;
                case "launch_kit":
                    const launchKitResult = await this.handleLaunchKitFlow(userMessage, memory);
                    reply = launchKitResult.reply;
                    memoryWasReset = launchKitResult.memoryReset || false;
                    draftOrder = launchKitResult.draftOrder;
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
            if (productMatches) {
                response.productMatches = productMatches;
                // Mark if this is an auto-search result (either from handler or memory flag)
                if (isAutoSearch === true || (memory.clipboard && memory.clipboard['_autoSearch'] === 'true')) {
                    response.isAutoSearch = true;
                    // Clear the flag after using it
                    if (memory.clipboard && memory.clipboard['_autoSearch'] === 'true') {
                        delete memory.clipboard['_autoSearch'];
                    }
                }
            }
            
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
                if (memory.flow === "direct_sales" && SALES_CHARTER.consultation) {
                    consultationPhase = SALES_CHARTER.consultation;
                }
            }
            
            if (consultationPhase) {
                const steps = consultationPhase.steps;
                const currentIndex = memory.questionIndex;
                
                // Skip over already answered questions to find the next unanswered one
                let questionToShow = currentIndex;
                while (questionToShow < steps.length) {
                    const stepId = steps[questionToShow].id;
                    if (!memory.clipboard[stepId]) {
                        // Found an unanswered question
                        break;
                    }
                    questionToShow++;
                }
                
                if (questionToShow < steps.length) {
                    const currentStep = steps[questionToShow];
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
                // If questionToShow >= steps.length, all questions are answered, so don't set currentQuestion
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
    ): Promise<{ reply: string; memoryReset?: boolean; draftOrder?: any; productMatches?: any[]; isAutoSearch?: boolean }> {
        // Extract product info from message (Product: and Product Dimensions:)
        // This is for the new dimension-based matching system (NO package requirements)
        const productMatch = userMessage.match(/Product:\s*(.+?)(?:\n|$)/i);
        const dimensionsMatch = userMessage.match(/Product Dimensions:\s*(.+?)(?:\n|$)/i);
        
        if (productMatch || dimensionsMatch) {
            console.log("[handleDirectSalesFlow] Product info detected in message - triggering dimension-based matching");
            
            // Extract product description
            if (productMatch) {
                memory.clipboard['product_description'] = productMatch[1].trim();
                console.log("[handleDirectSalesFlow] Extracted product description:", memory.clipboard['product_description']);
            }
            
            // Extract product dimensions
            if (dimensionsMatch) {
                memory.clipboard['product_dimensions'] = dimensionsMatch[1].trim();
                console.log("[handleDirectSalesFlow] Extracted product dimensions:", memory.clipboard['product_dimensions']);
            }
            
            // Mark as auto-search so handleDiscovery uses dimension-based matching
            memory.clipboard['_autoSearch'] = 'true';
            
            // Set step to package discovery and trigger search
            memory.step = "select_package_discovery";
            memory.questionIndex = 0;
            
            // Trigger discovery with product description (dimension filtering will happen automatically)
            const productDescription = memory.clipboard['product_description'] || '';
            return await this.handlePackageSelection(productDescription, memory);
        }
        
        // CRITICAL: Check if this is a package edit request
        // Detect by: message starts with "edit package:" OR (packageId exists AND we're ahead in flow AND message matches product description)
        const isEditMessage = userMessage && userMessage.toLowerCase().startsWith("edit package:");
        const isAheadStep = memory.step === "fulfillment_specs" || 
                           memory.step === "launch_kit" ||
                           memory.step === "select_package_specs";
        const matchesProductDescription = memory.clipboard?.['product_description'] && 
                                         userMessage && 
                                         userMessage.trim() === memory.clipboard['product_description'].trim();
        
        const isPackageEditRequest = isEditMessage || (memory.packageId && isAheadStep && matchesProductDescription);
        
        // Extract actual search query if it's an edit message
        let searchQuery = userMessage;
        if (isEditMessage) {
            searchQuery = userMessage.replace(/^edit package:\s*/i, "").trim();
            console.log("[handleDirectSalesFlow] Extracted search query from edit message:", searchQuery || "(empty - edit mode only)");
        }
        
        if (isPackageEditRequest) {
            console.log("[handleDirectSalesFlow] Package edit request detected!");
            console.log("[handleDirectSalesFlow] Current step:", memory.step);
            console.log("[handleDirectSalesFlow] Current packageId:", memory.packageId);
            console.log("[handleDirectSalesFlow] User message:", userMessage);
            console.log("[handleDirectSalesFlow] Resetting to package selection");
            
            // Preserve package specs
            const preservedPackageSpecs: { [key: string]: string } = {};
            if (memory.clipboard) {
                if (memory.clipboard['material']) preservedPackageSpecs['material'] = memory.clipboard['material'];
                if (memory.clipboard['print']) preservedPackageSpecs['print'] = memory.clipboard['print'];
                if (memory.clipboard['dimensions']) preservedPackageSpecs['dimensions'] = memory.clipboard['dimensions'];
                console.log("[handleDirectSalesFlow] Preserving package specs:", preservedPackageSpecs);
            }
            
            // Clear package selection
            memory.packageId = undefined;
            memory.selectedVariantId = undefined;
            memory.packageName = undefined;
            memory.selectedVariantName = undefined;
            memory.variants = undefined;
            
            // Restore preserved package specs
            Object.assign(memory.clipboard, preservedPackageSpecs);
            
            // Reset to package discovery
            memory.step = "select_package_discovery";
            memory.questionIndex = 0;
            
            console.log("[handleDirectSalesFlow] After reset - step:", memory.step, "packageId:", memory.packageId);
            
            // If searchQuery is empty (just "edit package:"), return without triggering a search
            // This allows the frontend to show existing matches without triggering a new search
            if (!searchQuery || searchQuery.trim() === '') {
                console.log("[handleDirectSalesFlow] Empty edit query - returning prompt without search");
                return { reply: "What package are you looking for?" };
            }
            
            // Now handle as package selection with the search query
            return await this.handlePackageSelection(searchQuery, memory);
        }
        
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

    // ==================== SHARED HANDLERS ====================

    /**
     * Get products (with caching for 5 minutes)
     */
    private async getCachedProducts(): Promise<any[]> {
        const cacheKey = "products_cache";
        const cacheTimestampKey = "products_cache_timestamp";
        const CACHE_TTL = 30 * 60 * 1000; // 30 minutes (increased from 5 minutes for better consistency)

        try {
            // Check cache
            const cached = await this.state.storage.get<any[]>(cacheKey);
            const timestamp = await this.state.storage.get<number>(cacheTimestampKey);
            
            if (cached && timestamp && (Date.now() - timestamp) < CACHE_TTL) {
                console.log(`[getCachedProducts] Using cached products (${cached.length} products, cached ${Math.round((Date.now() - timestamp) / 1000 / 60)} minutes ago)`);
                return cached;
            }

            // Fetch fresh products - ensure we get ALL products
            console.log("[getCachedProducts] Fetching fresh products (all pages)...");
            const products = await getActiveProducts(
                this.env.SHOP_URL,
                this.env.SHOPIFY_ACCESS_TOKEN
            );

            console.log(`[getCachedProducts] Fetched ${products.length} total products`);

            // Cache products
            await this.state.storage.put(cacheKey, products);
            await this.state.storage.put(cacheTimestampKey, Date.now());

            return products;
        } catch (error: any) {
            console.error("[getCachedProducts] Error:", error);
            // If cache exists but fetch failed, return cached data even if expired
            const cached = await this.state.storage.get<any[]>(cacheKey);
            if (cached && cached.length > 0) {
                console.log(`[getCachedProducts] Fetch failed, using expired cache (${cached.length} products)`);
                return cached;
            }
            throw error;
        }
    }

    /**
     * Parse dimensions from text (e.g., "20x15x10 cm" or "8x6x4 inches")
     * Returns {length, width, height} in cm, or null if parsing fails
     */
    private parseDimensions(dimensionText: string): { length: number; width: number; height: number } | null {
        if (!dimensionText) return null;
        
        // Extract numbers and units
        const match = dimensionText.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|inches?|in)?/i);
        if (!match) return null;
        
        let length = parseFloat(match[1]);
        let width = parseFloat(match[2]);
        let height = parseFloat(match[3]);
        const unit = (match[4] || '').toLowerCase();
        
        // Convert inches to cm if needed
        if (unit.includes('inch') || unit === 'in') {
            length *= 2.54;
            width *= 2.54;
            height *= 2.54;
        }
        
        // Sort dimensions: length >= width >= height
        const dims = [length, width, height].sort((a, b) => b - a);
        
        return {
            length: dims[0],
            width: dims[1],
            height: dims[2]
        };
    }

    /**
     * Check if package dimensions can fit product dimensions
     * Package must be bigger in all dimensions
     */
    private canPackageFitProduct(packageDims: { length: number; width: number; height: number } | null, 
                                  productDims: { length: number; width: number; height: number } | null): boolean {
        if (!packageDims || !productDims) return true; // If dimensions unknown, allow match
        
        // Package must be bigger in all dimensions (with small tolerance for measurement errors)
        const tolerance = 0.5; // 0.5cm tolerance
        return packageDims.length >= (productDims.length - tolerance) &&
               packageDims.width >= (productDims.width - tolerance) &&
               packageDims.height >= (productDims.height - tolerance);
    }

    /**
     * Calculate keyword match score between product description and package description
     * Returns score from 0 to 1
     */
    private calculateKeywordMatchScore(productDescription: string, packageDescription: string): number {
        if (!productDescription || !packageDescription) return 0;
        
        // Normalize text
        const normalize = (text: string) => text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2); // Filter out very short words
        
        const productWords = new Set(normalize(productDescription));
        const packageWords = new Set(normalize(packageDescription));
        
        if (productWords.size === 0) return 0;
        
        // Count matching words
        let matches = 0;
        for (const word of productWords) {
            if (packageWords.has(word)) {
                matches++;
            }
        }
        
        // Score is ratio of matching words
        return matches / productWords.size;
    }

    /**
     * Calculate price score (lower price = higher score)
     * Returns score from 0 to 1
     */
    private calculatePriceScore(price: string | null, maxPrice: number): number {
        if (!price) return 0.5; // Neutral score if price unknown
        
        const priceValue = parseFloat(price);
        if (isNaN(priceValue) || maxPrice === 0) return 0.5;
        
        // Lower price = higher score (inverted)
        // Normalize to 0-1 range
        return Math.max(0, 1 - (priceValue / maxPrice));
    }

    private async handleDiscovery(userMessage: string, memory: Memory, charter: any, isAutoSearch: boolean = false): Promise<{ reply: string; productMatches?: any[] }> {
        // Fetch packages from Shopify first (needed for both selection and search)
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
        
        // Check if user is selecting a package by number OR by packageId
        if (memory.step === "select_product" || memory.step === "select_package_discovery") {
            const numMatch = userMessage.trim().match(/^(\d+)$/);
            if (numMatch) {
                const selectionValue = parseInt(numMatch[1]);
                
                // First, try to find by packageId (if it's a large number, likely a Shopify ID)
                // Shopify IDs are typically large numbers (6+ digits), while indices are small (0-20)
                let packageProduct = null;
                if (selectionValue > 1000) {
                    // Likely a packageId - search for it directly
                    packageProduct = products.find((p: any) => p.id === selectionValue);
                    if (packageProduct) {
                        console.log("[handleDiscovery] Found package by ID:", selectionValue, packageProduct.title);
                    }
                }
                
                // If not found by ID, try by index (for backward compatibility)
                if (!packageProduct && memory.pendingMatches) {
                    const selectedNum = selectionValue - 1;
                    if (selectedNum >= 0 && selectedNum < memory.pendingMatches.length) {
                        // User selected a package - get the package index from the match
                        const selectedPackageIndex = memory.pendingMatches[selectedNum].id;
                        packageProduct = products[selectedPackageIndex];
                        if (packageProduct) {
                            console.log("[handleDiscovery] Found package by index:", selectedNum, packageProduct.title);
                        }
                    }
                }
                
                if (packageProduct) {

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
                    // Invalid selection - return error
                    if (memory.pendingMatches && memory.pendingMatches.length > 0) {
                        const matchesList = memory.pendingMatches.map((m, i) => `${i + 1}. **${m.name}** - ${m.reason}`).join("\n");
                        return {
                            reply: `Please select a number between 1 and ${memory.pendingMatches.length}:\n\n${matchesList}`,
                            productMatches: memory.pendingMatches
                        };
                    } else {
                        return { reply: "Invalid selection. Please search for packages again." };
                    }
                }
            }
        }
        
        // If we reach here, user is searching (not selecting)
        // Clear pending matches if they exist
        if (memory.pendingMatches) {
            memory.pendingMatches = undefined;
        }
        
        // Handle greetings locally (save AI cost)
        if (this.isGreeting(userMessage)) {
            return { reply: "Hello! I'm your packaging consultant. What are you looking for? (e.g., 'Custom Boxes', 'Bags', 'Printing Services')" };
        }

        if (products.length === 0) {
            return { reply: "I'm having trouble accessing the package catalog. Please try again later." };
        }

        // NEW MATCHING LOGIC: Inclusive scoring only (no dimension filtering)
        console.log("[handleDiscovery] ========== NEW MATCHING LOGIC (Inclusive Scoring) ==========");
        
        // Extract product information from memory
        const productDescription = memory.clipboard?.product_description || userMessage.split('\n')[0] || '';
        const productDimensionsText = memory.clipboard?.product_dimensions || '';
        
        console.log("[handleDiscovery] Product description:", productDescription);
        console.log("[handleDiscovery] Product dimensions text:", productDimensionsText);
        console.log("[handleDiscovery] isAutoSearch:", isAutoSearch);
        console.log("[handleDiscovery] Total products available:", products.length);
        
        // Prepare inventory context - include ALL products with full details
        const inventoryList = products.map((p, index) => {
            const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
            const price = p.variants?.[0]?.price || 'N/A';
            // Include more context: title, price, and any available description/metadata
            return `ID ${index}: ${cleanTitle} (Price: ${price} SAR)`;
        }).join("\n");
        
        console.log("[handleDiscovery] Inventory list length:", inventoryList.length);
        console.log("[handleDiscovery] First 500 chars of inventory:", inventoryList.substring(0, 500));
        console.log("[handleDiscovery] Total products in inventory list:", products.length);
        
        // Build AI prompt for inclusive scoring (no filtering, only reject with clear reason)
        let systemPrompt = `You are a packaging matching system. Score ALL packages and return JSON.

CRITICAL: Return ONLY valid JSON. No explanations, no markdown, just JSON.

RULES:
1. BE INCLUSIVE: Include ALL packages. Only exclude if clearly wrong category (e.g., "food container" for "electronics").
2. Score by: Fitness (70%) = keyword match between product description and package name, Price (30%) = lower is better.
3. CRITICAL MATCHING RULE: Match based EXACTLY on the product description provided. 
   - If product is "soap", prioritize packages with "soap", "bath", "cosmetic", "personal care" keywords
   - If product is "perfume", prioritize packages with "perfume", "fragrance", "bottle", "cosmetic" keywords
   - DO NOT return perfume packages for soap products or vice versa
   - Look for semantic relationships: soap → bath products, cosmetics, personal care
   - Look for semantic relationships: perfume → fragrance, luxury, bottles, cosmetics
4. Return ALL matches sorted by combinedScore (highest first). Do not limit the number of matches.

REQUIRED JSON FORMAT (return exactly this structure):
{"type":"multiple","matches":[{"id":0,"name":"Package Name","reason":"Match explanation","fitnessScore":0.8,"priceScore":0.6,"combinedScore":0.74}]}

If inventory is empty, return: {"type":"none","reason":"No packages available"}`;

        let userPrompt = `Inventory (${products.length} total packages):\n${inventoryList}\n\n`;
        
        if (isAutoSearch && productDimensionsText) {
            userPrompt += `Product Description: "${productDescription}"\n`;
            userPrompt += `Product Dimensions: ${productDimensionsText}\n\n`;
            userPrompt += `Task: Score ALL ${products.length} packages based on how well they match the product description "${productDescription}". Return ALL matches as JSON sorted by combinedScore (highest first).`;
        } else {
            userPrompt += `Search Query: "${userMessage}"\n\n`;
            userPrompt += `Task: Score ALL ${products.length} packages that match the search query "${userMessage}". Return ALL matches as JSON sorted by combinedScore (highest first).`;
        }
        
        console.log("[handleDiscovery] Full user prompt (first 1000 chars):", userPrompt.substring(0, 1000));
        
        console.log("[handleDiscovery] System prompt length:", systemPrompt.length);
        console.log("[handleDiscovery] User prompt length:", userPrompt.length);
        
        // Get AI decision
        const decision = await this.getAIDecision(userPrompt, systemPrompt);
        
        // Process decision
        console.log("[handleDiscovery] Decision received:", JSON.stringify(decision, null, 2));
        
        if (decision.type === "chat") {
            // If we got a chat response but have products, return them anyway as fallback
            console.log("[handleDiscovery] Got chat response, using keyword-based fallback matching");
            console.log("[handleDiscovery] Product description for fallback:", productDescription);
            return this.createFallbackMatches(products, productDescription, memory);
        }

        if (decision.type === "none") {
            // Even if LLM says none, return fallback matches
            console.log("[handleDiscovery] Got 'none' response, using keyword-based fallback matching");
            console.log("[handleDiscovery] Product description for fallback:", productDescription);
            return this.createFallbackMatches(products, productDescription, memory);
        }

        // Handle multiple matches
        let matches: any[] = [];
        
        if (decision.type === "multiple" && decision.matches && decision.matches.length > 0) {
            matches = decision.matches
                .filter(m => m.id !== undefined && m.id >= 0 && m.id < products.length)
                // Return ALL matches, not just 10
                .map(m => {
                    const product = products[m.id!];
                    if (!product) {
                        console.warn(`[handleDiscovery] Product at index ${m.id} not found`);
                        return null;
                    }
                    const imageUrl = product.images && product.images.length > 0 
                        ? product.images[0].src 
                        : null;
                    const price = product.variants && product.variants.length > 0
                        ? product.variants[0].price
                        : null;
                    
                    return {
                        id: m.id!,
                        packageId: product.id,
                        name: product.title,
                        reason: m.reason || "Suitable for your product",
                        imageUrl: imageUrl,
                        price: price,
                        fitnessScore: m.fitnessScore || 0.5,
                        priceScore: m.priceScore || 0.5,
                        combinedScore: m.combinedScore || 0.5
                    };
                })
                .filter(m => m !== null);
        }
        
        if (matches.length > 0) {
            // Keep the current step
            if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
                memory.step = "select_product";
            }
            memory.pendingMatches = matches;

            return {
                reply: `I found ${matches.length} matching packages. They are sorted by relevance and price.`,
                productMatches: matches
            };
        }
        
        // Final fallback - return all products
        console.log("[handleDiscovery] No matches from LLM, using final fallback");
        return this.createFallbackMatches(products, productDescription, memory);
    }

    /**
     * Fallback: Return products with basic keyword matching when LLM fails
     */
    private createFallbackMatches(products: any[], productDescription: string, memory: Memory): { reply: string; productMatches: any[] } {
        // Extract keywords from product description for basic matching
        const description = (productDescription || '').toLowerCase().trim();
        const keywords = description.split(/\s+/).filter(w => w.length > 2); // Filter out short words
        
        console.log("[createFallbackMatches] Product description:", description);
        console.log("[createFallbackMatches] Extracted keywords:", keywords);
        console.log("[createFallbackMatches] Total products to match:", products.length);
        
        // Score products based on keyword matching
        const scoredProducts = products.map((product, index) => {
            const title = (product.title || '').toLowerCase();
            const cleanTitle = title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
            
            // Calculate fitness score based on keyword matches
            let fitnessScore = 0.1; // Base score
            let matchCount = 0;
            
            if (keywords.length > 0) {
                for (const keyword of keywords) {
                    if (cleanTitle.includes(keyword)) {
                        matchCount++;
                        fitnessScore += 0.3; // Increase score for each keyword match
                    }
                }
                // Normalize fitness score (max 1.0)
                fitnessScore = Math.min(1.0, fitnessScore);
            } else {
                // If no keywords, give all products equal low score
                fitnessScore = 0.1;
            }
            
            // Price score (lower price = higher score, normalized)
            const price = parseFloat(product.variants?.[0]?.price || '999999');
            const maxPrice = 2000; // Assume max reasonable price
            const priceScore = Math.max(0.1, 1.0 - (price / maxPrice));
            
            // Combined score: 70% fitness, 30% price
            const combinedScore = (fitnessScore * 0.7) + (priceScore * 0.3);
            
            return {
                product,
                index,
                fitnessScore,
                priceScore,
                combinedScore,
                matchCount
            };
        });
        
        // Sort by combined score (highest first), then by match count
        scoredProducts.sort((a, b) => {
            if (b.combinedScore !== a.combinedScore) {
                return b.combinedScore - a.combinedScore;
            }
            return b.matchCount - a.matchCount;
        });
        
        // Return ALL matches (sorted by score)
        const matches = scoredProducts.map((scored, idx) => {
            const product = scored.product;
            const imageUrl = product.images && product.images.length > 0 
                ? product.images[0].src 
                : null;
            const price = product.variants && product.variants.length > 0
                ? product.variants[0].price
                : null;
            
            // Generate reason based on match quality
            let reason = "Available package option";
            if (scored.matchCount > 0) {
                reason = `Matches your product (${scored.matchCount} keyword${scored.matchCount > 1 ? 's' : ''} found)`;
            }
            
            return {
                id: scored.index,
                packageId: product.id,
                name: product.title,
                reason: reason,
                imageUrl: imageUrl,
                price: price,
                fitnessScore: Math.round(scored.fitnessScore * 100) / 100,
                priceScore: Math.round(scored.priceScore * 100) / 100,
                combinedScore: Math.round(scored.combinedScore * 100) / 100
            };
        });

        if (memory.step !== "select_package_discovery" && memory.step !== "select_package") {
            memory.step = "select_product";
        }
        memory.pendingMatches = matches;

        const matchNote = description ? ` based on "${description}"` : '';
        
        console.log("[createFallbackMatches] Top matches found:", matches.length);
        if (matches.length > 0) {
            console.log("[createFallbackMatches] Best match:", matches[0].name, "score:", matches[0].combinedScore);
        }
        
        return {
            reply: `I found ${matches.length} available packages${matchNote}. They are sorted by relevance.`,
            productMatches: matches
        };
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
                
                // Check if fulfillment specs already exist - preserve progress
                const hasFulfillmentSpecs = memory.clipboard && (
                    memory.clipboard['quantity'] || 
                    memory.clipboard['timeline'] || 
                    memory.clipboard['shipping_address'] ||
                    memory.clipboard['special_instructions']
                );
                
                if (hasFulfillmentSpecs && SALES_CHARTER.fulfillmentSpecs) {
                    // Find the next unanswered question in fulfillment specs
                    const fulfillmentSteps = SALES_CHARTER.fulfillmentSpecs.steps;
                    let nextFulfillmentIndex = fulfillmentSteps.length; // Default to end (all answered)
                    
                    for (let i = 0; i < fulfillmentSteps.length; i++) {
                        const stepId = fulfillmentSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextFulfillmentIndex = i;
                            break;
                        }
                    }
                    
                    memory.questionIndex = nextFulfillmentIndex;
                    
                    // If all fulfillment questions are answered, move to launch_kit
                    if (nextFulfillmentIndex >= fulfillmentSteps.length) {
                        memory.step = "launch_kit";
                        memory.questionIndex = 0;
                        if (!SALES_CHARTER.launchKit) {
                            return { reply: "Error: Launch kit configuration missing." };
                        }
                        return { reply: SALES_CHARTER.launchKit.steps[0].question };
                    } else {
                        // Return the next unanswered fulfillment question
                        return { reply: fulfillmentSteps[nextFulfillmentIndex].question };
                    }
                } else {
                    // No existing fulfillment specs - start from the beginning
                    memory.questionIndex = 0;
                    if (!SALES_CHARTER.fulfillmentSpecs) {
                        return { reply: "Error: Fulfillment specs configuration missing." };
                    }
                    return { reply: SALES_CHARTER.fulfillmentSpecs.steps[0].question };
                }
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
                
                // Check if next step already has answers - preserve progress
                let nextStepQuestionIndex = 0;
                if (nextStep === "fulfillment_specs" && SALES_CHARTER.fulfillmentSpecs) {
                    const fulfillmentSteps = SALES_CHARTER.fulfillmentSpecs.steps;
                    for (let i = 0; i < fulfillmentSteps.length; i++) {
                        const stepId = fulfillmentSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextStepQuestionIndex = i;
                            break;
                        }
                    }
                    // If all answered, check launch_kit
                    if (nextStepQuestionIndex >= fulfillmentSteps.length && SALES_CHARTER.launchKit) {
                        memory.step = "launch_kit";
                        const launchKitSteps = SALES_CHARTER.launchKit.steps;
                        for (let i = 0; i < launchKitSteps.length; i++) {
                            const stepId = launchKitSteps[i].id;
                            if (!memory.clipboard[stepId]) {
                                nextStepQuestionIndex = i;
                                break;
                            }
                        }
                        if (nextStepQuestionIndex >= launchKitSteps.length) {
                            memory.step = "draft_order";
                            return await this.createProjectQuote(memory);
                        }
                    }
                } else if (nextStep === "launch_kit" && SALES_CHARTER.launchKit) {
                    const launchKitSteps = SALES_CHARTER.launchKit.steps;
                    for (let i = 0; i < launchKitSteps.length; i++) {
                        const stepId = launchKitSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextStepQuestionIndex = i;
                            break;
                        }
                    }
                    if (nextStepQuestionIndex >= launchKitSteps.length) {
                        memory.step = "draft_order";
                        return await this.createProjectQuote(memory);
                    }
                }
                
                memory.questionIndex = nextStepQuestionIndex;
                
                if (nextStep === "draft_order" || memory.step === "draft_order") {
                    return await this.createProjectQuote(memory);
                }
                return await this.getNextStepPrompt(memory.step, memory);
            }
            // Return current question - but first check if it's already answered
            // If it is, skip to the next unanswered question
            let questionToAsk = currentIndex;
            
            // Skip over already answered questions
            while (questionToAsk < steps.length) {
                const stepId = steps[questionToAsk].id;
                if (!memory.clipboard[stepId]) {
                    // Found an unanswered question
                    break;
                }
                questionToAsk++;
            }
            
            // Update questionIndex to the unanswered question
            memory.questionIndex = questionToAsk;
            
            if (questionToAsk >= steps.length) {
                // All questions answered - move to next step
                memory.step = nextStep;
                
                // Check if next step already has answers - preserve progress
                let nextStepQuestionIndex = 0;
                if (nextStep === "fulfillment_specs" && SALES_CHARTER.fulfillmentSpecs) {
                    const fulfillmentSteps = SALES_CHARTER.fulfillmentSpecs.steps;
                    for (let i = 0; i < fulfillmentSteps.length; i++) {
                        const stepId = fulfillmentSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextStepQuestionIndex = i;
                            break;
                        }
                    }
                    // If all answered, check launch_kit
                    if (nextStepQuestionIndex >= fulfillmentSteps.length && SALES_CHARTER.launchKit) {
                        memory.step = "launch_kit";
                        const launchKitSteps = SALES_CHARTER.launchKit.steps;
                        for (let i = 0; i < launchKitSteps.length; i++) {
                            const stepId = launchKitSteps[i].id;
                            if (!memory.clipboard[stepId]) {
                                nextStepQuestionIndex = i;
                                break;
                            }
                        }
                        if (nextStepQuestionIndex >= launchKitSteps.length) {
                            memory.step = "draft_order";
                            return await this.createProjectQuote(memory);
                        }
                    }
                } else if (nextStep === "launch_kit" && SALES_CHARTER.launchKit) {
                    const launchKitSteps = SALES_CHARTER.launchKit.steps;
                    for (let i = 0; i < launchKitSteps.length; i++) {
                        const stepId = launchKitSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextStepQuestionIndex = i;
                            break;
                        }
                    }
                    if (nextStepQuestionIndex >= launchKitSteps.length) {
                        memory.step = "draft_order";
                        return await this.createProjectQuote(memory);
                    }
                }
                
                memory.questionIndex = nextStepQuestionIndex;
                
                if (nextStep === "draft_order" || memory.step === "draft_order") {
                    return await this.createProjectQuote(memory);
                }
                return await this.getNextStepPrompt(memory.step, memory);
            }
            
            const currentStep = steps[questionToAsk];
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
            
            // Check if next step already has answers - preserve progress
            let nextStepQuestionIndex = 0;
            if (nextStep === "fulfillment_specs" && SALES_CHARTER.fulfillmentSpecs) {
                const fulfillmentSteps = SALES_CHARTER.fulfillmentSpecs.steps;
                for (let i = 0; i < fulfillmentSteps.length; i++) {
                    const stepId = fulfillmentSteps[i].id;
                    if (!memory.clipboard[stepId]) {
                        nextStepQuestionIndex = i;
                        break;
                    }
                }
                // If all answered, check launch_kit
                if (nextStepQuestionIndex >= fulfillmentSteps.length && SALES_CHARTER.launchKit) {
                    memory.step = "launch_kit";
                    const launchKitSteps = SALES_CHARTER.launchKit.steps;
                    for (let i = 0; i < launchKitSteps.length; i++) {
                        const stepId = launchKitSteps[i].id;
                        if (!memory.clipboard[stepId]) {
                            nextStepQuestionIndex = i;
                            break;
                        }
                    }
                    if (nextStepQuestionIndex >= launchKitSteps.length) {
                        memory.step = "draft_order";
                        return await this.createProjectQuote(memory);
                    }
                }
            } else if (nextStep === "launch_kit" && SALES_CHARTER.launchKit) {
                const launchKitSteps = SALES_CHARTER.launchKit.steps;
                for (let i = 0; i < launchKitSteps.length; i++) {
                    const stepId = launchKitSteps[i].id;
                    if (!memory.clipboard[stepId]) {
                        nextStepQuestionIndex = i;
                        break;
                    }
                }
                if (nextStepQuestionIndex >= launchKitSteps.length) {
                    memory.step = "draft_order";
                    return await this.createProjectQuote(memory);
                }
            }
            
            memory.questionIndex = nextStepQuestionIndex;
            
            if (nextStep === "draft_order" || memory.step === "draft_order") {
                return await this.createProjectQuote(memory);
            }
            return await this.getNextStepPrompt(memory.step, memory);
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
        return await this.getNextStepPrompt(nextStep, memory);
    }

    /**
     * Helper to get the prompt for the next step after a consultation phase completes
     */
    private async getNextStepPrompt(nextStep: string, memory: Memory): Promise<{ reply: string; productMatches?: any[]; isAutoSearch?: boolean }> {
        if (nextStep === "select_package") {
            // Transition to package selection step immediately
            memory.step = "select_package_discovery";
            
            // Build comprehensive search query from all product details
            const productContext: string[] = [];
            if (memory.clipboard) {
                if (memory.clipboard.product_description) {
                    productContext.push(memory.clipboard.product_description);
                }
                if (memory.clipboard.product_dimensions) {
                    productContext.push(`dimensions: ${memory.clipboard.product_dimensions}`);
                }
                if (memory.clipboard.product_weight) {
                    productContext.push(`weight: ${memory.clipboard.product_weight}`);
                }
                if (memory.clipboard.fragility) {
                    productContext.push(`fragility: ${memory.clipboard.fragility}`);
                }
                if (memory.clipboard.budget) {
                    productContext.push(`budget: ${memory.clipboard.budget}`);
                }
            }
            const autoSearchQuery = productContext.length > 0 ? productContext.join(', ') : "packaging";
            console.log("[getNextStepPrompt] Executing auto-search with query:", autoSearchQuery);
            
            // Execute the search immediately (frontend will show loading while waiting)
            // Pass isAutoSearch=true to include product context
            const result = await this.handleDiscovery(autoSearchQuery, memory, SALES_CHARTER, true);
            console.log("[getNextStepPrompt] Auto-search completed:", result.productMatches?.length || 0, "matches");
            
            // Return results with isAutoSearch flag
            return {
                ...result,
                isAutoSearch: true
            };
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
    ): Promise<{ reply: string; productMatches?: any[]; isAutoSearch?: boolean }> {
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
        // Detect edit by checking if packageId exists AND we're being called from a step that's NOT package selection
        // OR if we're explicitly in package selection/discovery step
        // This means user is trying to search/select a new package while one is already selected
        const isEditRequest = memory.packageId && (
            memory.step === "select_package" || 
            memory.step === "select_package_discovery" ||
            // Also detect if we're ahead in the flow but user sent a product search (edit request)
            (memory.step !== "select_package" && 
             memory.step !== "select_package_discovery" && 
             memory.step !== "select_package_variant" &&
             memory.step !== "select_package_specs" &&
             userMessage && userMessage.trim() !== "")
        );
        
        if (isEditRequest) {
            console.log("[handlePackageSelection] Edit request detected - clearing existing package selection");
            console.log("[handlePackageSelection] Current packageId:", memory.packageId);
            console.log("[handlePackageSelection] Current step:", memory.step);
            console.log("[handlePackageSelection] User message:", userMessage);
            
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
            // If message is empty or just whitespace, check if we should auto-search
            if (!userMessage || userMessage.trim() === "") {
                console.log("[handlePackageSelection] Empty message received, checking for auto-search flag");
                console.log("[handlePackageSelection] memory.clipboard['_autoSearch']:", memory.clipboard?.['_autoSearch']);
                // Check if we should trigger auto-search based on product details
                if (memory.clipboard && memory.clipboard['_autoSearch'] === 'true') {
                    console.log("[handlePackageSelection] Auto-search flag found, triggering search");
                    // Clear the flag
                    delete memory.clipboard['_autoSearch'];
                    // Build comprehensive search query from all product details
                    const productContext: string[] = [];
                    if (memory.clipboard.product_description) {
                        productContext.push(memory.clipboard.product_description);
                    }
                    if (memory.clipboard.product_dimensions) {
                        productContext.push(`dimensions: ${memory.clipboard.product_dimensions}`);
                    }
                    if (memory.clipboard.product_weight) {
                        productContext.push(`weight: ${memory.clipboard.product_weight}`);
                    }
                    if (memory.clipboard.fragility) {
                        productContext.push(`fragility: ${memory.clipboard.fragility}`);
                    }
                    if (memory.clipboard.budget) {
                        productContext.push(`budget: ${memory.clipboard.budget}`);
                    }
                    const autoSearchQuery = productContext.length > 0 ? productContext.join(', ') : "packaging";
                    console.log("[handlePackageSelection] Auto-triggering search with query:", autoSearchQuery);
                    memory.clipboard['_autoSearch'] = 'true'; // Mark for response
                    // Pass isAutoSearch=true to include product context
                    const result = await this.handleDiscovery(autoSearchQuery, memory, SALES_CHARTER, true);
                    console.log("[handlePackageSelection] Auto-search result:", result.productMatches?.length || 0, "matches");
                    // Ensure isAutoSearch flag is included in the result
                    return {
                        ...result,
                        isAutoSearch: true
                    };
                } else {
                    console.log("[handlePackageSelection] No auto-search flag, returning prompt");
                }
                memory.step = "select_package_discovery";
                return { reply: "Great! Now let's find the perfect package for your product. What type of packaging are you looking for?" };
            }
            
            memory.step = "select_package_discovery";
            
            // Check if this is an auto-search (package requirements detected)
            const isAutoSearch = memory.clipboard?.['_autoSearch'] === 'true';
            if (isAutoSearch) {
                console.log("[handlePackageSelection] Auto-search detected - including product context");
                delete memory.clipboard['_autoSearch']; // Clear flag after use
            }
            
            // Pass isAutoSearch flag to include/exclude product context
            const result = await this.handleDiscovery(userMessage, memory, SALES_CHARTER, isAutoSearch);
            
            // If discovery returned productMatches (multiple matches), return them immediately
            if (result.productMatches && result.productMatches.length > 0) {
                return {
                    ...result,
                    isAutoSearch: isAutoSearch // Preserve the auto-search flag
                };
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
            console.log("[getAIDecision] ========== CALLING AI ==========");
            console.log("[getAIDecision] System prompt length:", systemPrompt.length);
            console.log("[getAIDecision] User prompt length:", prompt.length);
            console.log("[getAIDecision] Total prompt length:", systemPrompt.length + prompt.length);
            
            const response = await this.sovereignSwitch.callAI(prompt, systemPrompt);
            
            console.log("[getAIDecision] Raw AI response length:", response.length);
            console.log("[getAIDecision] Raw AI response:", response);
            
            const cleanJson = this.sanitizeJSON(response);
            console.log("[getAIDecision] Cleaned JSON length:", cleanJson.length);
            console.log("[getAIDecision] Cleaned JSON:", cleanJson);
            
            const decision = JSON.parse(cleanJson) as AIDecision;
            console.log("[getAIDecision] Parsed decision:", JSON.stringify(decision, null, 2));
            
            // Validate decision structure
            if (!decision.type || !["found", "chat", "none", "multiple"].includes(decision.type)) {
                console.error("[getAIDecision] Invalid decision type:", decision.type);
                throw new Error("Invalid decision type");
            }
            
            console.log("[getAIDecision] ========== SUCCESS ==========");
            return decision;
        } catch (error: any) {
            console.error("[getAIDecision] ========== ERROR ==========");
            console.error("[getAIDecision] Error type:", error.constructor.name);
            console.error("[getAIDecision] Error message:", error.message);
            console.error("[getAIDecision] Error stack:", error.stack);
            
            // If error is due to empty response, log it specifically
            if (error.message && error.message.includes("empty response")) {
                console.error("[getAIDecision] Gemini returned empty response - will use keyword-based fallback matching");
            }
            
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
        let cleaned = text.replace(/```json|```/g, "").trim();
        
        // Try to extract JSON object if there's extra text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleaned = jsonMatch[0];
        }
        
        return cleaned;
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
