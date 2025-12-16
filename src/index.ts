// WORKER: STUDIUM AGENT (WITH SHOPIFY HANDS)
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

// --- THE BRAIN (DURABLE OBJECT) ---
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
    const txt = (body.message || "").toLowerCase();
    
    let reply = "I didn't understand that.";

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
        reply = "Welcome! I can help you with Boxes or Bags. Which one?";
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
      const qty = parseInt(txt.replace(/\D/g,'')) || 100; // Extract number
      
      reply = "Generating your quote link, please wait...";
      
      // --- THE HANDS (Shopify API Call) ---
      const invoiceUrl = await this.createDraftOrder(memory.product, memory.size, qty);
      
      if (invoiceUrl) {
        reply = `Here is your official quote for ${qty} ${memory.size} ${memory.product}s: <a href="${invoiceUrl}" target="_blank" style="color:blue; text-decoration:underline;">Click to Pay/View</a>`;
        memory.step = "start"; // Reset
      } else {
        reply = "I had trouble contacting Shopify. Please try again.";
      }
    }

    // Save State
    await this.state.storage.put("memory", memory);

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
    });
  }

  // --- HELPER: TALK TO SHOPIFY ---
  async createDraftOrder(product: string, size: string, qty: number) {
    const url = `https://${this.env.SHOP_URL}/admin/api/2024-01/draft_orders.json`;
    
    const payload = {
      draft_order: {
        line_items: [
          {
            title: `Custom ${product} - ${size}`,
            quantity: qty,
            price: "10.00", // Default placeholder price
            custom: true
          }
        ],
        use_customer_default_address: false
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
      
      const data: any = await response.json();
      return data.draft_order?.invoice_url || null; // Return the checkout link
    } catch (e) {
      return null;
    }
  }
}