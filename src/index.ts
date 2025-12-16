export interface Env { SHOPIFY_ACCESS_TOKEN: string; SHOP_URL: string; }

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    },
};