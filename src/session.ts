import { getActiveProducts, createDraftOrder } from "./shopify";
import { SALES_CHARTER } from "./charter";

export interface Env {
    PackagehaSession: DurableObjectNamespace;
    SHOPIFY_ACCESS_TOKEN: string;
    SHOP_URL: string;
    AI: any;
}

export class PackagehaSession {
    state: DurableObjectState;
    env: Env;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request) {
        // Initialize Memory with a "clipboard" for answers and a question tracker
        let memory = await this.state.storage.get("memory") || { 
            step: "start", 
            clipboard: {}, 
            questionIndex: 0 
        };
        
        const body = await request.json() as { message?: string };
        const txt = (body.message || "").trim();
        let reply = "";

        // --- RESET COMMAND ---
        if (txt.toLowerCase() === "reset" || txt === "إعادة") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. Starting over." }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: DISCOVERY (Find the Product) ---
        if (memory.step === "start") {
            const rawProducts = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            if (rawProducts.length === 0) {
                reply = "⚠️ System Error: Connected to Shopify, but found 0 active products.";
            } else {
                // 1. CLEAN THE DATA (Remove "TEST - ", "rs-")
                const inventoryList = rawProducts.map((p, index) => {
                    const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
                    return `ID ${index}: ${cleanTitle} (Original: ${p.title})`;
                }).join("\n");

                // 2. INJECT CHARTER (The Soul)
                const aiPrompt = `
                    You are: ${SALES_CHARTER.meta.tone}
                    
                    Inventory List:
                    ${inventoryList}
                    
                    User Request: "${txt}"
                    
                    Task: ${SALES_CHARTER.discovery.mission}
                    RULES:
                    ${SALES_CHARTER.discovery.rules.map(r => `- ${r}`).join("\n")}
                `;
                
                const decision = await this.askAI(aiPrompt);
                
                // Debugging Log
                console.log(`Debug: User said "${txt}" -> AI decided: "${decision}"`);

                if (decision.includes("NONE")) {
                    reply = `I couldn't find a match for "${txt}" in our product list. Could you describe it differently?`;
                } else if (decision.includes("ERROR")) {
                    reply = `⚠️ AI Brain Error: ${decision}`;
                } else {
                    const index = parseInt(decision.replace(/\D/g, ''));
                    if (!isNaN(index) && rawProducts[index]) {
                        const product = rawProducts[index];
                        memory.productName = product.title;
                        memory.variants = product.variants.map((v: any) => ({
                            id: v.id, title: v.title, price: v.price
                        }));
                        
                        const options = memory.variants.map(v => v.title).join(", ");
                        reply = `Found: **${product.title}**. \n\nOptions available: ${options}. \n\nWhich one would you like?`;
                        memory.step = "ask_variant";
                    } else {
                        reply = `⚠️ Logic Error: AI selected ID ${decision}, but that product doesn't exist.`;
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT SELECTION ---
        else if (memory.step === "ask_variant") {
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            // Context Switching Check (safeguard)
            if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag") || txt.toLowerCase() === "restart") {
                 await this.state.storage.delete("memory");
                 return new Response(JSON.stringify({ reply: "Sure, let's start over. What product are you looking for?" }), { headers: { "Access-Control-Allow-Origin": "*" }});
            }

            // INJECT CHARTER (The Soul)
            const aiPrompt = `
                Options:
                ${optionsContext}
                
                User Input: "${txt}"
                
                Task: ${SALES_CHARTER.variant.mission}
                RULES:
                ${SALES_CHARTER.variant.rules.map(r => `- ${r}`).join("\n")}
            `;

            const aiDecision = await this.askAI(aiPrompt);

            if (aiDecision.includes("RESTART")) {
                await this.state.storage.delete("memory");
                reply = "It sounds like you want to look for something else. What product are you looking for?";
            } else {
                const index = parseInt(aiDecision.replace(/\D/g, ''));
                if (!isNaN(index) && memory.variants[index]) {
                    const selected = memory.variants[index];
                    memory.selectedVariantId = selected.id;
                    memory.selectedVariantName = selected.title;
                    memory.selectedVariantPrice = selected.price;
                    
                    // --- TRANSITION TO CONSULTATION LOOP ---
                    memory.step = "consultation";
                    memory.questionIndex = 0; // Start at first question
                    
                    const firstQ = SALES_CHARTER.consultation.steps[0].question;
                    reply = `Great choice: **${selected.title}**. \n\nTo prepare your project quote, I need a few details.\n\n${firstQ}`;
                } else {
                    reply = `I didn't quite get that. Please select one of the options above (e.g., "${memory.variants[0].title}").`;
                }
            }
        }

        // --- PHASE 3: CONSULTATION LOOP (The Interview) ---
        else if (memory.step === "consultation") {
            const steps = SALES_CHARTER.consultation.steps;
            
            // 1. Capture the answer to the PREVIOUS question
            // (We are currently at memory.questionIndex)
            const currentStepDef = steps[memory.questionIndex];
            memory.clipboard[currentStepDef.id] = txt;

            // 2. Decide: Is there a NEXT question?
            if (memory.questionIndex < steps.length - 1) {
                // Yes, move to next question
                memory.questionIndex++; 
                const nextQ = steps[memory.questionIndex].question;
                reply = nextQ;
            } else {
                // No, we are done. Generate the Order.
                reply = "Thank you! Generating your project brief and quote...";
                
                // Format the Project Brief for the Merchant
                const briefNote = `
                --- PROJECT BRIEF ---
                Product: ${memory.selectedVariantName}
                ${steps.map(s => `- ${s.id.toUpperCase()}: ${memory.clipboard[s.id]}`).join("\n")}
                ---------------------
                Generated by Studium AI Agent
                `;

                // Try to parse quantity safely
                // We look at the 'quantity' field in the clipboard
                const qtyRaw = memory.clipboard['quantity'] || "1";
                const qtyNum = parseInt(qtyRaw.replace(/\D/g, '')) || 1;

                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qtyNum,
                    briefNote // <--- Attach the interview notes here
                );
                
                if (result.startsWith("http")) {
                    reply = `✅ **Project Brief Created!**\n\nI have attached your specifications to the order. Please review and pay here:\n<a href="${result}" target="_blank">View Project Quote</a>`;
                    // Wipe memory so they can start a new project
                    await this.state.storage.delete("memory");
                } else {
                    reply = `⚠️ Shopify Error: ${result}`;
                }
            }
        }

        // Save state for next turn
        await this.state.storage.put("memory", memory);
        
        return new Response(JSON.stringify({ reply: reply }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    async askAI(prompt: string): Promise<string> {
        if (!this.env.AI) return "ERROR: AI Binding Missing";

        try {
            const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                messages: [
                    { role: "system", content: SALES_CHARTER.meta.tone },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e: any) {
            return `ERROR: ${e.message}`;
        }
    }
}