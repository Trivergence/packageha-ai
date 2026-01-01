# Gemini API Fix - Model Name Update

## Issue
Gemini API was returning 404 error because `gemini-1.5-flash-latest` model is not available or has been retired.

## Fix Applied ✅
Changed model name to `gemini-pro` which is:
- ✅ Stable and reliable
- ✅ Supported by v1beta API
- ✅ Available for generateContent method
- ✅ Good quality for MVP use

## Changes Made
- Updated `src/sovereign-switch.ts` to use `gemini-pro` instead of `gemini-1.5-flash-latest`
- Updated `wrangler.toml` documentation

## Next Steps
1. **Redeploy:**
   ```bash
   wrangler deploy
   ```

2. **Test again** - The error should be resolved!

## Note
If you want to use a different Gemini model in the future, check the [Gemini API documentation](https://ai.google.dev/gemini-api/docs/models) for currently available models. Common options:
- `gemini-pro` (stable, what we're using now)
- `gemini-1.5-pro` (if available)
- Other models as they become available

