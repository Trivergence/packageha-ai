/**
 * Salla API Integration
 * Handles Salla store authentication, product fetching, and order creation
 */

export interface SallaProduct {
    id: number;
    name: string;
    description?: string;
    images?: Array<{
        id: number;
        url: string;
        alt?: string;
    }>;
    sku?: string;
    price?: {
        amount: number;
        currency: string;
    };
    status?: string;
}

export interface SallaProductsResponse {
    data?: SallaProduct[];
    pagination?: {
        current_page: number;
        total_pages: number;
        total_items: number;
    };
}

export interface SallaStoreInfo {
    id: number;
    name: string;
    domain: string;
    logo?: string;
}

/**
 * Get products from a Salla store
 */
export async function getSallaProducts(
    accessToken: string,
    storeId?: number
): Promise<SallaProduct[]> {
    const baseUrl = "https://api.salla.dev/admin/v2";
    const url = `${baseUrl}/products?status=active&limit=50`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Salla API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as SallaProductsResponse;
        return data.data || [];

    } catch (error: any) {
        console.error("[getSallaProducts] Error:", error);
        throw new Error(`Failed to fetch Salla products: ${error.message}`);
    }
}

/**
 * Get a specific product from Salla store
 */
export async function getSallaProduct(
    accessToken: string,
    productId: number
): Promise<SallaProduct | null> {
    const baseUrl = "https://api.salla.dev/admin/v2";
    const url = `${baseUrl}/products/${productId}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            const errorText = await response.text();
            throw new Error(`Salla API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as { data?: SallaProduct };
        return data.data || null;

    } catch (error: any) {
        console.error("[getSallaProduct] Error:", error);
        throw new Error(`Failed to fetch Salla product: ${error.message}`);
    }
}

/**
 * Get store information
 */
export async function getSallaStoreInfo(
    accessToken: string
): Promise<SallaStoreInfo | null> {
    const baseUrl = "https://api.salla.dev/admin/v2";
    const url = `${baseUrl}/store`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Salla API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as { data?: SallaStoreInfo };
        return data.data || null;

    } catch (error: any) {
        console.error("[getSallaStoreInfo] Error:", error);
        throw new Error(`Failed to fetch store info: ${error.message}`);
    }
}

/**
 * Verify Salla access token
 */
export async function verifySallaToken(accessToken: string): Promise<boolean> {
    try {
        const storeInfo = await getSallaStoreInfo(accessToken);
        return storeInfo !== null;
    } catch (error) {
        return false;
    }
}

