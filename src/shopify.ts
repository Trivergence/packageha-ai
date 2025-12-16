export async function searchProducts(shopUrl: string, token: string, query: string): Promise<any[]> {
    // 1. Clean URL
    let cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    // 2. Search API (Find products with title matching query, e.g., "Box")
    const url = `https://${cleanShop}/admin/api/2024-01/products.json?title=${query}&status=active`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json"
            }
        });
        
        if (!response.ok) return [];
        const data: any = await response.json();
        return data.products || [];
    } catch (e) {
        console.error(e);
        return [];
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

    // We use the REAL Variant ID now. This ensures inventory is tracked correctly.
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

        if (!response.ok) return `Error ${response.status}`;
        const data: any = await response.json();
        return data.draft_order?.invoice_url || "No Invoice URL";
    } catch (e: any) {
        return `Network Error: ${e.message}`;
    }
}