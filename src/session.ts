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

        // --- RESET COMMAND ---
        if (txt.toLowerCase() === "reset") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. How can I help?" }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: SMART DISCOVERY ---
        if (memory.step === "start") {
            // 1. Get the real catalog first
            const products = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            if (products.length === 0) {
                reply = "I'm having trouble connecting to the store catalog right now.";
            } else {
                // 2. Prepare the list for the AI
                const inventoryList = products.map((p, index) => 
                    `ID ${index}: ${p.title} (Variants: ${p.variants.map((v:any)=>v.title).join(', ')})`
                ).join("\n");

                // 3. Ask AI to match User Input -> Inventory Item
                const aiResponse = await this.askAI(`
                    Current Inventory:
                    ${inventoryList}

                    User Request: "${txt}"

                    Task: Does the user request match any item in the inventory? 
                    - Ignore plural/singular differences (e.g. "Boxes" matches "Abstract Box").
                    - If it matches, return the ID number only.
                    - If it's a greeting like "hi", return "GREETING".
                    - If no match found, return "NONE".
                `);

                const decision = aiResponse.trim();

                if (decision.includes("GREETING")) {
                    reply = "Hello! I can help you with packaging. We have Boxes, Bags, and more. What do you need?";
                } else if (decision.includes("NONE")) {
                    reply = "I couldn't find a product like that in our catalog. Try asking for 'Boxes' or 'Bags'.";
                } else {
                    const index = parseInt(decision.replace(/\D/g, ''));
                    if (!isNaN(index) && products[index]) {
                        const product = products[index];
                        
                        // Save to Memory
                        memory.productName = product.title;
                        memory.variants = product.variants.map((v: any) => ({
                            id: v.id, title: v.title, price: v.price
                        }));

                        // Ask for Variant
                        const options = memory.variants.map(v => `${v.title}`).join(", ");
                        reply = `We have **${product.title}** (${options}). Which size/option would you like?`;
                        memory.step = "ask_variant";
                    } else {
                        reply = "I'm confusing myself. Let's try again. What are you looking for?";
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT SELECTION ---
        else if (memory.step === "ask_variant") {
            // Context Switching Check
            if (txt.toLowerCase().includes("box") || txt.toLowerCase().includes("bag")) {
                 await this.state.storage.delete("memory"); 
                 return new Response(JSON.stringify({ reply: "Let's start over. What product do you need?" })); 
            }

            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            const aiDecision = await this.askAI(`
                User Input: "${txt}"
                Available Options:
                ${optionsContext}
                
                Task: Return the ID of the option the user selected.
                If they say "Small", match it to "Small" or "S".
                If they say "The cheap one", pick the lowest price.
                Return ONLY the ID number. If unsure, return "UNKNOWN".
            `);

            if (aiDecision.includes("UNKNOWN")) {
                reply = "I'm not sure which option you mean. Please type the name from the list above.";
            } else {
                const index = parseInt(aiDecision.replace(/\D/g, ''));
                if (!isNaN(index) && memory.variants[index]) {
                    const selected = memory.variants[index];
                    memory.selectedVariantId = selected.id;
                    memory.selectedVariantPrice = selected.price;
                    memory.selectedVariantName = selected.title;
                    
                    reply = `Got it: ${selected.title}. How many do you need?`;
                    memory.step = "ask_qty";
                } else {
                    reply = "Please select one of the available options.";
                }
            }
        }

        // --- PHASE 3: CHECKOUT ---
        else if (memory.step === "ask_qty") {
            const qty = parseInt(txt.replace(/\D/g, ''));
            
            if (!qty) {
                 reply = "Please enter a valid number (e.g., 10, 20).";
            } else {
                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qty
                );

                if (result.startsWith("http")) {
                    const total = (parseFloat(memory.selectedVariantPrice) * qty).toFixed(2);
                    reply = `✅ Order Created!<br><b>${qty} x ${memory.productName}</b><br>Total: ${total} SAR<br><br><a href="${result}" target="_blank" style="background:black; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now ➔</a>`;
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
                    { role: "system", content: "You are a smart inventory assistant." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e) {
            return "UNKNOWN";
        }
    }
}