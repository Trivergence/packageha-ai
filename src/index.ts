// WORKER: SELF-HEALING STUDIUM AGENT
export interface Env {
  PackagehaSession: DurableObjectNamespace;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOP_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
      const id = env.PackagehaSession.idFromName(ip); 
      const stub = env.PackagehaSession.get(id);
      return stub.fetch(request);
    }

    return new Response("Studium Agent Online", { status: 200 });
  }
};

// --- THE BRAIN ---
export class PackagehaSession {
  state: DurableObjectState;
  env: Env;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request) {
    let memory = await this.state.storage.get("memory") || { step: "start", product: "none" };
    const body = await request.json() as { message?: string };
    const txt = (body.message || "").toLowerCase().trim();
    
    let reply = "I didn't understand that.";

    // --- EMERGENCY RESET ---
    if (txt === "reset" || txt === "restart") {
        await this.state.storage.delete("memory");
        return new Response(JSON.stringify({ reply: "♻️ Memory wiped. Let's start over. Do you need Boxes or Bags?" }), {
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });
    }

    // --- CONVERSATION FLOW ---
    
    // Step 0: Start
    if (memory.step === "start") {
      if (txt.includes("box")) {
        memory.step = "ask_size";
        memory.product = "Box";
        reply = "Excellent. What size box? (Small, Medium, Large)";
      } else if (txt.includes("bag")) {
        memory.step = "ask_size";
        memory.product = "Bag";
        reply = "Sure. What size bag? (Small, Medium, Large)";
      } else {
        reply = "Welcome! I can help you with Boxes or Bags. Which one? (Type 'reset' if stuck)";
      }
    }
    
    // Step 1: Ask Size
    else if (memory.step === "ask_size") {
      memory.size = txt;
      memory.step = "ask_qty";
      reply = `Got it. A ${memory.size} ${memory.product}. How many do you need?`;
    }

    // Step 2: Ask Quantity -> CREATE ORDER
    else if (memory.step === "ask_qty") {
      const qty = parseInt(txt.replace(/\D/g,'')) || 50; // Default to 50 if text is weird
      
      const result = await this.createDraftOrder(memory.product, memory.size, qty);
      
      if (result.startsWith("http")) {
        reply = `✅ Quote Ready! Order for ${qty} ${memory.size} ${memory.product}s: <a href="${result}" target="_blank" style="color:blue; text-decoration:underline;">Click Here to Pay</a>`;
        memory.step = "start"; 
      } else {
        reply = `⚠️ Shopify Error: ${result}. (Try typing 'reset')`; 
      }
    }

    await this.state.storage.put("memory", memory);

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
    });
  }

  async createDraftOrder(product: string, size: string, qty: number) {
    // 1. CLEAN THE URL (The Fix)
    // This removes 'https://' and trailing slashes so we don't get double https
    const cleanShop = this.env.SHOP_URL.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanShop}/admin/api/2024-01/draft_orders.json`;
    
    const payload = {
      draft_order: {
        line_items: [
          {
            title: `Custom ${product} - ${size}`,
            quantity: qty,
            price: "15.00",
            custom: true
          }
        ]
      }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": this.env.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        return `Status ${response.status}: ${response.statusText}`; // Show specific error
      }
      
      const data: any = await response.json();
      return data.draft_order?.invoice_url || "No Invoice URL returned";
    } catch (e: any) {
      return `Network Error: ${e.message}`;
    }
  }
}