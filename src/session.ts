import { getActiveProducts, createDraftOrder } from "./shopify";

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

        // --- RESET ---
        if (txt.toLowerCase() === "reset" || txt === "إعادة") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. (تم مسح الذاكرة)" }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: DISCOVERY ---
        if (memory.step === "start") {
            // 1. Fetch Products
            const products = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            if (products.length === 0) {
                reply = "⚠️ System Error: Connected to Shopify, but found 0 active products. Check your Shopify Admin status.";
            } else {
                // Optimize list to save AI tokens (Title only)
                const inventoryList = products.map((p, index) => `ID ${index}: ${p.title}`).join("\n");

                // 2. Ask AI (Aggressive Fuzzy Match)
                const aiPrompt = `
                    Inventory:
                    ${inventoryList}
                    
                    User Request: "${txt}"
                    
                    Task: Return the ID of the product that matches the User Request.
                    RULES:
                    1. Be Flexible: "Boxes" matches "Abstract Box". "Photo" matches "Photography".
                    2. Ignore spelling errors.
                    3. If multiple match, pick the best one.
                    4. Return ONLY the ID number (e.g., "5").
                    5. If ABSOLUTELY no match, return "NONE".
                `;
                
                const decision = await this.askAI(aiPrompt);

                // --- DEBUG LOGIC (Tells you why it failed) ---
                console.log(`Debug: List size ${products.length}. AI said: "${decision}"`);

                if (decision.includes("NONE")) {
                    reply = `I couldn't find a match for "${txt}" in your ${products.length} products. (AI said: ${decision})`;
                } else {
                    const index = parseInt(decision.replace(/\D/g, ''));
                    // Check if index is valid number AND exists in array
                    if (!isNaN(index) && products[index]) {
                        const product = products[index];
                        memory.productName = product.title;
                        memory.variants = product.variants.map((v: any) => ({
                            id: v.id, title: v.title, price: v.price
                        }));
                        
                        const options = memory.variants.map(v => v.title).join(", ");
                        reply = `Found: **${product.title}**. Options: ${options}. Which one?`;
                        memory.step = "ask_variant";
                    } else {
                        // Fallback if AI returned garbage
                        reply = `I am confused. AI suggested "ID ${decision}" but that product doesn't exist.`;
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT ---
        else if (memory.step === "ask_variant") {
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag")) {
                 await this.state.storage.delete("memory");
                 return new Response(JSON.stringify({ reply: "Restarting search..." }), { headers: { "Access-Control-Allow-Origin": "*" }});
            }

            const aiDecision = await this.askAI(`
                Options:
                ${optionsContext}
                User: "${txt}"
                Task: Return the ID of the selected option.
                Return ONLY the ID number.
            `);

            const index = parseInt(aiDecision.replace(/\D/g, ''));
            if (!isNaN(index) && memory.variants[index]) {
                const selected = memory.variants[index];
                memory.selectedVariantId = selected.id;
                memory.selectedVariantPrice = selected.price;
                memory.selectedVariantName = selected.title;
                reply = `Selected ${selected.title}. How many?`;
                memory.step = "ask_qty";
            } else {
                reply = `I didn't understand which option. (AI said: ${aiDecision})`;
            }
        }

        // --- PHASE 3: CHECKOUT ---
        else if (memory.step === "ask_qty") {
            const qty = parseInt(txt.replace(/\D/g, ''));
            if (!qty) {
                 reply = "Please enter a number.";
            } else {
                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qty
                );
                
                if (result.startsWith("http")) {
                    reply = `✅ Order Ready: <a href="${result}" target="_blank">Pay Now</a>`;
                    memory.step = "start";
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
                    { role: "system", content: "You are a helpful assistant." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e: any) {
            return `ERROR: ${e.message}`;
        }
    }
}