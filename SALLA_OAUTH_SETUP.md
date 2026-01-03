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

## Publishing Your App for Production

If you're getting an error that the app "is not available" or "could not find the app" when connecting to a real store, your app is likely in **development mode** and needs to be published.

### Steps to Publish Your App:

1. **Go to Salla Partners Portal:**
   - Navigate to: https://portal.salla.partners/apps/357944659
   - Or go to "My Apps" → Select your app

2. **Start Publishing Process:**
   - Look for a button like **"Start Publishing your App"** or **"Publish App"**
   - This is usually in the app's main settings or overview page

3. **Complete Publishing Requirements:**
   - Provide app information (name, description, logo)
   - Configure app features and capabilities
   - Set pricing (if applicable)
   - Add contact details and support information
   - Submit for Salla review

4. **Wait for Approval:**
   - Salla will review your app
   - Once approved, it will be available in the Salla App Store
   - Real stores will be able to install and use your app

### Alternative: Test with Demo Store

While waiting for approval, you can:
- Use Salla's demo/test stores for development
- Test the OAuth flow with test accounts
- Continue development without publishing

### Important Notes:

- **Development Mode**: Apps in development are only accessible to the developer
- **Production Mode**: Published apps are available to all Salla merchants
- **OAuth Mode**: Make sure you're using "Custom Mode" (not "Easy Mode") for OAuth redirect flow
- **Redirect URI**: Must be registered before publishing

## How Merchants Access the Form

For testing in development mode, merchants can access the form in two ways:

### Option 1: Direct URL (Recommended)
Share this URL with merchants:
```
https://packageha-ai.akhodary-006.workers.dev/
```
or
```
https://packageha-ai.akhodary-006.workers.dev/sallaTest.html
```

The root URL (`/`) shows a friendly Arabic landing page that explains the service and links to the form.

### Option 2: From Salla App (When Published)
Once your app is published, merchants can:
1. Go to Salla App Store
2. Find and install "بكجها" (Packageha)
3. Open the app from their Salla dashboard
4. The app will redirect them to the design form

### For Development Testing:
1. Share the URL: `https://packageha-ai.akhodary-006.workers.dev/`
2. Merchant clicks "ابدأ التصميم الآن" (Start Designing Now)
3. They connect their Salla store
4. They select a product, upload image, or enter description
5. The package design flow begins

## Need Help?

If you still can't find where to register redirect URIs:
- Check Salla Partners documentation
- Contact Salla support
- Consider switching from "Easy Mode" to standard OAuth flow

