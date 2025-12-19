/**
 * Core Type Definitions for The Studium Platform
 */

export type SovereignMode = "COMMERCIAL" | "SOVEREIGN" | "AIR_GAPPED";

export interface Env {
  PackagehaSession: DurableObjectNamespace;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOP_URL: string;
  AI: any; // Cloudflare AI binding
  SOVEREIGN_MODE?: SovereignMode;
  // For Mode B (Sovereign) - Vertex AI via Cloudflare AI Gateway
  VERTEX_AI_ENDPOINT?: string;
  VERTEX_AI_PROJECT?: string;
  VERTEX_AI_LOCATION?: string;
  // For Mode C (Air-Gapped) - Local Llama server
  LOCAL_LLAMA_ENDPOINT?: string;
}

export interface Memory {
  step: "start" | "ask_variant" | "consultation";
  productName?: string;
  productId?: number;
  variants?: Variant[];
  selectedVariantId?: number;
  selectedVariantName?: string;
  clipboard: Record<string, string>;
  questionIndex: number;
  createdAt?: number;
  lastActivity?: number;
}

export interface Variant {
  id: number;
  title: string;
  price: string;
}

export interface Product {
  id: number;
  title: string;
  variants: Variant[];
}

export interface AIDecision {
  type: "found" | "chat" | "none";
  id?: number;
  reason?: string;
  reply?: string;
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

export interface RequestBody {
  message?: string;
  reset?: boolean;
}

