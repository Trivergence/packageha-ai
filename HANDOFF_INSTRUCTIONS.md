# Handoff Instructions for Packageha AI Agent

## Project Context

You are working on **The Studium** - a Multi-Agent as a Service (MAaaS) platform. This specific implementation is for **Packageha**, a retail client that needs "Headed Commerce" (Shopify integration with AI sales agents).

## Architecture Overview

### The Studium Philosophy
- **Concept:** AI Agents as "Beings," not bots
- **Metaphor:** "Parenting, not Programming" - We teach values (Charters), not just rules
- **Hierarchy:**
  - **Studium:** The Platform (The University)
  - **Campus:** The Client Entity (Packageha)
  - **Practice:** The Department (Sales)
  - **Charter:** The Governance/Rules (Soul) that Beings must obey
  - **Being:** The Agent (Soul + Mind + Body)

### Technology Stack
- **Backend:** Cloudflare Workers + Durable Objects (State)
- **Language:** TypeScript
- **AI Routing:** Hybrid Sovereign Switch (Mode A/B/C)
- **Integration:** Shopify Admin API

## Current Implementation Status

### ✅ Completed Features

1. **Hybrid Sovereign Switch** (`src/sovereign-switch.ts`)
   - Mode A (Commercial): Cloudflare AI (`@cf/meta/llama-3-8b-instruct`)
   - Mode B (Sovereign): Vertex AI (Dammam Region) - configured but not tested
   - Mode C (Air-Gapped): Local Llama server - configured but not tested
   - Currently set to Mode A in `wrangler.toml`

2. **Core Agent Flow** (`src/session.ts`)
   - **Phase 1: Discovery** - Product search using AI-powered fuzzy matching
   - **Phase 2: Variant Selection** - Choose product variant (auto-skip if only one)
   - **Phase 3: Consultation** - Collect 6 pieces of information:
     - Quantity (with validation)
     - Material
     - Dimensions (with validation)
     - Printing/Finish
     - Timeline
     - Budget
   - **Phase 4: Order Creation** - Creates Shopify draft order with project brief

3. **Charter System** (`src/charter.ts`)
   - Structured Charter with validation functions
   - `buildCharterPrompt()` function for AI system prompts
   - Rules embedded in all AI calls

4. **Shopify Integration** (`src/shopify.ts`)
   - `getActiveProducts()` - Fetches active products from Shopify
   - `createDraftOrder()` - Creates draft order with project brief
   - Proper error handling with exceptions

5. **Memory Management**
   - Stateful Durable Object sessions
   - Memory persistence with timestamps
   - Reset functionality
   - Fresh clipboard objects (no shared references)

### 🐛 Recent Bug Fixes

All critical bugs have been fixed:
- ✅ Timestamp issue (unique timestamps per session)
- ✅ Memory reset not persisting
- ✅ Unhandled exceptions from Shopify API
- ✅ Memory not being saved for new sessions
- ✅ Shared clipboard object references
- ✅ Dead code in order creation
- ✅ IP address extraction with whitespace
- ✅ Quantity validation decimal handling
- ✅ Reset keyword false positives

## Code Structure

```
src/
├── index.ts              # Main Worker entry point, routes to Durable Objects
├── session.ts            # PackagehaSession class - the Being (Agent)
├── charter.ts            # SALES_CHARTER - the Soul (rules/values)
├── shopify.ts            # Shopify API integration
├── sovereign-switch.ts   # AI provider routing (Mode A/B/C)
└── types.ts              # TypeScript interfaces and types
```

## Key Files to Understand

### 1. `src/session.ts` - The Being (Agent)
- `PackagehaSession` class: Stateful Durable Object
- `fetch()`: Main request handler
- Phase handlers:
  - `handleDiscovery()`: Product search
  - `handleVariantSelection()`: Variant choice
  - `handleConsultation()`: Question collection
  - `createProjectQuote()`: Order creation
- Helper methods for AI calls, memory management, validation

### 2. `src/charter.ts` - The Soul (Rules)
- `SALES_CHARTER`: Complete behavior definition
- `buildCharterPrompt()`: Generates AI system prompts
- Validation functions for consultation steps

### 3. `src/sovereign-switch.ts` - AI Routing
- `SovereignSwitch` class: Routes AI calls based on `SOVEREIGN_MODE`
- Currently using Mode A (Cloudflare AI)
- Ready for Mode B/C but not tested

### 4. `src/index.ts` - Entry Point
- Routes requests to Durable Object sessions
- Uses IP address for session ID (with proper trimming)
- Handles CORS and health checks

## Configuration

### `wrangler.toml`
- `SOVEREIGN_MODE = "COMMERCIAL"` (Mode A)
- Cloudflare AI binding enabled
- Durable Objects configured
- Environment variables for Shopify credentials

### Required Environment Variables
- `SHOPIFY_ACCESS_TOKEN`: Shopify Admin API token
- `SHOP_URL`: Shopify store URL
- `SOVEREIGN_MODE`: AI routing mode (optional, defaults to COMMERCIAL)

## Current Behavior (From Screenshots)

Based on the provided screenshots, the agent is:
1. ✅ Successfully finding products ("boxes" → "Abstract Box")
2. ✅ Collecting consultation data (quantity, material, dimensions, print, timeline, budget)
3. ✅ Creating draft orders and linking to checkout
4. ✅ Handling user inputs correctly

## Known Issues / TODOs

### Testing Checklist (From REFACTOR_SUMMARY.md)
- [ ] Test discovery phase with various product queries
- [ ] Test variant selection with multiple options
- [ ] Test consultation flow with validation
- [ ] Test reset functionality
- [ ] Test error handling (network failures, AI failures)
- [ ] Test Sovereign Switch in all three modes
- [ ] Test with Arabic input
- [ ] Test draft order creation

### Potential Improvements
1. **Multi-language Support**
   - Enhanced Arabic support
   - Language detection
   - Localized responses

2. **Council Integration** (Future)
   - The Warden: PII redaction
   - The Sentinel: Charter updates
   - The Adversary: Red-teaming

3. **Analytics**
   - Track conversation metrics
   - Monitor AI provider performance
   - A/B testing for Charter variations

## How to Continue Development

### 1. Understanding the Flow
```
User Message → index.ts → PackagehaSession.fetch()
  → Load Memory
  → Route to Phase Handler (discovery/variant/consultation)
  → Call AI via SovereignSwitch
  → Update Memory
  → Return Response
```

### 2. Making Changes

**To modify behavior:**
- Edit `SALES_CHARTER` in `src/charter.ts` for rules/values
- Edit phase handlers in `src/session.ts` for logic
- Edit `buildCharterPrompt()` for AI prompt structure

**To add features:**
- Add new phase handlers in `src/session.ts`
- Update `Memory` type in `src/types.ts` if needed
- Update Charter if new rules are needed

**To test:**
- Use `wrangler dev` for local testing
- Check Cloudflare dashboard for logs
- Test with actual Shopify store

### 3. Debugging

- Check console logs (prefixed with `[FunctionName]`)
- Memory state is stored in Durable Object storage
- AI decisions are logged in `getAIDecision()` and `getVariantDecision()`
- Errors are caught and returned as user-friendly messages

### 4. Common Patterns

**AI Call Pattern:**
```typescript
const systemPrompt = buildCharterPrompt("phase");
const userPrompt = "...";
const decision = await this.getAIDecision(userPrompt, systemPrompt);
```

**Memory Update Pattern:**
```typescript
memory.field = value;
memory.lastActivity = Date.now();
await this.state.storage.put("memory", memory);
```

**Error Handling Pattern:**
```typescript
try {
  // operation
} catch (error: any) {
  console.error("[FunctionName] Error:", error);
  return { reply: "User-friendly error message" };
}
```

## Important Notes

1. **Memory Reset Flag**: When handlers delete memory, they return `{ memoryReset: true }` to prevent the main `fetch()` from saving it back.

2. **Fresh Objects**: Always create new objects for `clipboard` to avoid shared references.

3. **AI Provider**: Currently using Cloudflare AI. To switch modes, update `SOVEREIGN_MODE` in `wrangler.toml` and configure environment variables.

4. **Session ID**: Based on IP address. Could be changed to user ID if authentication is added.

5. **Charter Rules**: All AI prompts include Charter rules via `buildCharterPrompt()`. This is the "Soul" of the Being.

## Next Steps (Based on User's Request)

The user mentioned they have videos of desired behavior but cannot upload them. They want to:
- Share desired behavior (possibly via description)
- Continue development to match desired behavior

**Your task:**
1. Ask the user to describe the desired behavior in detail
2. Compare with current implementation
3. Identify gaps and implement changes
4. Test thoroughly

## Questions to Ask the User

1. What specific behavior changes are needed?
2. Are there issues with the current flow?
3. What features are missing?
4. Are there UI/UX changes needed?
5. Any performance or reliability concerns?

## Resources

- **Studium Architecture**: See system context in conversation history
- **Refactor Summary**: `REFACTOR_SUMMARY.md`
- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Shopify Admin API**: https://shopify.dev/api/admin-rest

---

**Last Updated:** After comprehensive refactor and bug fixes
**Status:** Production-ready, awaiting user feedback on desired behavior changes




