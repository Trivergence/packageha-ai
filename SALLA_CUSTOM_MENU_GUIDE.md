# How to Add Custom Menu Item in Salla App (Like "إعادة إرسال رمز الوصول")

## The Problem

You want to add a custom menu item in the dropdown menu (like "إعادة إرسال رمز الوصول للتطبيق") that appears when merchants click on your app in Salla.

## Solution: Based on Available Settings

Based on the settings you're seeing, here's where to look:

### Step 1: Check "Build your App settings" (Most Likely)

1. **Click "App Settings" button** in the "Build your App settings" section
2. This opens the settings builder where you can:
   - Add custom fields for your app
   - Configure merchant-facing settings
   - Potentially add custom actions/links

3. **Look for:**
   - "Custom Actions" or "إجراءات مخصصة"
   - "App Links" or "روابط التطبيق"
   - "Menu Items" or "عناصر القائمة"
   - Or any option to add external URLs/links

### Step 2: Alternative - Use Salla API

If the UI doesn't have the option, you can use the Salla API to add custom settings:

**API Endpoint:**
```
POST https://api.salla.dev/admin/v2/apps/357944659/settings
```

**Headers:**
```
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "key": "design_form_url",
  "value": "https://packageha-ai.akhodary-006.workers.dev/app",
  "type": "url",
  "label": {
    "ar": "ابدأ التصميم",
    "en": "Start Designing"
  }
}
```

**Note:** This requires an access token from OAuth. You'd need to implement this in your backend.

### Step 3: Check Other Sections

While checking "Build your App settings", also look at:

- **App Functions** - For custom logic, but might have UI hooks
- **App Snippets** - Injects HTML into stores (not for menu items)
- **Settings Validation URL** - For validating settings, not for menu items

### Step 3: Add the Menu Item

If you find the configuration section, add:

```json
{
  "menuItems": [
    {
      "title": {
        "ar": "ابدأ التصميم",
        "en": "Start Designing"
      },
      "url": "https://packageha-ai.akhodary-006.workers.dev/app",
      "icon": "design",
      "position": "dropdown"
    }
  ]
}
```

Or fill in a form with:
- **Title (Arabic)**: "ابدأ التصميم"
- **Title (English)**: "Start Designing"  
- **URL**: `https://packageha-ai.akhodary-006.workers.dev/app`
- **Icon**: Choose design/pencil icon
- **Location**: Dropdown menu

## Important Finding

**The menu item "إعادة إرسال رمز الوصول للتطبيق" you see in other apps is likely a system-generated action**, not something developers can easily add through the UI. Custom merchant-facing menu items might require:

1. **App Publishing** - Some features are only available after publishing
2. **API Integration** - Using Salla's API to add custom settings
3. **App Type** - Different app types have different capabilities

## Workarounds for Testing

### Workaround 1: Use App Settings Builder

1. Click **"App Settings"** in the "Build your App settings" section
2. Add a custom field with type "URL" or "Link"
3. Set the URL to: `https://packageha-ai.akhodary-006.workers.dev/app`
4. This will appear in the app's settings page (not dropdown menu)

### Workaround 2: Add to App Description

1. Go to app overview/details page
2. Update the app description to include:
   ```
   للبدء في التصميم: https://packageha-ai.akhodary-006.workers.dev/app
   ```

### Workaround 3: Use App Snippets (For Store Frontend)

1. Click **"View Snippets"** in the "App Snippets" section
2. Add HTML/JavaScript that creates a button/link
3. This appears in the merchant's storefront (not in the app menu)

### Workaround 4: Contact Salla Support

Contact Salla support and ask:

**In Arabic:**
```
كيف يمكنني إضافة عنصر قائمة مخصص في تطبيقي يظهر في القائمة المنسدلة عند عرض التطبيق؟
```

**In English:**
```
How can I add a custom menu item in my app that appears in the dropdown menu when viewing the app?
```

They may:
- Enable this feature for your app
- Provide specific instructions for your app type
- Tell you it's only available after publishing

## What We've Prepared

The `/app` endpoint is ready at:
- URL: `https://packageha-ai.akhodary-006.workers.dev/app`
- It redirects to the design form
- It handles OAuth tokens if present

Once you configure the menu item in Salla, merchants will see it in the dropdown menu.

## Testing

After adding the menu item:
1. Go to your Salla store (as merchant)
2. Navigate to "My Apps" → "بكجها"
3. Click the dropdown menu (three dots or arrow)
4. You should see "ابدأ التصميم" or "Start Designing"
5. Clicking it opens the design form

