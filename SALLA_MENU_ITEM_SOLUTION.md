# Solution: Adding Menu Item Based on Available Settings

Based on the settings you're seeing in Salla Partners Portal, here's the most practical approach:

## The Reality

The menu item "إعادة إرسال رمز الوصول للتطبيق" you see in other apps is **likely a system-generated action** that Salla provides automatically. Custom dropdown menu items might not be available through the UI in development mode.

## Best Solution: Add HTML Link in Description Field

Perfect! You can add HTML in the Description field. Here's how:

### Step 1: Edit the Description Field

1. In the "App Settings" builder, find the **"Description"** field
2. Click the edit icon (pencil) on the "Description" field
3. In the text area that says "Insert text or HTML..", paste this HTML:

### Step 2: Add HTML with Link/Button

**Option A: Simple Link (Recommended)**
```html
<p><a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="display: inline-block; padding: 12px 24px; background: #00d4aa; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">ابدأ تصميم أغلفة منتجاتك الآن</a></p>
```

**Option B: Button with Icon**
```html
<div style="text-align: center; margin: 20px 0;">
  <a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
    🎨 ابدأ التصميم الآن
  </a>
</div>
```

**Option C: Full Featured Card**
```html
<div style="background: #f8f9fa; border: 2px solid #00d4aa; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
  <h3 style="color: #333; margin-bottom: 10px;">تصميم أغلفة المنتجات</h3>
  <p style="color: #666; margin-bottom: 20px;">اصنع غلاف منتجك المخصص في دقائق</p>
  <a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="display: inline-block; padding: 12px 32px; background: #00d4aa; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
    ابدأ التصميم
  </a>
</div>
```

### Step 3: Save

1. Click **"Save"** at the bottom left
2. The HTML will be rendered in the app settings page

### Step 4: How Merchants Will See It

- Merchants go to: **My Apps → بكجها → Settings**
- They'll see a styled button/link in the description area
- Clicking it opens your design form in a new tab

## Alternative: Use Salla API

If you want to add it programmatically, use the Salla Admin API:

```bash
POST https://api.salla.dev/admin/v2/apps/357944659/settings
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "key": "design_form_link",
  "value": "https://packageha-ai.akhodary-006.workers.dev/app",
  "type": "url",
  "label": {
    "ar": "ابدأ التصميم",
    "en": "Start Designing"
  },
  "description": {
    "ar": "افتح نموذج التصميم لإنشاء أغلفة منتجاتك",
    "en": "Open design form to create your product packages"
  }
}
```

## Quick Test Solution

For immediate testing, you can:

1. **Share the direct URL** with merchants:
   ```
   https://packageha-ai.akhodary-006.workers.dev/
   ```

2. **Add to app description:**
   - Go to app overview
   - Add to description: "للبدء: https://packageha-ai.akhodary-006.workers.dev/app"

3. **Use App Snippets** (if you want it in the storefront):
   - Click "View Snippets"
   - Add HTML that creates a button linking to your form

## Why This Limitation?

Custom dropdown menu items are typically:
- Reserved for published apps
- Require specific app types
- May need Salla approval
- Or are system-generated only

The "Build your App settings" approach is the most practical way to add a link that merchants can access.

