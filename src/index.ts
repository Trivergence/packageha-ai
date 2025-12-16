// WORKER: DURABLE OBJECT (STATEFUL BRAIN)
export interface Env {
  PackagehaSession: DurableObjectNamespace;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOP_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    
    // 1. CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "POST") {
      // 2. Routing: Send user to their own private "Room" (Durable Object)
      // We use their IP as the ID for now (Simplest way)
      const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
      const id = env.PackagehaSession.idFromName(ip); 
      const stub = env.PackagehaSession.get(id);
      
      return stub.fetch(request);
    }

    return new Response("Studium Brain Online", { status: 200 });
  }
};

// --- THE CLASS (THE MEMORY) ---
export class PackagehaSession {
  state: DurableObjectState;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request) {
    // Load Memory
    let memory = await this.state.storage.get("memory") || { step: "start", product: "none" };
    
    const body = await request.json() as { message?: string };
    const txt = (body.message || "").toLowerCase();
    
    let reply = "I didn't understand that.";

    // --- CONVERSATION LOGIC ---
    
    // Step 0: Start
    if (memory.step === "start") {
      if (txt.includes("box")) {
        memory.step = "ask_size";
        memory.product = "box";
        reply = "Excellent choice. What size box do you need? (Small, Medium, Large)";
      } else {
        reply = "Welcome! I can help you with Boxes or Bags. Which one?";
      }
    }
    
    // Step 1: Size
    else if (memory.step === "ask_size") {
      if (txt.includes("large") || txt.includes("medium") || txt.includes("small")) {
        reply = `Got it. A ${txt} ${memory.product}. How many do you need?`;
        memory.step = "ask_qty";
        memory.size = txt;
      } else {
        reply = "Please choose a size: Small, Medium, or Large.";
      }
    }

    // Step 2: Quantity (The End)
    else if (memory.step === "ask_qty") {
      reply = `Perfect. I will prepare a quote for ${txt} ${memory.size} ${memory.product}s.`;
      memory.step = "start"; // Reset for next time
    }

    // Save Memory
    await this.state.storage.put("memory", memory);

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { 
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json" 
      }
    });
  }
}