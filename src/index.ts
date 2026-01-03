import { PackagehaSession } from "./session";
import { Env } from "./types";
import { SovereignSwitch } from "./sovereign-switch";
import { verifySallaToken, getSallaProducts, getSallaProduct } from "./salla";

export { PackagehaSession };

/**
 * Main Worker Entry Point
 * Clean API routing structure - all API endpoints use /api/ prefix
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { 
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        } 
      });
    }
    
    // All API routes use /api/ prefix to avoid conflicts with static assets
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, url);
    }
    
    // Non-API routes (GET requests) fall through to static asset serving
    // This is handled automatically by Cloudflare Workers assets configuration
    // Return 404 for non-existent static files
    return new Response("Not Found", { status: 404 });
  }
};

/**
 * Centralized API request handler
 * All API endpoints are prefixed with /api/ to avoid conflicts with static assets
 */
async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  // Main chat endpoint - routes to Durable Object session
  if (url.pathname === "/api/chat" && request.method === "POST") {
    console.log("[API] POST /api/chat");
    
    const cfIp = request.headers.get("CF-Connecting-IP");
    const forwardedFor = request.headers.get("X-Forwarded-For");
    let ip = "anonymous";
    if (cfIp) {
      ip = cfIp.trim();
    } else if (forwardedFor) {
      ip = forwardedFor.split(",")[0].trim();
    }
    
    const sessionId = env.PackagehaSession.idFromName(ip);
    const session = env.PackagehaSession.get(sessionId);
    
    try {
      const response = await session.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    } catch (error: any) {
      console.error("[API] Error:", error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Image generation endpoint - generates enhanced image description using Gemini
  // Note: Gemini doesn't generate images directly, only text descriptions
  // The enhanced description can be used with DALL-E, Stable Diffusion, or other image generation APIs
  if (url.pathname === "/api/generate-image-prompt" && request.method === "POST") {
    console.log("[API] POST /api/generate-image-prompt");
    try {
      const body = await request.json() as { prompt: string; productImageUrl?: string; packageImageUrl?: string };
      const sovereignSwitch = new SovereignSwitch(env);
      
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required for image generation");
      }
      
      // Generate actual image using Gemini's image generation capabilities
      let imageUrl: string | null = null;
      let imagePrompt: string = body.prompt;
      
      try {
        // Try to generate actual image using Gemini's image generation model
        imageUrl = await sovereignSwitch.generateImage(
          body.prompt,
          env.GEMINI_API_KEY,
          body.productImageUrl,
          body.packageImageUrl
        );
        console.log("[API] Successfully generated image, URL length:", imageUrl.length);
      } catch (error: any) {
        // If image generation fails, enhance the prompt with text-only call
        console.log("[API] Image generation failed, enhancing prompt:", error.message);
        try {
          imagePrompt = await sovereignSwitch.callAI(
            `Enhance this image generation prompt to be more detailed and specific for showing a product inside its package: ${body.prompt}`,
            "You are an expert at creating detailed, professional image generation prompts for product packaging visualization. Generate highly detailed, creative descriptions suitable for AI image generation models like DALL-E, Midjourney, or Stable Diffusion. Focus on visual details, lighting, composition, and professional photography style. The image should clearly show the product inside or with the package.",
            true
          );
        } catch (promptError: any) {
          console.error("[API] Failed to enhance prompt:", promptError);
          imagePrompt = body.prompt; // Fallback to original prompt
        }
      }
      
      return jsonResponse({ 
        imagePrompt: imagePrompt, // Return the prompt for display
        imageUrl: imageUrl || undefined // Return the generated image URL if available
      });
    } catch (error: any) {
      console.error("[API] Image generation error:", error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Salla OAuth callback
  if (url.pathname === "/api/salla/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    
    if (error) {
      const errorMessage = errorDescription || error;
      console.error("[Salla OAuth] Error:", error, errorDescription);
      let frontendUrl: URL;
      try {
        const redirectUri = env.SALLA_REDIRECT_URI || "";
        const baseUrl = new URL(redirectUri);
        baseUrl.pathname = '/index.html';
        baseUrl.searchParams.set("oauth_error", error);
        baseUrl.searchParams.set("error_description", errorMessage);
        frontendUrl = baseUrl;
      } catch (e) {
        return jsonResponse({ error: "OAuth error", details: error, description: errorMessage }, 400);
      }
      return Response.redirect(frontendUrl.toString(), 302);
    }
    
    if (!code) {
      return jsonResponse({ error: "Missing authorization code" }, 400);
    }
    
    try {
      const tokenUrl = "https://accounts.salla.sa/oauth2/token";
      const clientId = env.SALLA_CLIENT_ID || "";
      const clientSecret = env.SALLA_CLIENT_SECRET || "";
      const redirectUri = env.SALLA_REDIRECT_URI || "";
      
      const params = new URLSearchParams();
      params.append("grant_type", "authorization_code");
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);
      params.append("code", code);
      params.append("redirect_uri", redirectUri);
      
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Salla OAuth Error: ${errorText}`);
      }
      
      const tokenData = await tokenResponse.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        store_id?: number;
      };
      
      let frontendUrl: URL;
      try {
        const baseUrl = new URL(redirectUri);
        baseUrl.pathname = '/index.html';
        baseUrl.searchParams.set("access_token", tokenData.access_token || "");
        baseUrl.searchParams.set("state", state || "");
        if (tokenData.store_id) {
          baseUrl.searchParams.set("salla_store_id", tokenData.store_id.toString());
        }
        frontendUrl = baseUrl;
      } catch (e) {
        return jsonResponse({ error: `Failed to construct frontend URL: ${e}` }, 500);
      }
      return Response.redirect(frontendUrl.toString(), 302);
    } catch (error: any) {
      return jsonResponse({ error: `OAuth error: ${error.message}` }, 500);
    }
  }
  
  // Salla webhook
  if (url.pathname === "/api/salla/webhook" && request.method === "POST") {
    try {
      const body = await request.json() as any;
      if (body.event === "app.store.authorize" && body.data?.access_token) {
        console.log(`[Webhook] App authorized for store ${body.data.store_id}`);
        return jsonResponse({ success: true, message: "App authorization received" });
      }
      return jsonResponse({ received: true, event: body.event });
    } catch (error: any) {
      console.error("[Webhook] Error:", error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Salla products list
  if (url.pathname === "/api/salla/products" && request.method === "GET") {
    const accessToken = request.headers.get("Authorization")?.replace("Bearer ", "") || 
                       url.searchParams.get("access_token") || "";
    if (!accessToken) {
      return jsonResponse({ error: "Missing access token" }, 401);
    }
    try {
      const products = await getSallaProducts(accessToken);
      return jsonResponse({ products });
    } catch (error: any) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Salla single product
  if (url.pathname.startsWith("/api/salla/product/") && request.method === "GET") {
    const productId = parseInt(url.pathname.split("/").pop() || "0");
    const accessToken = request.headers.get("Authorization")?.replace("Bearer ", "") || 
                       url.searchParams.get("access_token") || "";
    if (!accessToken || !productId) {
      return jsonResponse({ error: "Missing access token or product ID" }, 400);
    }
    try {
      const product = await getSallaProduct(accessToken, productId);
      return jsonResponse({ product });
    } catch (error: any) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Models list endpoint
  if (url.pathname === "/api/models" && request.method === "GET") {
    try {
      const sovereignSwitch = new SovereignSwitch(env);
      if (env.GEMINI_API_KEY) {
        const models = await sovereignSwitch.listGeminiModels(env.GEMINI_API_KEY);
        const selected = await sovereignSwitch.getWorkingGeminiModel(env.GEMINI_API_KEY);
        let bestImageModel = selected;
        const proModels = models.filter(m => m.includes('1.5-pro') || m.includes('pro'));
        const flashModels = models.filter(m => m.includes('1.5-flash') || m.includes('flash'));
        if (proModels.length > 0) {
          bestImageModel = proModels.find(m => m.includes('1.5-pro')) || proModels[0];
        } else if (flashModels.length > 0) {
          bestImageModel = flashModels.find(m => m.includes('1.5-flash')) || flashModels[0];
        }
        return jsonResponse({ provider: "gemini", models, selected, bestImageModel });
      } else {
        return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 400);
      }
    } catch (error: any) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
  
  // Salla app page redirect
  if (url.pathname === "/app" || url.pathname === "/app/") {
    const accessToken = request.headers.get("X-Salla-Access-Token") || url.searchParams.get("access_token");
    const sallaStoreId = request.headers.get("X-Salla-Store-Id") || url.searchParams.get("salla_store_id");
    const referrer = request.headers.get("Referer");
    
    const redirectUrl = new URL("/index.html", request.url);
    if (accessToken) {
      redirectUrl.searchParams.set("access_token", accessToken);
      if (sallaStoreId) {
        redirectUrl.searchParams.set("salla_store_id", sallaStoreId);
      }
      redirectUrl.searchParams.set("connected", "true");
      return Response.redirect(redirectUrl.toString(), 302);
    } else if (referrer && (referrer.includes("salla.sa") || referrer.includes("s.salla.sa"))) {
      const clientId = env.SALLA_CLIENT_ID || "";
      const redirectUri = env.SALLA_REDIRECT_URI || "";
      const state = crypto.getRandomValues(new Uint8Array(32)).reduce((s, v) => s + v.toString(16).padStart(2, '0'), '');
      const authUrl = `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=offline_access&state=${state}`;
      return Response.redirect(authUrl, 302);
    }
    return Response.redirect(redirectUrl.toString(), 302);
  }
  
  // Unknown API endpoint
  return jsonResponse({ error: "API endpoint not found" }, 404);
}

/**
 * Helper function for JSON responses with CORS
 */
function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
