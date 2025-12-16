import { searchProducts, createDraftOrder } from "./shopify";

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

        // --- GLOBAL RESET ---
        if (txt.toLowerCase() === "reset") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. I'm ready to help." }));
        }

        // --- PHASE 1: SEARCH ---
        if (memory.step === "start") {
            // 1. Ask AI to extract keyword
            const aiSearch = await this.askAI(`Extract the product keyword from: "${txt}". If it's just a greeting like 'hi', return 'GREETING'. Return ONLY the word.`);
            let query = aiSearch.replace(/[".]/g, "").trim(); 

            if (query === "GREETING") {
                reply = "Hello! I can help you find packaging. What are you looking for? (e.g., Boxes, Bags)";
            } else {
                try {
                    const products = await searchProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN, query);

                    if (products.length > 0) {
                        const product = products[0];
                        memory.productName = product.title;
                        memory.variants = product.variants.map((v: any) => ({
                            id: v.id, title: v.title, price: v.price
                        }));

                        const variantList = memory.variants.map(v => `${v.title} (${v.price} SAR)`).join(", ");
                        reply = await this.askAI(`
                            User asked for "${txt}". Found "${product.title}" with options: ${variantList}.
                            Ask which option they want. Be brief.
                        `);
                        memory.step = "ask_variant";
                    } else {
                        reply = "I couldn't find that. Try searching for 'Box' or 'Bag'.";
                    }
                } catch (e: any) {
                    reply = `System Error: ${e.message}`;
                }
            }
        }

        // --- PHASE 2: SELECTION ---
        else if (memory.step === "ask_variant") {
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            // Check if user wants to change product
            if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag")) {
                 await this.state.storage.delete("memory"); // Reset
                 return this.fetch(request); // Recursion: Treat as new search
            }

            const aiDecision = await this.askAI(`
                User input: "${txt}"
                Options:
                ${optionsContext}
                
                Task: Return the ID number that matches the input.
                If the input is unrelated or unclear, return "UNKNOWN".
                ONLY return the number or "UNKNOWN".
            `);

            if (aiDecision.includes("UNKNOWN")) {
                reply = "I didn't catch that. Please type the option name exactly (or type 'reset' to start over).";
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
            const numberPattern = /\d+/;
            
            // STRICT CHECK: Must contain a number
            if (!numberPattern.test(txt)) {
                 // Check if they are trying to search again
                 if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag")) {
                     await this.state.storage.delete("memory");
                     return this.fetch(request); // Treat as search
                 }
                 reply = "Please enter a valid number for the quantity.";
            } else {
                const qty = parseInt(txt.match(numberPattern)[0]); // Extract real number
                
                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qty
                );

                if (result.startsWith("http")) {
                    const total = (parseFloat(memory.selectedVariantPrice) * qty).toFixed(2);
                    reply = await this.askAI(`
                        Write a short success message for order: ${qty} x ${memory.productName}.
                        Total: ${total} SAR.
                        IMPORTANT: Do NOT generate any URL or link text. Just say 'Click below'.
                    `);
                    reply += ` <br><br> <a href="${result}" target="_blank" style="background:black; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now ➔</a>`;
                    memory.step = "start";
                } else {
                    reply = `⚠️ Error: ${result}`;
                }
            }
        }

        await this.state.storage.put("memory", memory);
        return new Response(JSON.stringify({ reply: reply }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    async askAI(prompt: string): Promise<string> {
        try {
            const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                messages: [
                    { role: "system", content: "You are a helpful assistant for Packageha." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e) {
            return "Thinking...";
        }
    }
}