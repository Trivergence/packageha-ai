export async function getActiveProducts(shopUrl: string, token: string): Promise<any[]> {
    let cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    
    // INCREASED LIMIT TO 50 to catch your full catalog
    const url = `https://${cleanShop}/admin/api/2024-01/products.json?status=active&limit=50`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json"
            }
        });
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data: any = await response.json();
        return data.products || [];

    } catch (e: any) {
        console.error("CATALOG ERROR:", e.message);
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

    const payload = {
        draft_order: {
            line_items: [{ variant_id: variantId, quantity: qty }]
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