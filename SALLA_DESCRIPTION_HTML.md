# Adding Link/Button in Salla App Description Field

## Quick Solution

In the "App Settings" builder, you can add HTML in the **Description** field to create a clickable link or button.

## Step-by-Step

1. **Open App Settings Builder:**
   - Go to: https://portal.salla.partners/apps/357944659/settings
   - You should see "Add Fields" on left, "App Settings" on right

2. **Edit Description Field:**
   - Find the "Description" field in the "App Settings" column (right side)
   - Click the edit icon (pencil) on the Description field
   - You'll see a text area with "Insert text or HTML.."

3. **Paste This HTML (Copy the entire block):**

**IMPORTANT:** Make sure to copy the ENTIRE HTML block below, including all the style attributes on one line:

```html
<div style="text-align: center; margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 12px;"><h3 style="color: #333; margin-bottom: 15px;">🎨 تصميم أغلفة المنتجات</h3><p style="color: #666; margin-bottom: 20px;">اصنع غلاف منتجك المخصص في دقائق بمساعدة الذكاء الاصطناعي</p><a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">ابدأ التصميم الآن</a></div>
```

**OR use this simpler version (if the above doesn't work):**

```html
<div style="text-align:center;padding:20px;background:#f8f9fa;border-radius:12px;"><h3 style="color:#333;margin-bottom:15px;">🎨 تصميم أغلفة المنتجات</h3><p style="color:#666;margin-bottom:20px;">اصنع غلاف منتجك المخصص في دقائق بمساعدة الذكاء الاصطناعي</p><a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="display:inline-block;padding:14px 32px;background:#00d4aa;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">ابدأ التصميم الآن</a></div>
```

4. **Save:**
   - Click "Save" button at the bottom left
   - The HTML will be rendered when merchants view the app settings

## Alternative: Simple Link

If you want something simpler:

```html
<p>للبدء في التصميم، <a href="https://packageha-ai.akhodary-006.workers.dev/app" target="_blank" style="color: #00d4aa; font-weight: 600;">اضغط هنا</a></p>
```

## What Merchants Will See

When merchants go to:
- **My Apps → بكجها → Settings**

They'll see:
- A styled card/box with your description
- A prominent button labeled "ابدأ التصميم الآن"
- Clicking the button opens your design form in a new tab

## Testing

1. Save the HTML in the Description field
2. Go to your Salla store (as merchant)
3. Navigate to: My Apps → بكجها → Settings
4. You should see the button/link
5. Click it to test

## Notes

- `target="_blank"` opens the link in a new tab
- The HTML is rendered as-is, so you can style it however you want
- Make sure the URL is correct: `https://packageha-ai.akhodary-006.workers.dev/app`

