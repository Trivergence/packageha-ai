import { PackagehaSession } from "./session";
import { Env } from "./types";

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
};