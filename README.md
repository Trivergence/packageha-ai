# Packageha AI - Complete Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Philosophy](#architecture--philosophy)
3. [Current Status](#current-status)
4. [Setup & Configuration](#setup--configuration)
5. [Development Guide](#development-guide)
6. [Testing Guide](#testing-guide)
7. [Debugging Guide](#debugging-guide)
8. [API Reference](#api-reference)
9. [Future Plans](#future-plans)

---

## Project Overview

**Packageha AI** is an AI-powered sales agent for Packageha.com, built on The Studium architecture. The system provides conversational interfaces for customers to discover, customize, and order packaging solutions through Shopify integration.

### Main Features

- **Direct Sales Flow**: 5-step consultation process (Product Details → Package Selection → Fulfillment → Launch Kit → Draft Order)
- **Launch Kit Flow**: Service ordering for brand launch services
- **AI-Powered Package Matching**: Intelligent product discovery using Gemini/OpenAI
- **Edit Functionality**: Edit any completed question without losing subsequent data
- **Draft Order Creation**: Automatic Shopify draft order generation

### Technology Stack

- **Backend**: Cloudflare Workers + Durable Objects (State)
- **Language**: TypeScript
- **AI Routing**: Hybrid Sovereign Switch (Gemini/OpenAI/Cloudflare AI)
- **Integration**: Shopify Admin API
- **Frontend**: Vanilla JavaScript (`test.html`)

---

## Architecture & Philosophy

### The Studium Philosophy

**Concept**: AI Agents as "Beings," not bots  
**Metaphor**: "Parenting, not Programming" - We teach values (Charters), not just rules

**Hierarchy**:
- **Studium**: The Platform (The University)
- **Campus**: The Client Entity (Packageha)
- **Practice**: The Department (Sales)
- **Charter**: The Governance/Rules (Soul) that Beings must obey
- **Being**: The Agent (Soul + Mind + Body)

### Code Structure

```
src/
├── index.ts              # Main Worker entry point, routes to Durable Objects
├── session.ts            # PackagehaSession class - the Being (Agent)
├── charter.ts            # SALES_CHARTER - the Soul (rules/values)
├── shopify.ts            # Shopify API integration
├── sovereign-switch.ts   # AI provider routing (Mode A/B/C)
└── types.ts              # TypeScript interfaces and types

test.html                 # Frontend UI (standalone HTML file)
wrangler.toml             # Cloudflare Workers configuration
```

### Data Flow

```
User → test.html → index.ts → PackagehaSession.fetch()
  → Load Memory
  → Route to Flow Handler
  → AI Call (via SovereignSwitch)
  → Update Memory
  → Return Response
  → Update UI
```

### State Management

- **Backend**: `Memory` object in Durable Object storage
- **Frontend**: `flowState` object in JavaScript
- **Synchronization**: `backendStep` tracks backend state

---

## Current Status

### ✅ Production Ready

**Direct Sales Flow** - Fully functional with advanced features:
- All 5 steps working (Product Details → Package Selection → Fulfillment → Launch Kit → Draft Order)
- Edit functionality working
- State management robust
- Frontend UI complete
- Error handling comprehensive

**Features**:
- ✅ Edit any completed question without losing subsequent data
- ✅ Regenerate draft order after edits
- ✅ AI-powered package search with dual search (auto-search + user search)
- ✅ Product selection with variants
- ✅ Custom package option with dimension-based pricing
- ✅ Google Maps address autocomplete
- ✅ Draft order creation in Shopify
- ✅ Step-by-step UI with visual progress tracking

### ✅ Implemented (Needs Testing)

**Launch Kit Flow** - Backend ready, needs frontend integration:
- Service selection working
- Consultation phase complete
- Charter defined

### AI Infrastructure

- **Gemini Flash 1.5** (Recommended) - Better JSON generation, faster, cost-effective
- **OpenAI GPT-4o/GPT-4o-mini** - Alternative option
- **Cloudflare AI** - Fallback mode (free but limited)
- **Vertex AI** - Sovereign mode ready (not tested)
- **Local Llama** - Air-gapped mode ready (not tested)

---

## Setup & Configuration

### Prerequisites

- Node.js and npm installed
- Cloudflare Workers account
- Shopify store with Admin API access
- AI API key (Gemini or OpenAI recommended)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure `wrangler.toml`:**
   - Set up Durable Object binding
   - Configure AI mode (see AI Setup below)
   - Add Shopify credentials

3. **Set environment variables:**
   ```bash
   wrangler secret put SHOPIFY_ACCESS_TOKEN
   wrangler secret put SHOP_URL
   wrangler secret put GEMINI_API_KEY  # If using Gemini
   # OR
   wrangler secret put OPENAI_API_KEY  # If using OpenAI
   ```

4. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

### AI Setup

#### Option 1: Gemini (Recommended)

**Why Gemini Flash 1.5?**
- ✅ Better JSON generation - Critical for structured responses
- ✅ Faster responses - Lower latency
- ✅ Cost-effective - Cheaper than GPT-4o
- ✅ Excellent for conversations - Natural language understanding
- ✅ Free tier available - Google AI Studio offers free credits

**Setup:**
1. Get API key from https://aistudio.google.com/app/apikey
2. Set secret: `wrangler secret put GEMINI_API_KEY`
3. In `wrangler.toml`, set: `SOVEREIGN_MODE = "COMMERCIAL_GEMINI"`
4. Deploy: `wrangler deploy`

#### Option 2: OpenAI (ChatGPT)

**Setup:**
1. Get API key from https://platform.openai.com/api-keys
2. Set secret: `wrangler secret put OPENAI_API_KEY`
3. In `wrangler.toml`, set: `SOVEREIGN_MODE = "COMMERCIAL_OPENAI"`
4. Optionally modify model in `sovereign-switch.ts`:
   - `gpt-4o-mini` (default - cost-effective)
   - `gpt-4o` (best quality, more expensive)
5. Deploy: `wrangler deploy`

#### Option 3: Cloudflare AI (Legacy)

**Setup:**
1. In `wrangler.toml`, set: `SOVEREIGN_MODE = "COMMERCIAL"`
2. Deploy: `wrangler deploy`

### Model Comparison

| Provider | Model | Quality | Speed | Cost | Best For |
|----------|-------|---------|-------|------|----------|
| Cloudflare AI | Llama 3.1 8B | ⭐⭐ | ⚡⚡⚡ | Free | Testing, prototypes |
| OpenAI | GPT-4o-mini | ⭐⭐⭐⭐ | ⚡⚡⚡ | Low | General use, balanced |
| OpenAI | GPT-4o | ⭐⭐⭐⭐⭐ | ⚡⚡ | Medium | Best quality |
| Gemini | Gemini 1.5 Flash | ⭐⭐⭐⭐ | ⚡⚡⚡ | Very Low | **MVP (Recommended)** |

### Cost Estimates

- **Gemini Flash 1.5**: ~$0.0002 per conversation
- **OpenAI GPT-4o-mini**: ~$0.0004 per conversation
- **OpenAI GPT-4o**: ~$0.006 per conversation

**Recommendation**: Start with Gemini Flash 1.5 for MVP.

---

## Development Guide

### Understanding the Flow

```
User Message → index.ts → PackagehaSession.fetch()
  → Load Memory
  → Route to Flow Handler (direct_sales/launch_kit)
  → Call AI via SovereignSwitch
  → Update Memory
  → Return Response
```

### Key Files

#### 1. `src/session.ts` - The Being (Agent)
- `PackagehaSession` class: Stateful Durable Object
- `fetch()`: Main request handler
- Flow handlers:
  - `handleDirectSalesFlow()`: Main sales consultation flow
  - `handleLaunchKitFlow()`: Launch Kit service ordering
- Helper methods for AI calls, memory management, validation

#### 2. `src/charter.ts` - The Soul (Rules)
- `SALES_CHARTER`: Complete behavior definition
- `LAUNCH_KIT_CHARTER`: Launch Kit service rules
- `buildCharterPrompt()`: Generates AI system prompts
- Validation functions for consultation steps

#### 3. `src/sovereign-switch.ts` - AI Routing
- `SovereignSwitch` class: Routes AI calls based on `SOVEREIGN_MODE`
- Supports: Gemini, OpenAI, Cloudflare AI, Vertex AI, Local Llama

#### 4. `src/index.ts` - Entry Point
- Routes requests to Durable Object sessions
- Uses IP address for session ID
- Handles CORS and health checks

### Making Changes

**To modify behavior:**
- Edit `SALES_CHARTER` in `src/charter.ts` for rules/values
- Edit flow handlers in `src/session.ts` for logic
- Edit `buildCharterPrompt()` for AI prompt structure

**To add features:**
- Add new flow handlers in `src/session.ts`
- Update `Memory` type in `src/types.ts` if needed
- Update Charter if new rules are needed

**To add a new question:**
1. Add question to `SALES_CHARTER` in `src/charter.ts`
2. Add question ID to `getQuestionOrder()` in `test.html`
3. Add label to `getQuestionLabel()` in `test.html`

### Common Patterns

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

### Important Notes

1. **Memory Reset Flag**: When handlers delete memory, they return `{ memoryReset: true }` to prevent the main `fetch()` from saving it back.

2. **Fresh Objects**: Always create new objects for `clipboard` to avoid shared references.

3. **AI Provider**: Currently using Gemini (recommended). To switch modes, update `SOVEREIGN_MODE` in `wrangler.toml` and configure environment variables.

4. **Session ID**: Based on IP address. Could be changed to user ID if authentication is added.

5. **Charter Rules**: All AI prompts include Charter rules via `buildCharterPrompt()`. This is the "Soul" of the Being.

---

## Testing Guide

### Quick Test: Browser Test Page

1. **Open `test.html`** in your browser
2. **Configure Worker URL** (if needed):
   - Default: `https://packageha-ai.akhodary-006.workers.dev`
   - Update in the input field if different
3. **Test Direct Sales Flow:**
   - Click "Direct Sales" button
   - Type: `I need custom boxes`
   - Follow the conversation through all 5 steps
4. **Test Launch Kit Flow:**
   - Click "Launch Kit" button
   - Type: `I need Launch Kit services`
   - Follow the conversation
5. **Reset Between Tests:**
   - Click "Reset" button or type "reset"

### Using Browser DevTools Console

```javascript
async function testFlow(flow, message) {
    const response = await fetch('https://packageha-ai.akhodary-006.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, flow })
    });
    const data = await response.json();
    console.log('Response:', data.reply);
    return data;
}

// Test Direct Sales
testFlow('direct_sales', 'I need custom boxes');

// Test Launch Kit
testFlow('launch_kit', 'I need Launch Kit services');
```

### Using curl (Terminal)

**Windows (PowerShell):**
```powershell
# Test Direct Sales
Invoke-RestMethod -Uri "https://packageha-ai.akhodary-006.workers.dev" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"I need custom boxes","flow":"direct_sales"}'

# Test Launch Kit
Invoke-RestMethod -Uri "https://packageha-ai.akhodary-006.workers.dev" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"I need Launch Kit services","flow":"launch_kit"}'
```

**Mac/Linux (Terminal):**
```bash
# Test Direct Sales
curl -X POST https://packageha-ai.akhodary-006.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"I need custom boxes","flow":"direct_sales"}'

# Test Launch Kit
curl -X POST https://packageha-ai.akhodary-006.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"I need Launch Kit services","flow":"launch_kit"}'
```

### Test Scenarios

**Direct Sales Flow:**
1. Start: "I need custom boxes"
2. Answer product details questions
3. Search for packages: "boxes" or "custom boxes"
4. Select package and variant
5. Provide package specs (material, print)
6. Provide fulfillment details (quantity, timeline, address)
7. Select Launch Kit services (optional)
8. Get draft order link!

**Launch Kit Flow:**
1. Start: "I need Launch Kit"
2. Select services: "Product Photography and Package Design"
3. Product info: "I'm launching a new perfume product"
4. Timeline: "Within 2 weeks"
5. Budget: "Around 5000 SAR"
6. Notes: "Need professional photos"
7. Get order link!

### Recommended Testing Order

1. ✅ **Test Direct Sales** (verify existing flow still works)
2. ✅ **Test Launch Kit** (service selection flow)

---

## Debugging Guide

### How to Share Errors for Debugging

#### Method 1: Share Cloudflare Logs (Easiest)

1. Open Cloudflare Dashboard → Your Worker → **Observability** → **Logs**
2. Find the error log (red one with error details)
3. Copy the error message
4. Share it - I can read and fix it!

**What to share:**
- The error message text (e.g., `Error: Gemini API error: 404...`)
- The timestamp if relevant
- Any stack traces

#### Method 2: Share Browser Console Errors

1. Open `test.html` in your browser
2. Open Developer Tools (F12 or Right-click → Inspect)
3. Go to Console tab
4. Try your action (send a message)
5. Copy any red error messages
6. Share them

**What to share:**
- Network errors (from Network tab)
- Console errors (from Console tab)
- Request/response details

#### Method 3: Share Request/Response Details

1. Open Developer Tools (F12)
2. Go to Network tab
3. Clear the network log (🚫 icon)
4. Send a test message from test.html
5. Click on the request to your worker
6. Share:
   - Request Payload (what was sent)
   - Response (what came back)
   - Status code

### Common Issues & Solutions

#### Issue: Search gets stuck
- **Check:** Backend logs for `handleDiscovery` execution
- **Fix:** Ensure `isAutoSearch` flag is set correctly

#### Issue: Wrong product selected
- **Check:** Frontend `selectProduct()` sends `packageId` correctly
- **Fix:** Verify `packageId` is in match object

#### Issue: Match lists disappear on edit
- **Check:** `editPackageSelection()` preserves `productMatches` and `queryMatches`
- **Fix:** Ensure these aren't cleared in edit logic

#### Issue: UI shows wrong step
- **Check:** `flowState.backendStep` matches `memory.step`
- **Fix:** Update `backendStep` in `handleResponse()`

#### Issue: "CORS error" or "Network error"
- Make sure your worker is deployed
- Check the Worker URL is correct
- The code already has CORS enabled, so this shouldn't happen

#### Issue: "Error: AI call failed"
- Check that your API keys are set in Cloudflare secrets
- Verify `SOVEREIGN_MODE` in `wrangler.toml` matches your API key
- Check Cloudflare Workers logs for detailed errors

#### Issue: No response / Timeout
- Check Cloudflare dashboard for worker status
- Look at the Metrics tab for errors
- Check the Observability logs for detailed error messages

#### Issue: API Errors (429, 401, etc.)
- Check your API key is valid
- Verify you have credits/quota available
- Check rate limits for your API tier

### Debugging Tips

- **Frontend logs**: `[handleResponse]`, `[selectProduct]`, `[editPackageSelection]`
- **Backend logs**: `[handlePackageSelection]`, `[handleDiscovery]`, `[handleDirectSalesFlow]`
- Check browser console and Cloudflare Workers logs
- Use "Reset Session" button to clear stale state
- Keep the test page open in one tab and Cloudflare dashboard in another
- Use browser DevTools → Network tab to see request/response details
- Check Cloudflare Observability → Logs for server-side debugging

---

## API Reference

### Main Endpoint

**POST /** - Main chat endpoint

**Request Body:**
```json
{
  "message": "I need custom boxes",
  "flow": "direct_sales",  // Optional: "direct_sales" | "launch_kit"
  "reset": false,          // Optional: Reset session
  "regenerateOrder": false // Optional: Regenerate draft order
}
```

**Response:**
```json
{
  "reply": "What type of packaging are you looking for?",
  "flowState": {
    "step": "product_details",
    "packageName": null,
    "variantName": null,
    "hasPackage": false,
    "hasVariant": false,
    "questionIndex": 0
  },
  "currentQuestion": {
    "id": "product_description",
    "question": "First, tell me about your product...",
    "options": null,
    "multiple": true,
    "defaultValue": null
  },
  "productMatches": [],  // Optional: Package search results
  "isAutoSearch": false, // Optional: Whether matches are from auto-search
  "draftOrder": {        // Optional: When order is created
    "id": "123456",
    "adminUrl": "https://...",
    "invoiceUrl": "https://..."
  }
}
```

### Flow Types

- **`direct_sales`**: Main sales consultation flow (5 steps)
- **`launch_kit`**: Launch Kit service ordering flow

### Direct Sales Flow Steps

1. **Product Details** - Collect product information (5 questions)
2. **Package Selection** - AI-powered package search with variant selection
3. **Package Specs** - Material and print preferences
4. **Fulfillment Specs** - Quantity, timeline, shipping address
5. **Launch Kit** - Optional brand launch services
6. **Draft Order** - Automatic Shopify draft order creation

### Launch Kit Flow Steps

1. **Start** - Present Launch Kit services
2. **Service Selection** - User selects services
3. **Consultation** - Collect project details
4. **Order Creation** - Create draft order

---

## Future Plans

### Short-term (Next Steps)

1. **Complete MVP Testing**
   - Test Launch Kit Flow end-to-end
   - Add flow selection to `test.html`
   - Test all flows through UI

2. **Production Deployment**
   - Final testing of Direct Sales Flow
   - Performance optimization
   - Error monitoring setup
   - Deploy to production

### Long-term (Future Enhancements)

1. **Multi-Channel Support**
   - Salla integration
   - Store connection system
   - Product-to-package mapping
   - Webhook handlers

2. **Advanced Features**
   - Intent detection (automatic flow selection)
   - Reorder functionality
   - Analytics dashboard
   - Multi-language improvements

3. **Council Integration** (The Studium)
   - The Warden: PII redaction
   - The Sentinel: Charter updates
   - The Adversary: Red-teaming

4. **Testing**
   - Unit tests for critical functions
   - Integration tests for session flow
   - E2E tests for full conversation

### Known Limitations

1. **Flow Support**: Only `direct_sales` and `launch_kit` flows are implemented
2. **Durable Object Storage**: State persists for 1 hour, then auto-resets
3. **LLM Costs**: Each search calls LLM (consider caching if needed)
4. **No Authentication**: Uses IP address for session ID

---

## Resources

- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Shopify Admin API**: https://shopify.dev/api/admin-rest
- **Gemini API Docs**: https://ai.google.dev/gemini-api/docs
- **OpenAI API Docs**: https://platform.openai.com/docs

---

## Contact & Support

- **Code Location**: GitHub repository
- **Deployment**: Cloudflare Workers
- **Frontend**: `test.html` (can be hosted anywhere)

---

## Salla Integration Setup

### OAuth Configuration

**IMPORTANT**: Before using Salla integration, you must register the redirect URI in your Salla app settings.

1. **Get your Redirect URI:**
   - Format: `https://YOUR-WORKER-URL.workers.dev/api/salla/callback`
   - Example: `https://packageha-ai.akhodary-006.workers.dev/api/salla/callback`

2. **Register in Salla Partners Portal:**
   - Go to: https://portal.salla.partners/apps/YOUR-APP-ID
   - Navigate to **OAuth Settings** or **Redirect URIs** section
   - Add the redirect URI (must match EXACTLY, including `https://` and no trailing slash)
   - **Note**: This is different from Webhook URL settings

3. **Set Environment Variables:**
   ```bash
   wrangler secret put SALLA_CLIENT_ID
   wrangler secret put SALLA_CLIENT_SECRET
   wrangler secret put SALLA_REDIRECT_URI
   ```

4. **Update `wrangler.toml`:**
   ```toml
   SALLA_REDIRECT_URI = "https://your-worker.workers.dev/api/salla/callback"
   ```

### Testing Salla Integration

- Use `sallaTest.html` for Salla merchant integration testing
- Use `test.html` for MVP Direct Sales Flow testing

---

**Last Updated**: 2026-01-02  
**Status**: ✅ Direct Sales Flow production-ready, Launch Kit Flow implemented (needs testing), Salla Integration ready (requires OAuth setup)
