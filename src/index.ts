import { PackagehaSession, Env } from "./session";
export { PackagehaSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { 
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        } 
      });
    }

    if (request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
      const id = env.PackagehaSession.idFromName(ip); 
      const stub = env.PackagehaSession.get(id);
      return stub.fetch(request);
    }
    return new Response("Studium Agent v0.2 (Live Inventory)", { status: 200 });
  }
};