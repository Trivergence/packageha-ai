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
        if (txt.toLowerCase() === "reset" || txt === "إعادة" || txt === "ريست") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. How can I help? (تم مسح الذاكرة)" }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: DISCOVERY (BILINGUAL) ---
        if (memory.step === "start") {
            const products = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            if (products.length === 0) {
                reply = "System: Cannot connect to store catalog.";
            } else {
                // Prepare list for AI (English + Arabic titles)
                const inventoryList = products.map((p, index) => 
                    `ID ${index}: ${p.title} (Variants: ${p.variants.map((v:any)=>v.title).join(', ')})`
                ).join("\n");

                // SMART PROMPT
                const aiResponse = await this.askAI(`
                    You are a smart bilingual sales assistant (English & Arabic).
                    
                    Current Inventory:
                    ${inventoryList}

                    User Request: "${txt}"

                    Task: Match the user's request to an Inventory ID based on MEANING.
                    - If user says "Photography" and we have "خدمة تصوير", that is a MATCH.
                    - If user says "Boxes" and we have "Abstract Box", that is a MATCH.
                    - If user says "hi" or "مرحبا", return "GREETING".
                    - If no semantic match found, return "NONE".
                    
                    Return ONLY the ID number (e.g. "5") or "GREETING" or "NONE".
                `);

                const decision = aiResponse.trim();

                if (decision.includes("GREETING")) {
                    reply = "Hello! I can help you with packaging or services. What do you need? (أهلا بك، كيف يمكنني مساعدتك؟)";
                } else if (decision.includes("NONE")) {
                    reply = "I couldn't find a matching product. Try 'Boxes' or 'Photography'. (لم أجد منتجًا مطابقًا)";
                } else {
                    const index = parseInt(decision.replace(/\D/g, ''));
                    if (!isNaN(index) && products[index]) {
                        const product = products[index];
                        
                        memory.productName = product.title;
                        memory.variants = product.variants.map((v: any) => ({
                            id: v.id, title: v.title, price: v.price
                        }));

                        const options = memory.variants.map(v => `${v.title}`).join(", ");
                        reply = `We have **${product.title}** (${options}). Which option do you want?`;
                        memory.step = "ask_variant";
                    } else {
                        reply = "I am confused. Please try again.";
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT SELECTION ---
        else if (memory.step === "ask_variant") {
            // Check for Context Switch
            if (txt.includes("box") || txt.includes("bag") || txt.includes("علب") || txt.includes("كيس")) {
                 await this.state.storage.delete("memory"); 
                 return new Response(JSON.stringify({ reply: "Switching topics... What do you need? (جاري التبديل... ماذا تحتاج؟)" })); 
            }

            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            const aiDecision = await this.askAI(`
                User Input: "${txt}"
                Available Options:
                ${optionsContext}
                
                Task: Return the ID of the option the user wants.
                - Match "Small" to "S" or "صغير".
                - Match "Default Title" if they imply "the only one" or "yes".
                
                Return ONLY the ID number. If unsure, return "UNKNOWN".
            `);

            if (aiDecision.includes("UNKNOWN")) {
                reply = "Please select one of the options above. (الرجاء اختيار أحد الخيارات)";
            } else {
                const index = parseInt(aiDecision.replace(/\D/g, ''));
                if (!isNaN(index) && memory.variants[index]) {
                    const selected = memory.variants[index];
                    memory.selectedVariantId = selected.id;
                    memory.selectedVariantPrice = selected.price;
                    memory.selectedVariantName = selected.title;
                    
                    reply = `Selected: ${selected.title}. How many do you need? (العدد المطلوب؟)`;
                    memory.step = "ask_qty";
                } else {
                    reply = "Invalid selection.";
                }
            }
        }

        // --- PHASE 3: CHECKOUT ---
        else if (memory.step === "ask_qty") {
            // Extract number (English or Arabic digits)
            const qty = parseInt(txt.replace(/\D/g, ''));
            
            if (!qty) {
                 reply = "Please enter a number. (الرجاء كتابة رقم)";
            } else {
                const result = await createDraftOrder(
                    this.env.SHOP_URL,
                    this.env.SHOPIFY_ACCESS_TOKEN,
                    memory.selectedVariantId,
                    qty
                );

                if (result.startsWith("http")) {
                    const total = (parseFloat(memory.selectedVariantPrice) * qty).toFixed(2);
                    reply = `✅ Order Ready!<br><b>${qty} x ${memory.productName}</b><br>Total: ${total} SAR<br><br><a href="${result}" target="_blank" style="background:#000; color:#fff; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now (ادفع الآن) ➔</a>`;
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
                    { role: "system", content: "You are a bilingual e-commerce assistant." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e) {
            return "UNKNOWN";
        }
    }
}