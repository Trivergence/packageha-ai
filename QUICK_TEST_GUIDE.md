# Quick Test Guide

## Easiest Way to Test: Browser Test Page 🚀

I've created a simple HTML test page that you can open directly in your browser to test all flows!

### Step 1: Open the Test Page

1. Open the file `test.html` in your browser
   - Double-click it, or
   - Right-click → "Open with" → Your browser
   - Or drag it into your browser window

### Step 2: Configure (if needed)

The test page is pre-configured with your worker URL:
- **Worker URL**: `https://packageha-ai.akhodary-006.workers.dev`

If your URL is different, just update it in the input field.

### Step 3: Test Each Flow

#### 🛒 Package Ordering Flow
1. Click "Package Order" button
2. Type: `I want to order packages` or `boxes`
3. Follow the conversation:
   - Select a package
   - Provide quantity
   - Add notes (optional)
   - Get order link!

#### 🚀 Launch Kit Flow
1. Click "Launch Kit" button
2. Type: `I need Launch Kit services`
3. Follow the conversation:
   - Select services (Photography, Design, Consultation)
   - Provide project details
   - Get order link!

#### 💡 Packaging Assistant Flow
1. Click "Packaging Assistant" button
2. Type: `Help me choose a package` or `I need packaging for my product`
3. Follow the conversation:
   - Answer questions about your product
   - Get AI recommendations
   - Optionally order a recommended package!

#### 📦 Direct Sales Flow (Original)
1. Click "Direct Sales" button
2. Type: `I need custom boxes`
3. Follow the original flow

### Step 4: Reset Between Tests

Click the "Reset" button to start a fresh conversation, or type "reset" in the message box.

---

## Alternative: Using Browser DevTools Console

If you prefer using the browser console:

1. Open your browser's Developer Tools (F12)
2. Go to the Console tab
3. Paste this code:

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

// Test Package Order
testFlow('package_order', 'I want to order packages');

// Test Launch Kit
testFlow('launch_kit', 'I need Launch Kit services');

// Test Packaging Assistant
testFlow('packaging_assistant', 'Help me choose a package');
```

---

## Alternative: Using curl (Terminal/Command Prompt)

### Windows (PowerShell):
```powershell
# Test Package Order
Invoke-RestMethod -Uri "https://packageha-ai.akhodary-006.workers.dev" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"I want to order packages","flow":"package_order"}'

# Test Launch Kit
Invoke-RestMethod -Uri "https://packageha-ai.akhodary-006.workers.dev" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"I need Launch Kit services","flow":"launch_kit"}'

# Test Packaging Assistant
Invoke-RestMethod -Uri "https://packageha-ai.akhodary-006.workers.dev" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"Help me choose a package","flow":"packaging_assistant"}'
```

### Mac/Linux (Terminal):
```bash
# Test Package Order
curl -X POST https://packageha-ai.akhodary-006.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"I want to order packages","flow":"package_order"}'

# Test Launch Kit
curl -X POST https://packageha-ai.akhodary-006.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"I need Launch Kit services","flow":"launch_kit"}'

# Test Packaging Assistant
curl -X POST https://packageha-ai.akhodary-006.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"Help me choose a package","flow":"packaging_assistant"}'
```

---

## Test Scenarios

### Package Ordering Flow
1. Start: "I want to order packages"
2. Search: "boxes" or "custom boxes"
3. Select variant (if multiple)
4. Provide quantity: "500"
5. Add notes: "Need blue color" or "none"
6. Get order link!

### Launch Kit Flow
1. Start: "I need Launch Kit"
2. Select services: "Product Photography and Package Design"
3. Product info: "I'm launching a new perfume product"
4. Timeline: "Within 2 weeks"
5. Budget: "Around 5000 SAR"
6. Notes: "Need professional photos"
7. Get order link!

### Packaging Assistant Flow
1. Start: "Help me choose a package"
2. Product description: "It's a premium perfume bottle"
3. Dimensions: "10cm x 5cm x 15cm"
4. Weight: "200 grams"
5. Fragility: "Yes, it's glass"
6. Brand requirements: "Elegant design, gold accents"
7. Budget: "10 SAR per unit"
8. Quantity: "1000 units"
9. Get recommendations!
10. Order one: "1" or "yes"

---

## Troubleshooting

### "CORS error" or "Network error"
- Make sure your worker is deployed
- Check the Worker URL is correct
- The code already has CORS enabled, so this shouldn't happen

### "Error: AI call failed"
- Check that your API keys are set in Cloudflare secrets
- Verify `SOVEREIGN_MODE` in `wrangler.toml` matches your API key
- Check Cloudflare Workers logs for detailed errors

### No response / Timeout
- Check Cloudflare dashboard for worker status
- Look at the Metrics tab for errors
- Check the Observability logs for detailed error messages

### Responses seem off / wrong flow
- Make sure you're clicking the correct flow button
- Try resetting the conversation
- Check that the `flow` parameter is being sent (look at Network tab in DevTools)

---

## Recommended Testing Order

1. ✅ **Test Direct Sales** (verify existing flow still works)
2. ✅ **Test Package Order** (simplest new flow)
3. ✅ **Test Launch Kit** (service selection flow)
4. ✅ **Test Packaging Assistant** (most complex, AI recommendations)

---

## Pro Tips

- Keep the test page open in one tab and Cloudflare dashboard in another
- Use browser DevTools → Network tab to see request/response details
- Check Cloudflare Observability → Logs for server-side debugging
- Each flow maintains its own conversation state (reset between tests)

Happy testing! 🎉

