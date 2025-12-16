import { searchProducts, createDraftOrder } from "./shopify";

export interface Env {
    PackagehaSession: DurableObjectNamespace;
    SHOPIFY_ACCESS_TOKEN: string;
    SHOP_URL: string;
    AI: any; // Binding for Cloudflare Workers AI
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
        const txt = (body.message || "").trim(); // Keep original casing for AI
        let reply = "";

        // RESET
        if (txt.toLowerCase() === "reset") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. I'm ready to help." }));
        }

        // --- PHASE 1: SEARCH ---
        if (memory.step === "start") {
            reply = "Let me check our inventory...";
            
            // 1. Ask AI to extract the search term
            // (User might say "Do you have any red boxes for cakes?")
            const aiSearch = await this.askAI(`Extract the main product keyword from this user request: "${txt}". Return ONLY the keyword.`);
            const query = aiSearch.replace(/[".]/g, "").trim(); 

            try {
                const products = await searchProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN, query);

                if (products.length > 0) {
                    const product = products[0]; // Take the best match
                    memory.productName = product.title;
                    // Save variants
                    memory.variants = product.variants.map((v: any) => ({
                        id: v.id,
                        title: v.title,
                        price: v.price
                    }));

                    // 2. Ask AI to introduce the product naturally
                    const variantList = memory.variants.map(v => `${v.title} (${v.price} SAR)`).join(", ");
                    reply = await this.askAI(`
                        You are a helpful sales assistant.
                        The user asked for "${txt}".
                        We found "${product.title}" with these options: ${variantList}.
                        Ask the user which specific option they would like. Keep it short.
                    `);
                    
                    memory.step = "ask_variant";
                } else {
                    reply = await this.askAI(`The user asked for "${txt}" but we couldn't find it. Apologize and ask if they want 'Boxes' or 'Bags' instead.`);
                }
            } catch (e: any) {
                reply = `System Error: ${e.message}`;
            }
        }

        // --- PHASE 2: SMART SELECTION ---
        else if (memory.step === "ask_variant") {
            // 3. Ask AI to match the user's text to an ID
            // This fixes the "small box" vs "Default Title" issue
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title} - ${v.price}`).join("\n");
            
            const aiDecision = await this.askAI(`
                User said: "${txt}"
                Available Options:
                ${optionsContext}
                
                Task: Which ID matches the user's intent? 
                If the user implies "the only one" or "standard", pick the single option.
                If it's unclear, reply "UNKNOWN".
                Return ONLY the ID number (e.g., "0") or "UNKNOWN".
            `);

            if (aiDecision.includes("UNKNOWN")) {
                reply = "I'm not sure which size you mean. Please type the name exactly as shown above.";
            } else {
                const index = parseInt(aiDecision.replace(/\D/g, ''));
                if (!isNaN(index) && memory.variants[index]) {
                    const selected = memory.variants[index];
                    memory.selectedVariantId = selected.id;
                    memory.selectedVariantPrice = selected.price;
                    memory.selectedVariantName = selected.title;
                    
                    reply = `Great choice (${selected.title}). How many do you need?`;
                    memory.step = "ask_qty";
                } else {
                    reply = "I couldn't match that option. Please try again.";
                }
            }
        }

        // --- PHASE 3: CHECKOUT ---
        else if (memory.step === "ask_qty") {
            const qty = parseInt(txt.replace(/\D/g, '')) || 10;
            const result = await createDraftOrder(
                this.env.SHOP_URL,
                this.env.SHOPIFY_ACCESS_TOKEN,
                memory.selectedVariantId,
                qty
            );

            if (result.startsWith("http")) {
                const total = (parseFloat(memory.selectedVariantPrice) * qty).toFixed(2);
                reply = await this.askAI(`
                    Write a short success message.
                    Order details: ${qty} x ${memory.productName} (${memory.selectedVariantName}).
                    Total price: ${total} SAR.
                    Tell them to click the link below to pay.
                `);
                reply += ` <br><br> <a href="${result}" target="_blank" style="color:blue; font-weight:bold;">Pay Now ➔</a>`;
                memory.step = "start";
            } else {
                reply = `⚠️ Error: ${result}`;
            }
        }

        await this.state.storage.put("memory", memory);
        return new Response(JSON.stringify({ reply: reply }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    // --- HELPER: TALK TO LLAMA 3 ---
    async askAI(prompt: string): Promise<string> {
        try {
            const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                messages: [
                    { role: "system", content: "You are a helpful e-commerce assistant for Packageha." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e) {
            console.log("AI Error", e);
            return "I am having trouble thinking right now. Please try again.";
        }
    }
}