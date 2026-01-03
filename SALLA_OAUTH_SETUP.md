# Salla OAuth Setup Guide

## The Problem

You're getting this error:
```
The 'redirect_uri' parameter does not match any of the .OAuth 2.0 Client's pre-registered redirect urls
```

This means the redirect URI in your OAuth request doesn't match what's registered in your Salla app.

## Solution: Register Redirect URI in Salla

### Step 1: Find Your Redirect URI

Your redirect URI should be:
```
https://packageha-ai.akhodary-006.workers.dev/api/salla/callback
```

(Replace with your actual worker URL if different)

### Step 2: Register in Salla Partners Portal

**IMPORTANT**: The redirect URI must be registered in **OAuth Settings**, NOT in Webhooks.

1. Go to: https://portal.salla.partners/apps/357944659
2. Look for one of these sections:
   - **"OAuth Settings"** or **"OAuth Configuration"**
   - **"Redirect URIs"** or **"Authorized Redirect URIs"**
   - **"OAuth 2.0 Client Settings"**

3. Add your redirect URI:
   - Must be EXACT: `https://packageha-ai.akhodary-006.workers.dev/api/salla/callback`
   - Must include `https://`
   - Must NOT have a trailing slash
   - Case-sensitive

4. Save the settings

### Step 3: If You Can't Find OAuth Redirect URI Settings

If your app is in **"Easy Mode"** (as shown in your app settings), you might need to:

1. **Switch to Standard Mode** (if available):
   - Look for "OAuth Mode" settings
   - Change from "Easy Mode" to "Standard Mode" or "Redirect Mode"
   - This will show redirect URI fields

2. **Or Contact Salla Support**:
   - Ask where to register OAuth redirect URIs
   - They may need to enable it for your app

### Step 4: Verify Configuration

After registering, test again. The redirect URI must match EXACTLY:
- ✅ `https://packageha-ai.akhodary-006.workers.dev/api/salla/callback`
- ❌ `http://packageha-ai.akhodary-006.workers.dev/api/salla/callback` (wrong protocol)
- ❌ `https://packageha-ai.akhodary-006.workers.dev/api/salla/callback/` (trailing slash)
- ❌ `https://PACKAGEHA-AI.akhodary-006.workers.dev/api/salla/callback` (wrong case)

## Alternative: Use Webhook-Based Authorization (Easy Mode)

If you're using "Easy Mode" OAuth, Salla sends the access token via webhook instead of redirect. You would need to:

1. Set up a webhook endpoint to receive `app.store.authorize` events
2. Extract the access token from the webhook payload
3. Store it for use in API calls

This requires a different implementation approach.

## Troubleshooting

### Still Getting Error?

1. **Check the exact redirect URI being sent:**
   - Open browser console (F12)
   - Look for `[connectSalla] Redirect URI:` log
   - Copy that exact value

2. **Verify in Salla Portal:**
   - Check what redirect URIs are currently registered
   - Make sure yours matches EXACTLY

3. **Check for typos:**
   - Protocol: `https://` not `http://`
   - Domain: exact match including subdomain
   - Path: `/api/salla/callback` (no trailing slash)
   - No extra spaces or characters

4. **Clear browser cache** and try again

## Need Help?

If you still can't find where to register redirect URIs:
- Check Salla Partners documentation
- Contact Salla support
- Consider switching from "Easy Mode" to standard OAuth flow

