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

    // Diagnostic endpoint to check OAuth configuration
    const url = new URL(request.url);
    if (url.pathname === "/api/salla/check-config" && request.method === "GET") {
      const redirectUri = env.SALLA_REDIRECT_URI || "";
      const clientId = env.SALLA_CLIENT_ID || "";
      const hasSecret = !!env.SALLA_CLIENT_SECRET;
      
      return new Response(
        JSON.stringify({
          configured: {
            redirectUri: redirectUri || "NOT SET",
            clientId: clientId || "NOT SET",
            hasClientSecret: hasSecret
          },
          expectedRedirectUri: `${new URL(request.url).origin}/api/salla/callback`,
          instructions: {
            step1: "Set these secrets in Cloudflare:",
            secrets: [
              "wrangler secret put SALLA_CLIENT_ID",
              "wrangler secret put SALLA_CLIENT_SECRET",
              "wrangler secret put SALLA_REDIRECT_URI"
            ],
            step2: "Register the redirect URI in Salla Partners Portal",
            redirectUriToRegister: `${new URL(request.url).origin}/api/salla/callback`
          }
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

    // Handle Salla webhook for app installation (Easy Mode)
    // When app is installed, Salla sends app.store.authorize event with access token
    if (url.pathname === "/api/salla/webhook" && request.method === "POST") {
      try {
        const body = await request.json() as {
          event?: string;
          merchant?: {
            id?: number;
            domain?: string;
          };
          data?: {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            store?: {
              id?: number;
              domain?: string;
            };
          };
        };

        // Check if this is an app installation/authorization event
        if (body.event === "app.store.authorize" && body.data?.access_token) {
          const accessToken = body.data.access_token;
          const refreshToken = body.data.refresh_token;
          const storeId = body.merchant?.id || body.data.store?.id;
          const storeDomain = body.merchant?.domain || body.data.store?.domain;

          // Store the access token (in production, use a database or KV store)
          // For now, we'll pass it through the app context
          console.log(`[Webhook] App authorized for store ${storeId}, domain: ${storeDomain}`);

          return new Response(
            JSON.stringify({ 
              success: true,
              message: "App authorization received",
              storeId: storeId
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

        // Handle other webhook events
        return new Response(
          JSON.stringify({ received: true, event: body.event }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      } catch (error: any) {
        console.error("[Webhook] Error:", error);
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

    // Handle Salla OAuth callback (Custom Mode)
    if (url.pathname === "/api/salla/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      
      // Handle OAuth errors from Salla
      if (error) {
        const errorMessage = errorDescription || error;
        console.error("[Salla OAuth Callback] Error from Salla:", error, errorDescription);
        
        // Redirect to frontend with error
        let frontendUrl: URL;
        try {
          const redirectUri = env.SALLA_REDIRECT_URI || "";
          const baseUrl = new URL(redirectUri);
          baseUrl.pathname = '/sallaTest.html';
          baseUrl.searchParams.set("oauth_error", error);
          baseUrl.searchParams.set("error_description", errorMessage);
          frontendUrl = baseUrl;
        } catch (e) {
          // Fallback: return error in JSON
          return new Response(
            JSON.stringify({ 
              error: "OAuth error from Salla",
              details: error,
              description: errorMessage
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            }
          );
        }
        
        return Response.redirect(frontendUrl.toString(), 302);
      }
      
      // Check for authorization code
      if (!code) {
        return new Response(
          JSON.stringify({ 
            error: "Missing authorization code",
            received_params: {
              has_code: !!code,
              has_state: !!state,
              has_error: !!error,
              error: error || null,
              error_description: errorDescription || null
            }
          }),
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

        // OAuth 2.0 token exchange typically uses form-encoded data
        const tokenBody = new URLSearchParams();
        tokenBody.append('grant_type', 'authorization_code');
        tokenBody.append('client_id', clientId);
        tokenBody.append('client_secret', clientSecret);
        tokenBody.append('code', code);
        tokenBody.append('redirect_uri', redirectUri);

        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: tokenBody.toString()
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

        // Redirect to frontend with token
        // The redirectUri should point back to sallaTest.html
        // Try to construct frontend URL from redirectUri (replace callback with sallaTest.html)
        let frontendUrl: URL;
        try {
          // Try to use redirectUri as base and replace the callback path
          const baseUrl = new URL(redirectUri);
          baseUrl.pathname = '/sallaTest.html';
          baseUrl.searchParams.set("access_token", tokenData.access_token || "");
          baseUrl.searchParams.set("state", state || "");
          frontendUrl = baseUrl;
        } catch (e) {
          // Fallback: return token in JSON (for testing)
          return new Response(
            JSON.stringify({ 
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_in: tokenData.expires_in,
              message: "OAuth successful! Copy the access_token and use it in your app."
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

    // Salla App Page - This endpoint can be configured in Salla app settings
    // Salla will redirect merchants here when they click on your app
    // In Custom Mode OAuth, Salla doesn't automatically pass tokens, so we need to:
    // 1. Check if coming from Salla (via referrer or query param)
    // 2. If yes, auto-initiate OAuth flow
    // 3. If no, show normal page
    if (url.pathname === "/app" || url.pathname === "/app/") {
      const referer = request.headers.get("Referer") || "";
      const fromSalla = url.searchParams.get("from_salla") === "true" || 
                       referer.includes("salla.sa") || 
                       referer.includes("s.salla.sa");
      
      // Check for access token (from OAuth callback or headers)
      const accessToken = url.searchParams.get("access_token") || 
                         request.headers.get("Authorization")?.replace("Bearer ", "") ||
                         request.headers.get("X-Salla-Access-Token") ||
                         request.headers.get("x-salla-access-token");
      
      const storeId = url.searchParams.get("store_id") ||
                     request.headers.get("X-Salla-Store-Id") ||
                     request.headers.get("x-salla-store-id");

      // If we have access token, redirect with it (merchant already connected)
      if (accessToken) {
        const redirectUrl = new URL("/sallaTest.html", request.url);
        redirectUrl.searchParams.set("access_token", accessToken);
        redirectUrl.searchParams.set("connected", "true");
        if (storeId) {
          redirectUrl.searchParams.set("store_id", storeId);
        }
        return Response.redirect(redirectUrl.toString(), 302);
      }
      
      // If coming from Salla but no token, auto-initiate OAuth
      if (fromSalla) {
        const clientId = env.SALLA_CLIENT_ID || "";
        const redirectUri = env.SALLA_REDIRECT_URI || "";
        
        if (clientId && redirectUri) {
          // Generate state
          const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('') + Date.now().toString(36);
          
          // Build OAuth URL
          const authUrl = `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=offline_access&state=${state}`;
          
          // Redirect to OAuth (merchant will authorize and come back)
          return Response.redirect(authUrl, 302);
        }
      }
      
      // Otherwise, redirect to form (merchant can connect manually)
      return Response.redirect(new URL("/sallaTest.html", request.url).toString(), 302);
    }
    }

    // Fallback: serve static files (index.html, sallaTest.html, etc.)
    // This is handled by Cloudflare Workers assets configuration
    
    return new Response(
      JSON.stringify({ 
        service: "Studium Agent",
        version: "2.0",
        campus: "Packageha",
        practice: "Sales",
        status: "operational",
        endpoints: {
          landing: "/",
          merchantForm: "/sallaTest.html",
          appPage: "/app",
          api: "/api"
        }
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
};