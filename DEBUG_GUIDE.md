# Debugging Guide - How to Share Errors for AI Debugging

## Quick Fix Applied ✨

I've just fixed the Gemini API issue you encountered:
- Changed model name from `gemini-1.5-flash` to `gemini-1.5-flash-latest`
- This should resolve the 404 error you saw in the logs

**Please redeploy** and test again!

---

## How to Share Errors for Debugging

### Method 1: Share Cloudflare Logs (Easiest)

1. **Open Cloudflare Dashboard** → Your Worker → **Observability** → **Logs**
2. **Find the error log** (the red one with error details)
3. **Copy the error message** (click on it to expand)
4. **Paste it here** - I can read and fix it!

**What to share:**
- The error message text (e.g., `Error: Gemini API error: 404...`)
- The timestamp if relevant
- Any stack traces

**Example format:**
```
Error: [SovereignSwitch] Error in gemini: Error: Gemini API error: 404 - { "error": { "code": 404, "message": "..." } }
```

---

### Method 2: Share Browser Console Errors

1. **Open test.html** in your browser
2. **Open Developer Tools** (F12 or Right-click → Inspect)
3. **Go to Console tab**
4. **Try your action** (send a message)
5. **Copy any red error messages**
6. **Paste them here**

**What to share:**
- Network errors (from Network tab)
- Console errors (from Console tab)
- The request/response details

---

### Method 3: Share Request/Response Details

1. **Open Developer Tools** (F12)
2. **Go to Network tab**
3. **Clear the network log** (🚫 icon)
4. **Send a test message** from test.html
5. **Click on the request** to your worker
6. **Share:**
   - Request Payload (what was sent)
   - Response (what came back)
   - Status code

**Screenshot or copy-paste:**
- Request: `{"message":"...", "flow":"..."}`
- Response: `{"reply":"..."}` or error details
- Status: `200 OK` or error code

---

### Method 4: Share Code Context

If you want me to look at specific code:

1. **Tell me which file** (e.g., `src/session.ts`)
2. **Tell me what function/method** (e.g., `handlePackageOrderFlow`)
3. **Describe the issue** (e.g., "it's not responding correctly")
4. **Share the relevant code section** (if you want, but I can read the files)

---

### Method 5: Create Test Cases

Create a simple test script and share the output:

```javascript
// In browser console on test.html page
async function testAll() {
    console.log('Testing Package Order...');
    const r1 = await fetch('https://packageha-ai.akhodary-006.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'boxes', flow: 'package_order' })
    });
    console.log('Response:', await r1.json());
    
    // Test other flows...
}
testAll();
```

Then share the console output.

---

## What I Can Do With Error Info

When you share errors, I can:
- ✅ **Fix the code** directly
- ✅ **Update configurations** (wrangler.toml, etc.)
- ✅ **Adjust API calls** (fix endpoints, parameters)
- ✅ **Update type definitions** if needed
- ✅ **Add better error handling**
- ✅ **Create debugging utilities**

---

## Current Error You Encountered

**Error:** `Gemini API error: 404 - models/gemini-1.5-flash is not found`

**Root Cause:** Wrong model name - Gemini API requires `-latest` suffix or specific version

**Fix Applied:** ✅ Changed to `gemini-1.5-flash-latest`

**Action Needed:** Redeploy your worker:
```bash
wrangler deploy
```

Then test again!

---

## Pro Tips for Efficient Debugging

1. **Start with the error message** - That's usually enough
2. **Include context** - Which flow? What action triggered it?
3. **Share logs** - Cloudflare logs are super helpful
4. **Test incrementally** - One flow at a time
5. **Clear and redeploy** - Sometimes cache issues occur

---

## Example Debugging Workflow

```
1. You: "I got this error: [paste error]"
2. Me: "Fixed! [shows what I changed]"
3. You: Redeploy and test
4. You: "Works!" or "Still error: [new error]"
5. Me: Fix again...
```

---

## Automated Debugging (Future)

For even better debugging, I can create:
- ✅ Error logging utilities
- ✅ Test scripts that run automatically
- ✅ Health check endpoints
- ✅ Debug mode with verbose logging

Let me know if you want any of these!

---

**For now: Please redeploy with the Gemini fix and test again!** 🚀

