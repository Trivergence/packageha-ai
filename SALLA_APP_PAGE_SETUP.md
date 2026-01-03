# How to Add a Custom Menu Item in Salla App Interface

To add a custom menu item (like "إعادة إرسال رمز الوصول للتطبيق") that appears in the dropdown menu when merchants view your app, you need to configure **Custom Actions** or **App Menu Items** in your Salla Partners Portal app settings.

## Step 1: Add Custom Menu Item in Salla Partners Portal

1. **Go to Salla Partners Portal:**
   - Navigate to: https://portal.salla.partners/apps/357944659
   - Make sure you're logged in as the app developer

2. **Find App Configuration/Settings:**
   - Look for tabs/sections like:
     - "App Settings" or "إعدادات التطبيق"
     - "Configuration" or "التكوين"
     - "App Details" or "تفاصيل التطبيق"
     - "Advanced Settings" or "الإعدادات المتقدمة"

3. **Look for Custom Actions/Menu Items:**
   - Search for sections like:
     - "Custom Actions" or "إجراءات مخصصة"
     - "Menu Items" or "عناصر القائمة"
     - "Dashboard Links" or "روابط لوحة التحكم"
     - "App Extensions" or "امتدادات التطبيق"
     - "Merchant Actions" or "إجراءات التاجر"

4. **Add New Menu Item:**
   - Click "Add New" or "إضافة جديد"
   - Fill in the details:
     - **Title (Arabic)**: "ابدأ التصميم" or "فتح نموذج التصميم"
     - **Title (English)**: "Start Designing" or "Open Design Form"
     - **URL**: `https://packageha-ai.akhodary-006.workers.dev/app`
     - **Icon**: Choose an appropriate icon (design/pencil icon)
     - **Position**: Set where it appears (dropdown menu, main page, etc.)

5. **Save Settings**

## Step 2: Where to Find These Settings

Based on the Salla Partners Portal interface you're seeing:

1. **From the App Details Page:**
   - You're currently on: `s.salla.sa/apps/installed/e-1674758140`
   - Look for a dropdown menu next to "الدعم" (Support)
   - Or look for tabs like "Settings" or "إعدادات" at the top

2. **Navigate to App Settings:**
   - Click on "Settings" or "الإعدادات" tab (if available)
   - Or go back to: https://portal.salla.partners/apps/357944659
   - Look for "App Configuration" or "App Settings" section

3. **Check These Specific Sections:**
   - **"App Manifest"** or **"App Configuration"** - might have custom actions
   - **"OAuth Settings"** - might have app page URL
   - **"App Extensions"** - for custom menu items
   - **"Merchant Interface"** - for merchant-facing options

## Alternative: If Custom Menu Items Not Available

If you can't find the custom menu items option (common in development mode), try these alternatives:

## Step 3: How It Works

When a merchant clicks on your app in Salla:
1. Salla redirects them to: `https://packageha-ai.akhodary-006.workers.dev/app`
2. Our endpoint checks for access token (if merchant is already authenticated)
3. Redirects to: `https://packageha-ai.akhodary-006.workers.dev/sallaTest.html`
4. Merchant can start designing immediately

### Option A: Use App Page URL (Main Entry Point)

1. **Find "App Page URL" or "صفحة التطبيق":**
   - In app settings, look for "App Page URL" field
   - Enter: `https://packageha-ai.akhodary-006.workers.dev/app`
   - This makes the entire app clickable and redirects to your form

### Option B: Add to App Description

1. **Update App Description:**
   - Go to app settings → "App Details" or "تفاصيل التطبيق"
   - Add this to the description:
     ```
     للبدء في التصميم، قم بزيارة: https://packageha-ai.akhodary-006.workers.dev/app
     ```
   - Merchants will see this link in the app description

### Option C: Use Support/Help URL

1. **Set Support URL:**
   - Look for "Support URL" or "رابط الدعم"
   - Enter: `https://packageha-ai.akhodary-006.workers.dev/app`
   - This might appear as a support/help link

### Option D: Contact Salla Support

If none of the above options are available in development mode:
1. Contact Salla support and ask:
   - "How do I add custom menu items/actions to my app?"
   - "Where can I configure merchant-facing app actions?"
   - "Can I add a custom link in the app dropdown menu?"
2. They may need to enable this feature for your app or provide specific instructions

## Testing

1. After configuring, go to your Salla store
2. Navigate to "My Apps" → "بكجها"
3. Click on the app
4. It should redirect to the design form

## URLs Available

- **Landing Page**: `https://packageha-ai.akhodary-006.workers.dev/`
- **Design Form**: `https://packageha-ai.akhodary-006.workers.dev/sallaTest.html`
- **App Page (for Salla)**: `https://packageha-ai.akhodary-006.workers.dev/app`

The `/app` endpoint automatically redirects to the design form and handles OAuth tokens if present.

