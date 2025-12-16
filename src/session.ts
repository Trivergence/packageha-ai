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
        
        // Step 0: User asks for a product (e.g., "I want a box")
        if (memory.step === "start") {
            reply = "Searching our catalog..."; // Temporary loading message concept
            
            // 1. Search Shopify for what they typed
            // We search for "Box" or "Bag" based on input
            const query = txt.includes("box") ? "Box" : (txt.includes("bag") ? "Bag" : txt);
            const products = await searchProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN, query);

            if (products.length > 0) {
                // Found it! Let's pick the first matching product
                const product = products[0];
                memory.productName = product.title;
                memory.variants = product.variants.map((v: any) => ({
                    id: v.id,
                    title: v.title, // e.g., "Small", "Large"
                    price: v.price
                }));
                
                // List options to user
                const options = memory.variants.map((v: any) => `${v.title} (${v.price} SAR)`).join(", ");
                reply = `We have **${product.title}** available in: ${options}. Which one do you want?`;
                memory.step = "ask_variant";
            } else {
                reply = "I couldn't find that product in the store. Try 'Box' or 'Bag'.";
            }
        }
        
        // Step 1: User picks a variant (e.g., "Small")
        else if (memory.step === "ask_variant") {
            // Find the variant that matches user text
            const selected = memory.variants.find((v: any) => txt.includes(v.title.toLowerCase()));
            
            if (selected) {
                memory.selectedVariantId = selected.id;
                memory.selectedVariantPrice = selected.price;
                memory.selectedVariantName = selected.title;
                reply = `Great choice (${selected.title} - ${selected.price} SAR). How many do you need?`;
                memory.step = "ask_qty";
            } else {
                reply = "Please choose one of the available sizes.";
            }
        }

        // Step 2: Quantity -> Checkout
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
                reply = `✅ Order created! ${qty} x ${memory.productName} (${memory.selectedVariantName}). Total: ${total} SAR. <a href="${result}" target="_blank" style="color:blue;">Click to Pay</a>`;
                memory.step = "start";
            } else {
                reply = `⚠️ Error creating order: ${result}`;
            }
        }

        await this.state.storage.put("memory", memory);
        return new Response(JSON.stringify({ reply: reply }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}