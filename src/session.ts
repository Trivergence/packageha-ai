import { searchProducts, createDraftOrder } from "./shopify";

export interface Env {
    PackagehaSession: DurableObjectNamespace;
    SHOPIFY_ACCESS_TOKEN: string;
    SHOP_URL: string;
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
        const txt = (body.message || "").toLowerCase().trim();
        let reply = "I didn't understand.";

        if (txt === "reset") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. What are you looking for?" }));
        }

        // --- CONVERSATION FLOW ---
        
        if (memory.step === "start") {
            const query = txt.includes("box") ? "box" : (txt.includes("bag") ? "bag" : txt);
            
            try {
                // The new search logic
                const products = await searchProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN, query);

                if (products.length > 0) {
                    const product = products[0];
                    memory.productName = product.title;
                    memory.variants = product.variants.map((v: any) => ({
                        id: v.id,
                        title: v.title,
                        price: v.price
                    }));
                    
                    const options = memory.variants.map((v: any) => `${v.title} (${v.price} SAR)`).join(", ");
                    reply = `Found **${product.title}**: ${options}. Which one?`;
                    memory.step = "ask_variant";
                } else {
                    reply = `I checked the store but found no products matching "${query}". (Make sure you have active products with that name!)`;
                }
            } catch (e: any) {
                // NOW WE WILL SEE THE REAL ERROR
                reply = `⚠️ System Error: ${e.message}`; 
            }
        }
        
        else if (memory.step === "ask_variant") {
            const selected = memory.variants.find((v: any) => txt.includes(v.title.toLowerCase()));
            
            if (selected) {
                memory.selectedVariantId = selected.id;
                memory.selectedVariantPrice = selected.price;
                memory.selectedVariantName = selected.title;
                reply = `Great (${selected.title}). How many?`;
                memory.step = "ask_qty";
            } else {
                reply = "Please choose a valid size from the list.";
            }
        }

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
                reply = `✅ Order for ${qty} x ${memory.productName}: ${total} SAR. <a href="${result}" target="_blank" style="color:blue;">Pay Now</a>`;
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
}