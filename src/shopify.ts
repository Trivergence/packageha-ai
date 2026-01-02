/**
 * Shopify Integration
 * Handles product catalog and order creation
 */

export interface ShopifyProduct {
    id: number;
    title: string;
    images?: Array<{
        id: number;
        src: string;
        alt?: string;
    }>;
    variants: Array<{
        id: number;
        title: string;
        price: string;
        image_id?: number;
    }>;
}

export interface ShopifyResponse {
    products?: ShopifyProduct[];
}

export async function getActiveProducts(shopUrl: string, token: string): Promise<ShopifyProduct[]> {
    const cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    // Include images in the response
    const url = `https://${cleanShop}/admin/api/2024-01/products.json?status=active&limit=50&fields=id,title,images,variants`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Shopify API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as ShopifyResponse;
        return data.products || [];

    } catch (error: any) {
        console.error("[getActiveProducts] Error:", error);
        throw new Error(`Failed to fetch products: ${error.message}`);
    }
}

export interface DraftOrderResponse {
    draft_order?: {
        id: number;
        invoice_url?: string;
        order_id?: number;
    };
}

export interface DraftOrderResult {
    draftOrderId: number;
    adminUrl: string;
    invoiceUrl?: string;
}

export interface CustomLineItem {
    title: string;
    price: string; // Price as string (e.g., "500.00")
    quantity: number;
}

export async function createDraftOrder(
    shopUrl: string,
    token: string,
    variantId: number | null,
    qty: number,
    note: string = "",
    customLineItems?: CustomLineItem[] // Optional custom line items for services
): Promise<DraftOrderResult> {
    const cleanShop = shopUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanShop}/admin/api/2024-01/draft_orders.json`;

    // Build line items array
    const lineItems: any[] = [];
    
    // Add package product if variant ID provided
    if (variantId) {
        lineItems.push({
            variant_id: variantId,
            quantity: qty
        });
    }
    
    // Add custom line items (services) if provided
    if (customLineItems && customLineItems.length > 0) {
        customLineItems.forEach(item => {
            lineItems.push({
                title: item.title,
                price: item.price,
                quantity: item.quantity
            });
        });
    }

    // At least one line item is required
    if (lineItems.length === 0) {
        throw new Error("At least one line item (product variant or custom item) is required");
    }

    const payload = {
        draft_order: {
            line_items: lineItems,
            note: note.trim(),
            tags: "studium-ai-generated"
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

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Shopify API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as DraftOrderResponse;
        const draftOrderId = data.draft_order?.id;
        
        if (!draftOrderId) {
            throw new Error("No draft order ID returned from Shopify");
        }

        // Construct admin URL (more reliable than invoice URL)
        const adminUrl = `https://${cleanShop}/admin/draft_orders/${draftOrderId}`;
        
        return {
            draftOrderId,
            adminUrl,
            invoiceUrl: data.draft_order?.invoice_url
        };
    } catch (error: any) {
        console.error("[createDraftOrder] Error:", error);
        throw new Error(`Failed to create draft order: ${error.message}`);
    }
}