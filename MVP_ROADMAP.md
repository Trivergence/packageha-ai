# Packageha MVP Roadmap - Shopify Channel First

## Priority-Based Approach

Based on priorities:
1. ✅ **Shopify Channel First** - Focus on Packageha.com Shopify integration
2. ✅ **MVP Approach** - Build minimum viable product quickly
3. ✅ **Better AI** - Upgrade from Cloudflare AI to ChatGPT/Gemini

---

## Phase 1: AI Upgrade (Week 1) 🚀 PRIORITY

### Goal
Switch from Cloudflare AI (Llama 3.1 8B) to ChatGPT or Gemini for better intelligence

### Recommendation: **Gemini Flash 1.5** 
**Why Gemini over ChatGPT:**
- ✅ **Better JSON generation** - Critical for structured responses (product matching, variant selection)
- ✅ **Faster responses** - Lower latency for conversational agents
- ✅ **Lower cost** - More cost-effective for high-volume usage
- ✅ **Still excellent** for conversations and natural language
- ✅ **Direct API** - Simple integration via Google AI Studio API

**Alternative: GPT-4o** (if you prefer OpenAI ecosystem)
- Also excellent, slightly better for creative tasks
- Slightly more expensive
- Very reliable and well-documented

### Implementation
- Extend `sovereign-switch.ts` to support OpenAI and Gemini APIs
- Add new mode: `COMMERCIAL_OPENAI` or `COMMERCIAL_GEMINI`
- Keep existing Cloudflare AI as fallback
- Add API key configuration to `wrangler.toml`

### Files to Modify
- `src/sovereign-switch.ts` - Add OpenAI/Gemini providers
- `src/types.ts` - Add provider types
- `wrangler.toml` - Add API keys

**Timeline**: 2-3 days

---

## Phase 2: Shopify Channel MVP - Core Flows (Week 1-2)

### Goal
Build minimum viable product for Shopify channel with three core capabilities

### MVP Scope (Simplified)

#### 2.1 Package Ordering Flow (Simplified)
**Simplified Approach**: Instead of complex product-to-package mapping system:
- **Direct package selection** - User selects package from Packageha catalog
- **Skip complex mapping** - Save mapping system for v2
- **Focus on ordering flow** - Quantity, customization, order creation

**Flow**:
1. User: "I want to order packages"
2. Agent: Lists available packages (from Shopify)
3. User: Selects package
4. Agent: Asks quantity and any customizations
5. Agent: Creates draft order

**Implementation**:
- Reuse existing discovery flow (product search)
- Extend consultation to be shorter (quantity + customizations only)
- Keep existing order creation

**Files**: 
- `src/session.ts` - Add package ordering flow (simplified)
- `src/charter.ts` - Add package ordering charter

---

#### 2.2 Launch Kit Ordering Flow (Simplified)
**Simplified Approach**: Manual trigger only (skip webhooks for MVP)

**Flow**:
1. User: "I want to order Launch Kit" or "I need studio services"
2. Agent: Lists Launch Kit services
3. User: Selects services
4. Agent: Collects basic requirements
5. Agent: Creates draft order

**Launch Kit Services** (Keep Simple):
- Product Photography
- Package Design
- Brand Consultation

**Implementation**:
- New flow: `launch_kit`
- Simple service selection (not complex)
- Basic requirements collection

**Files**:
- `src/session.ts` - Add launch kit flow
- `src/charter.ts` - Add launch kit charter
- `src/types.ts` - Add launch kit types

---

#### 2.3 Packaging Assistant Flow (Simplified)
**Simplified Approach**: Consultation → Recommendation → Optional Order

**Flow**:
1. User: "I need help choosing a package"
2. Agent: Collects product info (dimensions, weight, category, budget)
3. Agent: AI analyzes and recommends 1-2 packages
4. Agent: Shows recommendations with brief explanation
5. Agent: "Would you like to order [recommended package]?"

**Implementation**:
- Similar to existing consultation flow
- Add recommendation logic (AI-powered matching)
- Present recommendations clearly
- Option to create order from recommendation

**Files**:
- `src/session.ts` - Add packaging assistant flow
- `src/charter.ts` - Add packaging assistant charter
- `src/types.ts` - Add recommendation types

---

## Phase 3: Flow Routing System (Week 2)

### Goal
Add simple flow detection and routing (keep it simple for MVP)

### Implementation
- Add `flow` parameter to request body
- Extend `Memory.step` to include flow type
- Simple routing in `session.ts`:
  - `flow="package_order"` → Package ordering
  - `flow="launch_kit"` → Launch Kit
  - `flow="assistant"` → Packaging Assistant
  - No flow or `flow="direct"` → Existing direct sales

**Keep Simple**: 
- No complex intent detection for MVP
- Frontend/client sends flow type explicitly
- Can add intent detection later

**Files**:
- `src/types.ts` - Add flow types
- `src/session.ts` - Add flow routing

---

## Simplified Architecture (MVP)

### What We're NOT Building (for MVP):
- ❌ Salla integration (Phase 2, later)
- ❌ Product-to-package mapping system (v2)
- ❌ Store connection system (v2)
- ❌ Webhook handlers (v2)
- ❌ Reorder functionality (v2)
- ❌ Complex intent detection (v2)

### What We ARE Building (MVP):
- ✅ AI upgrade (Gemini/OpenAI)
- ✅ Three simplified flows (Package Order, Launch Kit, Assistant)
- ✅ Simple flow routing
- ✅ All flows create Shopify draft orders
- ✅ All flows use same Shopify integration

---

## MVP Implementation Plan

### Week 1: Foundation
- **Days 1-2**: AI Upgrade (Gemini/OpenAI integration)
- **Days 3-4**: Flow routing system
- **Day 5**: Testing AI upgrade + routing

### Week 2: Flows
- **Days 1-2**: Package Ordering Flow
- **Days 3-4**: Launch Kit Flow
- **Day 5**: Packaging Assistant Flow

### Week 3: Polish & Testing
- Integration testing
- Error handling improvements
- Documentation
- Deploy MVP

**Total MVP Timeline**: 3 weeks

---

## Technical Decisions (MVP)

### 1. Flow Detection
- **MVP**: Explicit `flow` parameter in request
- **Future**: AI-powered intent detection

### 2. Product Mapping
- **MVP**: Skip mapping system
- **Future**: Build mapping system for v2

### 3. Launch Kit Services
- **MVP**: Hardcoded 3 services
- **Future**: Dynamic service catalog

### 4. Packaging Assistant Recommendations
- **MVP**: Simple AI matching against product catalog
- **Future**: Advanced recommendation engine

### 5. Session Management
- **MVP**: Keep IP-based (same as current)
- **Future**: Add user authentication if needed

---

## Files Structure (MVP)

```
src/
├── index.ts              # Main entry (minimal changes)
├── session.ts            # Flow routing + handlers
├── charter.ts            # All charters (rename to charters.ts?)
├── shopify.ts            # Shopify integration (no changes)
├── sovereign-switch.ts   # AI routing (add OpenAI/Gemini)
└── types.ts              # Type definitions (extend)
```

**No new files needed for MVP** - just extend existing ones!

---

## Success Criteria (MVP)

- ✅ AI responses are significantly better (subjective but noticeable)
- ✅ All three flows work end-to-end
- ✅ All flows create Shopify draft orders successfully
- ✅ Flow routing works correctly
- ✅ No breaking changes to existing direct sales flow

---

## Post-MVP (Future Phases)

### Phase 4: Enhancement
- Add product-to-package mapping system
- Add reorder functionality
- Improve recommendation engine
- Add analytics

### Phase 5: Salla Integration
- Salla API integration
- Store connection system
- Product mapping for Salla products
- Webhook handlers

### Phase 6: Advanced Features
- Multi-store support
- Advanced analytics
- A/B testing for charters
- Multi-language enhancements

---

## Next Steps

1. **Immediate**: Implement AI upgrade (Gemini or OpenAI)
2. **Week 1**: Build flow routing system
3. **Week 2**: Implement three flows
4. **Week 3**: Test and deploy MVP

**Let's start with the AI upgrade!** 🚀

