export interface Env { SHOPIFY_ACCESS_TOKEN: string; SHOP_URL: string; }

export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. CORS Headers (Allows your site to talk to this worker)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 2. Handle Pre-flight checks
if (request.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}

// 3. Handle Chat Messages
if (request.method === "POST") {
  try {
    const body = await request.json() as { message?: string };
    const userMessage = (body.message || "").toLowerCase();

    let reply = "I can help with boxes or bags. What do you need?";

    if (userMessage.includes("box")) {
        reply = "We have great boxes! What size? (Small, Medium, Large)";
    } else if (userMessage.includes("bag")) {
        reply = "We have paper and plastic bags. Do you need printing?";
    }

    return new Response(JSON.stringify({ reply: reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}

// 4. Fallback
return new Response(JSON.stringify({ message: "Studium Brain Online" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" } 
});
},};