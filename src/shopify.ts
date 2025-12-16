export async function searchProducts(shopUrl: string, token: string, query: string): Promise<any[]> {
    let cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    
    // CHANGE 1: Fetch latest 20 products (Don't filter by title yet)
    // This allows us to do a "Fuzzy Match" in our own code
    const url = `https://${cleanShop}/admin/api/2024-01/products.json?status=active&limit=20`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json"
            }
        });
        
        // CHANGE 2: If error, THROW it so we can see it in the chat
        if (!response.ok) {
            throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
        }

        const data: any = await response.json();
        const allProducts = data.products || [];

        // CHANGE 3: Perform "Fuzzy Search" manually
        // This finds "Box" inside "Perfume Box" or "Custom Box"
        return allProducts.filter((p: any) => 
            p.title.toLowerCase().includes(query.toLowerCase())
        );

    } catch (e: any) {
        // Log it to the Cloudflare dashboard too
        console.error("SEARCH ERROR:", e.message);
        throw e; // Pass error to the chat
    }
}

export async function createDraftOrder(
    shopUrl: string, 
    token: string, 
    variantId: number, 
    qty: number
): Promise<string> {
    
    let cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanShop}/admin/api/2024-01/draft_orders.json`;

    const payload = {
        draft_order: {
            line_items: [
                {
                    variant_id: variantId,
                    quantity: qty
                }
            ]
        }
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) return `Error ${response.status}: ${response.statusText}`;
        const data: any = await response.json();
        return data.draft_order?.invoice_url || "No Invoice URL";
    } catch (e: any) {
        return `Network Error: ${e.message}`;
    }
}