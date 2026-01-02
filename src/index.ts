import { PackagehaSession } from "./session";
import { Env } from "./types";
import { SovereignSwitch } from "./sovereign-switch";
import { verifySallaToken, getSallaProducts, getSallaProduct } from "./salla";

export { PackagehaSession };

/**
 * Main Worker Entry Point
 * Routes requests to stateful Durable Object sessions
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { 
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        } 
      });
    }

    // Handle Salla OAuth callback
    const url = new URL(request.url);
    if (url.pathname === "/api/salla/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      
      if (!code) {
        return new Response(
          JSON.stringify({ error: "Missing authorization code" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      // Exchange code for access token
      try {
        const tokenUrl = "https://accounts.salla.sa/oauth2/token";
        const clientId = env.SALLA_CLIENT_ID || "";
        const clientSecret = env.SALLA_CLIENT_SECRET || "";
        const redirectUri = env.SALLA_REDIRECT_URI || "";

        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: redirectUri
          })
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Salla OAuth Error: ${errorText}`);
        }

        const tokenData = await tokenResponse.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };

        // Redirect to frontend with token (in production, use secure cookie or session)
        const frontendUrl = new URL(redirectUri);
        frontendUrl.searchParams.set("access_token", tokenData.access_token || "");
        frontendUrl.searchParams.set("state", state || "");

        return Response.redirect(frontendUrl.toString(), 302);

      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: `OAuth error: ${error.message}` }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    // Handle Salla API proxy endpoints
    if (url.pathname === "/api/salla/products" && request.method === "GET") {
      const accessToken = request.headers.get("Authorization")?.replace("Bearer ", "") || 
                         url.searchParams.get("access_token") || "";
      
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Missing access token" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      try {
        const products = await getSallaProducts(accessToken);
        return new Response(
          JSON.stringify({ products }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    if (url.pathname.startsWith("/api/salla/product/") && request.method === "GET") {
      const productId = parseInt(url.pathname.split("/").pop() || "0");
      const accessToken = request.headers.get("Authorization")?.replace("Bearer ", "") || 
                         url.searchParams.get("access_token") || "";
      
      if (!accessToken || !productId) {
        return new Response(
          JSON.stringify({ error: "Missing access token or product ID" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      try {
        const product = await getSallaProduct(accessToken, productId);
        return new Response(
          JSON.stringify({ product }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    // Route POST requests to Durable Object session
    if (request.method === "POST") {
      // Use IP address for session ID (could also use user ID from auth)
      const cfIp = request.headers.get("CF-Connecting-IP");
      const forwardedFor = request.headers.get("X-Forwarded-For");
      
      let ip = "anonymous";
      if (cfIp) {
        ip = cfIp.trim();
      } else if (forwardedFor) {
        // Extract first IP and trim whitespace (handles malformed headers with spaces)
        ip = forwardedFor.split(",")[0].trim();
      }
      
      const sessionId = env.PackagehaSession.idFromName(ip);
      const session = env.PackagehaSession.get(sessionId);
      
      return session.fetch(request);
    }

    // Health check / info endpoint
    if (request.method === "GET") {
      // Check if it's a models list request
      const url = new URL(request.url);
      if (url.pathname === "/models" || url.searchParams.get("list") === "models") {
        try {
          const sovereignSwitch = new SovereignSwitch(env);
          if (env.GEMINI_API_KEY) {
            const models = await sovereignSwitch.listGeminiModels(env.GEMINI_API_KEY);
            const selected = await sovereignSwitch.getWorkingGeminiModel(env.GEMINI_API_KEY);
            return new Response(
              JSON.stringify({ 
                provider: "gemini",
                models: models,
                selected: selected
              }), 
              { 
                status: 200,
                headers: { 
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
                }
              }
            );
          } else {
            return new Response(
              JSON.stringify({ error: "GEMINI_API_KEY not configured" }), 
              { 
                status: 400,
                headers: { 
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
                }
              }
            );
          }
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message }), 
            { 
              status: 500,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }
      }

      return new Response(
        JSON.stringify({ 
          service: "Studium Agent",
          version: "2.0",
          campus: "Packageha",
          practice: "Sales",
          status: "operational"
        }), 
        { 
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  }
};