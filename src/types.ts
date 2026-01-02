/**
 * Core Type Definitions for The Studium Platform
 */

export type SovereignMode = "COMMERCIAL" | "COMMERCIAL_OPENAI" | "COMMERCIAL_GEMINI" | "SOVEREIGN" | "AIR_GAPPED";

export interface Env {
  PackagehaSession: DurableObjectNamespace<PackagehaSession>;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOP_URL: string;
  AI: any; // Cloudflare AI binding
  SOVEREIGN_MODE?: SovereignMode;
  // For OpenAI (ChatGPT)
  OPENAI_API_KEY?: string;
  // For Google Gemini
  GEMINI_API_KEY?: string;
}

// Use global type for DurableObjectNamespace
declare global {
  interface DurableObjectNamespace<T> {
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<T>;
    newUniqueId(): DurableObjectId;
  }
  interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
  }
  interface DurableObjectStub<T> {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  }
  interface PackagehaSession {
    fetch(request: Request): Promise<Response>;
  }
}

// Memory structure for the agent
export interface Memory {
  flow: AgentFlow; // Which flow is active
  step: string; // Flow-specific step (union type too complex, use string)
  packageName?: string; // Renamed from productName - Packageha's package name (what we sell), NOT client's product
  packageId?: number; // Renamed from productId - Packageha's package ID (what we sell), NOT client's product
  variants?: Variant[];
  selectedVariantId?: number;
  selectedVariantName?: string;
  clipboard: Record<string, string>;
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
  // For package selection from multiple matches
  pendingMatches?: Array<{ id: number; packageId: number; name: string; reason: string }>; // Updated productId to packageId
}

// Represents a Packageha package (what we sell) - NOT a client's product
// Note: Shopify API uses "product" terminology, but these are actually packages
export interface Product {
  id: number;
  title: string;
  variants: Variant[];
}

export interface Variant {
  id: number;
  title: string;
  price: string;
}

export interface AIDecision {
  type: "found" | "multiple" | "none" | "chat";
  id?: number;
  matches?: Array<{ id: number; name: string; reason: string }>;
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

export type AgentFlow = "direct_sales" | "launch_kit";

export interface RequestBody {
  message?: string;
  reset?: boolean;
  flow?: AgentFlow; // Optional: explicit flow selection (for MVP)
  regenerateOrder?: boolean; // Optional: regenerate draft order without resetting memory
  edit?: string; // Optional: edit a specific question (format: "questionId")
}

export interface LaunchKitService {
  id: string;
  name: string;
  description: string;
  price: number;
}

export interface PackageRecommendation {
  packageId: number;
  packageName: string;
  matchScore: number;
  reasoning: string;
  variants?: Variant[];
}

export interface PackagingAssistantDecision {
  recommendations: PackageRecommendation[];
  reasoning: string;
}

export interface CustomLineItem {
  title: string;
  price: string; // Price as string (e.g., "500.00")
  quantity: number;
}
