import { getActiveProducts, createDraftOrder } from "./shopify";
import { SALES_CHARTER } from "./charter"; // <--- IMPORT THE SOUL

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
        let memory = await this.state.storage.get("memory") || { step: "start" };
        const body = await request.json() as { message?: string };
        const txt = (body.message || "").trim();
        let reply = "";

        // --- RESET COMMAND ---
        if (txt.toLowerCase() === "reset" || txt === "إعادة") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. (تم مسح الذاكرة)" }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: DISCOVERY ---
        if (memory.step === "start") {
            const rawProducts = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            if (rawProducts.length === 0) {
                reply = "⚠️ System Error: Connected to Shopify, but found 0 active products.";
            } else {
                // CLEAN DATA
                const inventoryList = rawProducts.map((p, index) => {
                    const cleanTitle = p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim();
                    return `ID ${index}: ${cleanTitle} (Original: ${p.title})`;
                }).join("\n");

                // INJECT CHARTER (The Soul)
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
                console.log(`Debug: AI Decision: "${decision}"`);

                if (decision.includes("NONE")) {
                    reply = `I couldn't find a match for "${txt}" in your ${rawProducts.length} products.`;
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
                        reply = `Found: **${product.title}**. Options: ${options}. Which one?`;
                        memory.step = "ask_variant";
                    } else {
                        reply = `⚠️ Logic Error: AI selected ID ${decision}, but that product doesn't exist.`;
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT ---
        else if (memory.step === "ask_variant") {
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            // Hardcoded safeguard for context switching, reinforced by Charter
            if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag")) {
                 await this.state.storage.delete("memory");
                 return new Response(JSON.stringify({ reply: "Restarting search..." }), { headers: { "Access-Control-Allow-Origin": "*" }});
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
                    memory.selectedVariantPrice = selected.price;
                    reply = `Selected ${selected.title}. How many units do you need?`;
                    memory.step = "ask_qty";
                } else {
                    reply = `I didn't quite get that. Please select one of the options above.`;
                }
            }
        }

        // --- PHASE 3: CHECKOUT (Pure Logic, No AI needed) ---
        else if (memory.step === "ask_qty") {
            const qty = parseInt(txt.replace(/\D/g, ''));
            if (!qty) {
                 reply = "Please enter a valid number for quantity.";
            } else {
                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qty
                );
                
                if (result.startsWith("http")) {
                    reply = `✅ Order Ready: <a href="${result}" target="_blank">Click here to Pay Now</a>`;
                    // Wipe memory after success so they can start over
                    await this.state.storage.delete("memory");
                } else {
                    reply = `⚠️ Shopify Error: ${result}`;
                }
            }
        }

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