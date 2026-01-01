/**
 * Core Type Definitions for The Studium Platform
 */

export type SovereignMode = "COMMERCIAL" | "COMMERCIAL_OPENAI" | "COMMERCIAL_GEMINI" | "SOVEREIGN" | "AIR_GAPPED";

export interface Env {
  PackagehaSession: DurableObjectNamespace;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOP_URL: string;
  AI: any; // Cloudflare AI binding
  SOVEREIGN_MODE?: SovereignMode;
  // For OpenAI (ChatGPT)
  OPENAI_API_KEY?: string;
  // For Google Gemini
  GEMINI_API_KEY?: string;
  // For Mode B (Sovereign) - Vertex AI via Cloudflare AI Gateway
  VERTEX_AI_ENDPOINT?: string;
  VERTEX_AI_PROJECT?: string;
  VERTEX_AI_LOCATION?: string;
  // For Mode C (Air-Gapped) - Local Llama server
  LOCAL_LLAMA_ENDPOINT?: string;
}

export interface Memory {
  flow: AgentFlow; // Which flow is active
  step: string; // Flow-specific step (union type too complex, use string)
  packageName?: string; // Packageha's package name (what we sell) - NOT the client's product
  packageId?: number; // Packageha's package ID (what we sell) - NOT the client's product
  variants?: Variant[]; // Variants of the selected Packageha package
  selectedVariantId?: number; // Selected variant ID of the Packageha package
  selectedVariantName?: string; // Selected variant name of the Packageha package
  clipboard: Record<string, string>; // Stores client product details (product_description, product_dimensions, etc.)
  questionIndex: number;
  createdAt?: number;
  lastActivity?: number;
  // For packaging assistant
  recommendations?: PackageRecommendation[];
  // For launch kit
  selectedServices?: string[];
  // Step tracking for new multi-step flow
  currentStep?: string; // product_details, select_package, fulfillment_specs, launch_kit
  packageSpecs?: {
    material?: string;
    dimensions?: string;
    print?: string;
  };
  // For package selection from multiple matches (Packageha packages, not client products)
  pendingMatches?: Array<{ id: number; packageId: number; name: string; reason: string }>;
}

export interface PackageRecommendation {
  packageId: number;
  packageName: string;
  packageVariant?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface Variant {
  id: number;
  title: string;
  price: string;
}

// Represents a Packageha package (what we sell) - NOT a client's product
// Note: Shopify API uses "product" terminology, but these are actually packages
export interface Product {
  id: number;
  title: string;
  variants: Variant[];
}

export interface AIDecision {
  type: "found" | "chat" | "none" | "multiple";
  id?: number;
  reason?: string;
  reply?: string;
  matches?: Array<{ id: number; name: string; reason: string }>; // For multiple matches display
}

export interface VariantDecision {
  match: boolean;
  id?: number;
  reply?: string;
}

export interface ConsultationAnswer {
  stepId: string;
  answer: string;
  timestamp: number;
}

export type AgentFlow = "direct_sales" | "package_order" | "launch_kit" | "packaging_assistant";

export interface RequestBody {
  message?: string;
  reset?: boolean;
  flow?: AgentFlow; // Optional: explicit flow selection (for MVP)
}

