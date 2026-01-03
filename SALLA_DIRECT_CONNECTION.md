# Direct Connection: Skip OAuth for Installed Apps

## The Problem

When a merchant installs your app in Salla, they shouldn't need to go through OAuth again. The app is already installed and authorized.

## Solution: Use App Installation Context

When Salla opens your app (via the App Page URL), it provides the merchant's context automatically. We need to:

1. **Handle webhook for app installation** - Store access token when app is installed
2. **Check for access token in app context** - When merchant opens app, Salla may pass token in headers
3. **Skip OAuth if already connected** - If we have a valid token, use it directly

## Implementation

### 1. Webhook Handler (for Easy Mode OAuth)

When app is installed, Salla sends `app.store.authorize` webhook event with access token.

**Webhook URL:** `https://packageha-ai.akhodary-006.workers.dev/api/salla/webhook`

**Configure in Salla:**
- Go to Salla Partners Portal → Your App → Webhooks/Notifications
- Add webhook URL: `https://packageha-ai.akhodary-006.workers.dev/api/salla/webhook`
- Enable "Store Events" → "app.store.authorize"

### 2. App Page Endpoint

The `/app` endpoint now checks for:
- Access token in query params
- Access token in headers (X-Salla-Access-Token)
- Store ID in headers (X-Salla-Store-Id)

If found, it passes them to the frontend with `connected=true` flag.

### 3. Frontend Updates

The frontend now:
- Checks for `connected=true` parameter
- If present, skips showing the "Connect Salla Store" button
- Uses the access token directly

## Testing

### Test Direct Connection:

1. **Install app in Salla store**
2. **Click app from Salla dashboard**
3. **Should open directly** without asking to connect

### Test OAuth Fallback:

1. **Open app directly** (not from Salla)
2. **Should show "Connect Salla Store" button**
3. **Click to connect via OAuth**

## Current Status

✅ Webhook handler added (`/api/salla/webhook`)
✅ App page checks for access token in headers
✅ Frontend skips OAuth if already connected

## Next Steps

1. **Configure webhook in Salla:**
   - Add webhook URL in Salla Partners Portal
   - Enable `app.store.authorize` event

2. **Test with real store:**
   - Install app
   - Open from Salla dashboard
   - Should connect automatically

3. **Store tokens properly:**
   - Currently tokens are passed via URL (not secure for production)
   - Consider using Cloudflare KV or D1 to store tokens per store ID
   - Or use encrypted cookies/sessions

## Security Note

For production, you should:
- Store access tokens securely (not in URL params)
- Use encrypted storage (Cloudflare KV with encryption)
- Implement token refresh logic
- Validate webhook signatures from Salla

