# Packageha Evolution Plan: Multi-Selling Point Platform

## Executive Summary

Transform Packageha from a single-channel sales agent (Packageha.com) into a multi-channel platform supporting:
- **Packageha.com**: Direct customer sales (existing)
- **Salla App**: B2B2C model for Salla store owners with three core capabilities

## Architecture Overview

### Current State
- Single endpoint (`Packageha.com`)
- Single agent flow: Discovery → Variant → Consultation → Order
- Shopify integration only
- Session-based on IP address

### Target State
- **Multi-channel routing**: Packageha.com + Salla App endpoints
- **Multi-tenant**: Support both direct customers and Salla store owners
- **Multi-flow**: 4 distinct agent personas/flows
- **Dual integrations**: Shopify + Salla API
- **Store mapping**: Product-to-package mapping system

---

## Phase 1: Foundation & Infrastructure (Week 1-2)

### 1.1 Multi-Channel Routing System

**Goal**: Route requests based on origin (Packageha.com vs Salla App)

**Implementation**:
- Add `context` to request body: `{ context: "direct" | "salla", ... }`
- Add `channel` field to `Memory` type
- Update `index.ts` to handle routing based on context
- Create separate session namespaces or prefix session IDs by channel

**Files to Modify**:
- `src/types.ts`: Add `Channel` type, extend `RequestBody` and `Memory`
- `src/index.ts`: Add context-aware routing
- `src/session.ts`: Handle channel-specific flows

### 1.2 Salla API Integration Module

**Goal**: Create Salla API client similar to Shopify integration

**Implementation**:
- New file: `src/salla.ts`
- Functions needed:
  - `authenticateSallaStore(merchantToken, storeId)` - OAuth/API authentication
  - `getSallaProducts(storeToken, storeId)` - Fetch products from Salla store
  - `createSallaOrder(storeToken, storeId, items)` - Create order in Salla
  - `getSallaProductDetails(storeToken, productId)` - Get specific product
- Handle Salla API authentication (merchant token, store-specific tokens)
- Error handling and retry logic

**Salla API Research Needed**:
- OAuth flow for app installation
- Product listing API endpoints
- Order creation API endpoints
- Webhook handling (for new product events)

**Files to Create**:
- `src/salla.ts`

### 1.3 Store Connection & Mapping System

**Goal**: Allow Salla store owners to connect their stores and map products to packages

**Implementation Options**:
- **Option A**: Durable Objects (preferred for stateful, per-store data)
  - Create `StoreMapping` Durable Object class
  - Store: `storeId`, `merchantToken`, `productMappings[]`
  - Methods: `connectStore()`, `mapProduct()`, `getMappings()`, `unmapProduct()`
  
- **Option B**: Cloudflare KV (for simpler, read-heavy use case)
  - Key: `store:{storeId}`, Value: `{merchantToken, mappings: {...}}`
  - Pros: Simpler, faster reads
  - Cons: Eventual consistency, no transactions

**Recommended: Durable Objects** (better for complex operations, atomic updates)

**Product Mapping Structure**:
```typescript
interface ProductMapping {
  sallaProductId: string;
  sallaProductName: string;
  packagehaPackageId: number;  // Shopify variant ID
  packagehaPackageName: string;
  createdAt: number;
  lastUsed: number;
}
```

**Files to Create**:
- `src/store-mapping.ts` (Durable Object class)
- `src/types.ts`: Add `StoreConnection`, `ProductMapping` interfaces

**Files to Modify**:
- `wrangler.toml`: Add `StoreMapping` Durable Object binding

---

## Phase 2: Multi-Flow Agent System (Week 2-3)

### 2.1 Agent Flow Router

**Goal**: Route to appropriate agent flow based on context and user intent

**Flow Types**:
1. **Direct Sales** (existing): `direct_sales` - Packageha.com customers
2. **Package Ordering**: `package_order` - Salla store owners ordering packages
3. **Launch Kit Ordering**: `launch_kit` - Studio services ordering
4. **Packaging Assistant**: `packaging_assistant` - Consultation flow for new products

**Implementation**:
- Extend `Memory.step` to include flow type: `"direct_sales" | "package_order" | "launch_kit" | "packaging_assistant"`
- Add flow detection in `session.ts`:
  - `detectFlow(context, userMessage, memory)` - Determine which flow to use
  - Update `fetch()` to route to flow-specific handler
- Create flow-specific handlers:
  - `handleDirectSales()` (refactor existing flow)
  - `handlePackageOrder()` (new)
  - `handleLaunchKit()` (new)
  - `handlePackagingAssistant()` (new)

**Files to Modify**:
- `src/types.ts`: Extend `Memory.step` type
- `src/session.ts`: Add flow routing logic and handlers

### 2.2 Charter System Extension

**Goal**: Support multiple agent personas with different Charters

**Implementation**:
- Create `src/charters.ts` (or extend `src/charter.ts`)
- Define charters for each flow:
  - `DIRECT_SALES_CHARTER` (existing, rename from `SALES_CHARTER`)
  - `PACKAGE_ORDER_CHARTER`
  - `LAUNCH_KIT_CHARTER`
  - `PACKAGING_ASSISTANT_CHARTER`
- Update `buildCharterPrompt()` to accept flow type
- Each charter has its own rules, questions, and validation

**Files to Modify**:
- `src/charter.ts` → `src/charters.ts` (refactor)
- `src/session.ts`: Use flow-specific charters

---

## Phase 3: Package Ordering Flow (Week 3-4)

### 3.1 Store Connection Flow

**Goal**: Allow Salla store owners to connect their store

**Implementation**:
- New endpoint: `POST /api/salla/connect`
- Body: `{ merchantToken, storeId }`
- Flow:
  1. Validate token with Salla API
  2. Fetch store details
  3. Create `StoreMapping` Durable Object instance
  4. Store connection credentials
  5. Return connection status

**UI Flow** (to be handled by frontend):
- "Connect Your Salla Store" button
- OAuth redirect or token input
- Connection success confirmation

**Files to Create/Modify**:
- `src/index.ts`: Add `/api/salla/connect` endpoint
- `src/store-mapping.ts`: Implement connection logic
- `src/salla.ts`: Add authentication functions

### 3.2 Product-to-Package Mapping Flow

**Goal**: Map Salla products to Packageha packages

**Implementation**:
- New endpoint: `POST /api/salla/map-product`
- Body: `{ storeId, sallaProductId, packagehaPackageId }`
- Flow:
  1. Validate store connection
  2. Get product details from Salla
  3. Get package details from Shopify
  4. Store mapping in `StoreMapping` Durable Object
  5. Return mapping confirmation

**Mapping UI Options** (frontend responsibility):
- **Auto-mapping**: AI suggests packages based on product name/description
- **Manual mapping**: User selects package from dropdown
- **Bulk mapping**: Map multiple products at once

**Files to Create/Modify**:
- `src/index.ts`: Add `/api/salla/map-product` endpoint
- `src/store-mapping.ts`: Add mapping methods
- `src/session.ts`: Add mapping context to package order flow

### 3.3 Package Order Flow

**Goal**: Salla store owners can order/reorder packages for their products

**Flow**:
1. **Product Selection**: User selects product from their Salla store
2. **Package Check**: System checks if product has mapped package
   - If mapped: Show mapped package details
   - If not mapped: Prompt for mapping or suggest packages
3. **Quantity & Customization**: Ask for quantity and any customizations
4. **Order Creation**: Create order in Shopify (same as existing flow)
5. **Optional**: Sync order back to Salla (if needed)

**Implementation**:
- Handler: `handlePackageOrder()` in `session.ts`
- Steps:
  - `select_product`: List user's Salla products, allow selection
  - `check_mapping`: Check if product has package mapping
  - `map_if_needed`: If no mapping, prompt for mapping
  - `customize`: Quantity, customizations
  - `create_order`: Create Shopify draft order

**Files to Create/Modify**:
- `src/session.ts`: Add `handlePackageOrder()` method
- `src/charters.ts`: Add `PACKAGE_ORDER_CHARTER`
- `src/store-mapping.ts`: Add `getMappingsByStore()` method

---

## Phase 4: Launch Kit Ordering Flow (Week 4-5)

### 4.1 Launch Kit Flow

**Goal**: Allow ordering studio services (Launch Kit)

**Flow**:
1. **Trigger Detection**: 
   - Automatic: Webhook from Salla when new product added
   - Manual: User requests "Order Launch Kit"
2. **Product Selection**: Select product(s) for Launch Kit
3. **Service Selection**: Choose services (photography, design, etc.)
4. **Requirements Collection**: Collect project requirements
5. **Order Creation**: Create order in Shopify

**Implementation**:
- Handler: `handleLaunchKit()` in `session.ts`
- Steps:
  - `trigger` or `select_products`: Identify products
  - `select_services`: Choose services needed
  - `collect_requirements`: Project brief collection
  - `create_order`: Create Shopify draft order

**Launch Kit Services** (to be defined):
- Product Photography
- Package Design
- Branding Consultation
- Marketing Materials
- etc.

**Files to Create/Modify**:
- `src/session.ts`: Add `handleLaunchKit()` method
- `src/charters.ts`: Add `LAUNCH_KIT_CHARTER`
- `src/index.ts`: Add webhook endpoint for Salla product events

---

## Phase 5: Packaging Assistant Flow (Week 5-6)

### 5.1 Packaging Assistant Consultation

**Goal**: Help Salla store owners determine the right package for their product

**Flow**:
1. **Product Information Collection**:
   - Product dimensions
   - Product weight/fragility
   - Product category
   - Brand requirements
   - Budget constraints
2. **Package Recommendation**: AI analyzes and suggests packages
3. **Refinement**: User can refine requirements
4. **Final Recommendation**: Present recommended package
5. **Optional Order**: Offer to create package order directly

**Implementation**:
- Handler: `handlePackagingAssistant()` in `session.ts`
- Steps:
  - `collect_product_info`: Gather product details (similar to consultation flow)
  - `analyze_requirements`: AI analyzes against available packages
  - `recommend_packages`: Suggest 1-3 best matches
  - `refine_selection`: Allow user to ask questions, refine
  - `finalize_recommendation`: Present final recommendation
  - `offer_order`: Optionally create order

**AI Enhancement**:
- Use product catalog + user requirements for matching
- Can reuse existing discovery AI logic but with different context

**Files to Create/Modify**:
- `src/session.ts`: Add `handlePackagingAssistant()` method
- `src/charters.ts`: Add `PACKAGING_ASSISTANT_CHARTER`
- `src/types.ts`: Add `ProductInfo`, `PackageRecommendation` interfaces

---

## Phase 6: Integration & Webhooks (Week 6-7)

### 6.1 Salla Webhook Handler

**Goal**: Handle Salla events (new product, order updates, etc.)

**Events to Handle**:
- `product.created` → Trigger Launch Kit suggestion
- `product.updated` → Update mappings if needed
- `order.created` → Track package orders (optional)

**Implementation**:
- New endpoint: `POST /api/salla/webhook`
- Verify webhook signature (Salla security)
- Route to appropriate handler based on event type
- Trigger appropriate agent flow if needed

**Files to Create/Modify**:
- `src/index.ts`: Add webhook endpoint
- `src/salla.ts`: Add webhook verification
- `src/session.ts`: Add webhook-triggered flow initiation

### 6.2 Reorder Functionality

**Goal**: Allow quick reordering of previously ordered packages

**Implementation**:
- Store order history in `StoreMapping` or separate `OrderHistory` Durable Object
- Add `reorder` flow that:
  1. Lists previous orders
  2. Allows selection
  3. Pre-fills package and quantity
  4. Allows modification
  5. Creates new order

**Files to Create/Modify**:
- `src/store-mapping.ts`: Add order history storage
- `src/session.ts`: Add reorder flow

---

## Technical Implementation Details

### Type System Extensions

```typescript
// src/types.ts additions

export type Channel = "direct" | "salla";
export type AgentFlow = "direct_sales" | "package_order" | "launch_kit" | "packaging_assistant";

export interface Memory {
  channel: Channel;
  flow: AgentFlow;
  step: string; // Flow-specific steps
  // ... existing fields
  storeId?: string;  // For Salla flows
  sallaProductId?: string;  // For package ordering
  productMappingId?: string;  // For mapped products
  // ... rest of existing fields
}

export interface StoreConnection {
  storeId: string;
  merchantToken: string;
  storeName: string;
  connectedAt: number;
  lastSync: number;
}

export interface ProductMapping {
  id: string;
  storeId: string;
  sallaProductId: string;
  sallaProductName: string;
  packagehaPackageId: number;
  packagehaPackageName: string;
  createdAt: number;
  lastUsed: number;
}

export interface RequestBody {
  message?: string;
  reset?: boolean;
  context?: Channel;
  flow?: AgentFlow;
  storeId?: string;
  // ... for webhooks
  event?: string;
  data?: any;
}
```

### Session ID Strategy

**Current**: IP-based session IDs
**New**: Channel-aware session IDs

```typescript
// Option 1: Prefix-based
const sessionKey = `${channel}:${ip}`;
const sessionId = env.PackagehaSession.idFromName(sessionKey);

// Option 2: Store-aware (for Salla)
const sessionKey = channel === "salla" 
  ? `salla:${storeId}:${userId}` 
  : `direct:${ip}`;
```

### Durable Objects Strategy

**New Durable Object**: `StoreMapping`
- Purpose: Store Salla store connections and product mappings
- Namespace: Per-store (using `storeId`)
- Data: Connection credentials, product mappings, order history

**Existing**: `PackagehaSession`
- Extend to handle multiple flows
- Keep session-based (per-user conversation)

### Environment Variables

```toml
# wrangler.toml additions

# Salla API Configuration
SALLA_APP_ID = "your-app-id"
SALLA_APP_SECRET = "your-app-secret"
SALLA_REDIRECT_URI = "https://your-domain.com/api/salla/callback"

# Existing Shopify config (unchanged)
SHOPIFY_ACCESS_TOKEN = "..."
SHOP_URL = "..."
```

---

## Data Flow Diagrams

### Package Ordering Flow
```
User → Salla App → Packageha API
  → Check Store Connection
  → List User's Salla Products
  → Select Product
  → Check Product Mapping
  → [If No Mapping] → Mapping Flow
  → [If Mapped] → Show Package Details
  → Collect Quantity/Customizations
  → Create Shopify Draft Order
  → Return Order Link
```

### Packaging Assistant Flow
```
User → Salla App → Packageha API
  → Initiate Packaging Assistant
  → Collect Product Information (dimensions, weight, etc.)
  → AI Analysis (match against Packageha catalog)
  → Recommend Packages (1-3 options)
  → Refinement Loop (optional)
  → Final Recommendation
  → [Optional] Create Order
```

### Store Connection Flow
```
User → Salla App → "Connect Store" Button
  → Salla OAuth Flow
  → Callback to Packageha API
  → Validate Token
  → Create StoreMapping Durable Object
  → Fetch Store Details
  → Store Connection Data
  → Return Success
```

---

## API Endpoints Summary

### Existing (Packageha.com)
- `POST /` - Main chat endpoint (direct sales)
- `GET /` - Health check

### New (Salla App)
- `POST /api/salla/connect` - Connect Salla store
- `POST /api/salla/disconnect` - Disconnect store
- `POST /api/salla/map-product` - Map product to package
- `GET /api/salla/products` - List store products
- `GET /api/salla/mappings` - Get product mappings
- `POST /api/salla/webhook` - Salla webhook handler
- `POST /` - Main chat endpoint (with context="salla")

### Flow-Specific Endpoints (Internal)
- All flows use the main `POST /` endpoint with different `flow` and `context` params

---

## Testing Strategy

### Unit Tests
- Salla API client functions
- Store mapping operations
- Flow routing logic
- Charter builders

### Integration Tests
- End-to-end package ordering flow
- Store connection flow
- Product mapping flow
- Packaging assistant consultation

### Manual Testing Checklist
- [ ] Connect Salla store
- [ ] Map product to package
- [ ] Order package via Salla app
- [ ] Launch Kit ordering (manual trigger)
- [ ] Launch Kit ordering (webhook trigger)
- [ ] Packaging Assistant consultation
- [ ] Reorder functionality
- [ ] Direct sales flow (regression test)
- [ ] Error handling (invalid tokens, API failures)
- [ ] Multi-store support (merchant with multiple stores)

---

## Migration & Rollout Plan

### Phase 1: Infrastructure (Non-breaking)
- Add new types and infrastructure
- Keep existing direct sales flow unchanged
- Deploy and test infrastructure

### Phase 2: Salla Integration (Parallel)
- Deploy Salla API client
- Test in staging with test Salla store
- Deploy to production (no impact on existing flow)

### Phase 3: New Flows (Feature flags)
- Implement flows behind feature flags
- Test with beta users
- Gradual rollout

### Phase 4: Full Launch
- Remove feature flags
- Documentation
- User onboarding materials

---

## Open Questions & Decisions Needed

1. **Salla API Documentation**: Need to research:
   - OAuth flow details
   - Product API endpoints
   - Order API endpoints
   - Webhook system

2. **Store Authentication**: 
   - OAuth vs API tokens?
   - Token refresh strategy?
   - Multi-store merchant handling?

3. **Mapping UI**: 
   - Where does mapping happen? (Frontend vs Agent conversation)
   - Auto-mapping vs manual mapping preference?

4. **Launch Kit Services**: 
   - What services are included?
   - How to define/present them?
   - Pricing structure?

5. **Packaging Assistant Output**:
   - How many recommendations? (1-3)
   - Include pricing?
   - Allow direct ordering?

6. **Order Sync**:
   - Create orders in Shopify only?
   - Or also sync to Salla?
   - How to handle order status updates?

7. **Session Management**:
   - Keep IP-based for direct sales?
   - Use storeId+userId for Salla?
   - Authentication/authorization strategy?

---

## Success Metrics

- **Store Connections**: Number of Salla stores connected
- **Product Mappings**: Number of products mapped to packages
- **Package Orders**: Orders placed via Salla app
- **Launch Kit Orders**: Launch kit orders placed
- **Packaging Assistant Usage**: Consultations completed
- **Conversion Rate**: Consultation → Order conversion
- **User Satisfaction**: Feedback scores

---

## Timeline Summary

- **Week 1-2**: Foundation & Infrastructure
- **Week 2-3**: Multi-Flow Agent System
- **Week 3-4**: Package Ordering Flow
- **Week 4-5**: Launch Kit Ordering Flow
- **Week 5-6**: Packaging Assistant Flow
- **Week 6-7**: Integration & Webhooks
- **Week 7+**: Testing, Refinement, Launch

**Total Estimated Timeline**: 7-8 weeks

---

## Next Steps

1. **Review & Approve Plan**: Get stakeholder sign-off
2. **Research Salla API**: Get API documentation, test credentials
3. **Define Launch Kit Services**: Finalize service offerings
4. **Create Detailed Technical Specs**: For each phase
5. **Set Up Development Environment**: Salla sandbox, test stores
6. **Begin Phase 1 Implementation**: Start with infrastructure

---

**Document Version**: 1.0  
**Last Updated**: [Current Date]  
**Status**: Draft - Awaiting Review


