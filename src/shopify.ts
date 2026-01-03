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
    const allProducts: ShopifyProduct[] = [];
    let pageInfo: string | null = null;
    let page = 1;
    const limit = 250; // Shopify max per page

    try {
        do {
            // Build URL with pagination
            let url = `https://${cleanShop}/admin/api/2024-01/products.json?status=active&limit=${limit}&fields=id,title,images,variants`;
            if (pageInfo) {
                url += `&page_info=${pageInfo}`;
            }

            console.log(`[getActiveProducts] Fetching page ${page}...`);
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
            const products = data.products || [];
            allProducts.push(...products);

            // Check for pagination (Link header or check if we got less than limit)
            const linkHeader = response.headers.get("Link");
            if (linkHeader && linkHeader.includes('rel="next"')) {
                // Extract page_info from Link header
                const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>; rel="next"/);
                pageInfo = nextMatch ? decodeURIComponent(nextMatch[1]) : null;
                page++;
            } else if (products.length < limit) {
                // No more pages
                pageInfo = null;
            } else {
                // Assume there might be more, but we'll stop after reasonable limit
                if (page >= 10) { // Safety limit: max 10 pages = 2500 products
                    console.log("[getActiveProducts] Reached safety limit of 10 pages");
                    pageInfo = null;
                } else {
                    pageInfo = null; // Stop if we can't determine next page
                }
            }

            console.log(`[getActiveProducts] Page ${page - 1}: ${products.length} products, Total so far: ${allProducts.length}`);
        } while (pageInfo);

        console.log(`[getActiveProducts] Total products fetched: ${allProducts.length}`);
        return allProducts;

    } catch (error: any) {
        console.error("[getActiveProducts] Error:", error);
        // If we got some products before error, return them
        if (allProducts.length > 0) {
            console.log(`[getActiveProducts] Returning ${allProducts.length} products despite error`);
            return allProducts;
        }
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