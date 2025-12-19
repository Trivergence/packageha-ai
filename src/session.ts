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
        let memory = await this.state.storage.get("memory") || { 
            step: "start", 
            clipboard: {}, 
            questionIndex: 0 
        };
        
        const body = await request.json() as { message?: string };
        const txt = (body.message || "").trim();
        let reply = "";

        // --- GLOBAL RESET ---
        if (txt.toLowerCase() === "reset" || txt === "إعادة") {
            await this.state.storage.delete("memory");
            return new Response(JSON.stringify({ reply: "♻️ Memory wiped. Starting over." }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // --- PHASE 1: DISCOVERY (Smart Search) ---
        if (memory.step === "start") {
            const rawProducts = await getActiveProducts(this.env.SHOP_URL, this.env.SHOPIFY_ACCESS_TOKEN);
            
            // 1. Check for simple greetings locally (Save AI cost)
            const greetings = ["hi", "hello", "hey", "hola", "مرحبا", "هلا"];
            if (greetings.includes(txt.toLowerCase())) {
                return new Response(JSON.stringify({ reply: "Hello! I can help you find packaging. What are you looking for? (e.g., 'Custom Boxes', 'Bags')" }), {
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }

            // 2. Prepare Inventory Context
            const inventoryList = rawProducts.map((p, index) => 
                `ID ${index}: ${p.title.replace(/TEST\s?-\s?|rs-/gi, "").trim()}`
            ).join("\n");

            // 3. Strict JSON Prompt
            const aiPrompt = `
                Inventory:
                ${inventoryList}
                
                User Input: "${txt}"
                
                You are a search router. Analyze the input and return ONLY a JSON object.
                
                SCENARIOS:
                A. Exact/Fuzzy Match found -> { "type": "found", "id": 5, "reason": "Matches 'box'" }
                B. User is just chatting/confused -> { "type": "chat", "reply": "I focus on packaging. Try searching for 'boxes'." }
                C. No match found -> { "type": "none", "reason": "No product matches" }
                
                RETURN JSON ONLY. NO MARKDOWN.
            `;
            
            const decisionRaw = await this.askAI(aiPrompt);
            console.log("AI Decision:", decisionRaw); // Debug in dashboard

            let decision;
            try {
                // Sanitize output in case AI adds markdown
                const cleanJson = decisionRaw.replace(/```json|```/g, "").trim();
                decision = JSON.parse(cleanJson);
            } catch (e) {
                // Fallback if AI fails to output JSON
                decision = { type: "chat", reply: "I'm having trouble connecting to the catalog. Try 'reset'." };
            }

            if (decision.type === "chat") {
                reply = decision.reply;
            } else if (decision.type === "none") {
                reply = "I couldn't find that product. We have Boxes, Bags, and Printing services. What do you need?";
            } else if (decision.type === "found") {
                const index = decision.id;
                if (rawProducts[index]) {
                    const product = rawProducts[index];
                    memory.productName = product.title;
                    memory.variants = product.variants.map((v: any) => ({
                        id: v.id, title: v.title, price: v.price
                    }));

                    // AUTO-SKIP if only 1 variant (Fixes "Default Title" issue)
                    if (memory.variants.length === 1) {
                        memory.selectedVariantId = memory.variants[0].id;
                        memory.selectedVariantName = memory.variants[0].title;
                        
                        memory.step = "consultation";
                        memory.questionIndex = 0;
                        const firstQ = SALES_CHARTER.consultation.steps[0].question;
                        reply = `Found **${product.title}**. \n\nLet's get your details.\n${firstQ}`;
                    } else {
                        // Ask for variant
                        const options = memory.variants.map(v => v.title).join(", ");
                        reply = `Found **${product.title}**. \nWhich type?\nOptions: ${options}`;
                        memory.step = "ask_variant";
                    }
                }
            }
        }

        // --- PHASE 2: VARIANT SELECTION ---
        else if (memory.step === "ask_variant") {
            const optionsContext = memory.variants.map((v, i) => `ID ${i}: ${v.title}`).join("\n");
            
            // Allow restarting search
            if (txt.toLowerCase().includes("search") || txt.toLowerCase().includes("change")) {
                 await this.state.storage.delete("memory");
                 return new Response(JSON.stringify({ reply: "Okay, back to the start. What are you looking for?" }), { headers: { "Access-Control-Allow-Origin": "*" }});
            }

            const aiPrompt = `
                Options:
                ${optionsContext}
                
                User: "${txt}"
                
                Return JSON ONLY:
                { "match": true, "id": 1 } 
                OR 
                { "match": false, "reply": "Please pick from the list." }
            `;

            const raw = await this.askAI(aiPrompt);
            let decision = { match: false, reply: "Please select an option." };
            try { decision = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch(e) {}

            if (decision.match) {
                const selected = memory.variants[decision.id];
                memory.selectedVariantId = selected.id;
                memory.selectedVariantName = selected.title;
                
                memory.step = "consultation";
                memory.questionIndex = 0;
                reply = `Selected **${selected.title}**. \n\n${SALES_CHARTER.consultation.steps[0].question}`;
            } else {
                reply = decision.reply || "Please select one of the options.";
            }
        }

        // --- PHASE 3: CONSULTATION (The Interview) ---
        else if (memory.step === "consultation") {
            const steps = SALES_CHARTER.consultation.steps;
            
            // 1. Capture the answer to the PREVIOUS question
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
                reply = "Generating your project brief and quote...";
                
                // Format the Project Brief for the Merchant
                const briefNote = `
                --- PROJECT BRIEF ---
                Product: ${memory.selectedVariantName}
                ${steps.map(s => `- ${s.id.toUpperCase()}: ${memory.clipboard[s.id]}`).join("\n")}
                ---------------------
                Generated by Studium AI Agent
                `;

                // Try to parse quantity safely
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
        if (!this.env.AI) return JSON.stringify({ type: "chat", reply: "System Error: AI Disconnected" });
        try {
            const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                messages: [
                    { role: "system", content: "You are a JSON-only API. Never output conversational text outside JSON." },
                    { role: "user", content: prompt }
                ]
            });
            return response.response;
        } catch (e: any) {
            return JSON.stringify({ type: "chat", reply: "Brain Freeze. Try again." });
        }
    }
}