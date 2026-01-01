import { PackagehaSession } from "./session";
import { Env } from "./types";
import { SovereignSwitch } from "./sovereign-switch";

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