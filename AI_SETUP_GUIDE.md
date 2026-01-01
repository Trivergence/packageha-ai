# AI Upgrade Setup Guide

## Overview

The Packageha AI system now supports three commercial AI providers:
1. **Cloudflare AI** (Legacy - small models, free)
2. **OpenAI (ChatGPT)** - GPT-4o-mini or GPT-4o
3. **Google Gemini** - Gemini 1.5 Flash (Recommended for MVP)

## Recommendation: Use Gemini Flash 1.5

**Why Gemini Flash 1.5?**
- ✅ **Better JSON generation** - Critical for structured responses
- ✅ **Faster responses** - Lower latency
- ✅ **Cost-effective** - Cheaper than GPT-4o
- ✅ **Excellent for conversations** - Natural language understanding
- ✅ **Free tier available** - Google AI Studio offers free credits

## Setup Instructions

### Option 1: Gemini (Recommended)

1. **Get API Key**:
   - Go to https://aistudio.google.com/app/apikey
   - Sign in with your Google account
   - Click "Create API Key"
   - Copy the API key

2. **Set API Key** (Cloudflare Workers):
   ```bash
   wrangler secret put GEMINI_API_KEY
   # Paste your API key when prompted
   ```

3. **Update Configuration**:
   - In `wrangler.toml`, set:
     ```toml
     SOVEREIGN_MODE = "COMMERCIAL_GEMINI"
     ```

4. **Deploy**:
   ```bash
   wrangler deploy
   ```

### Option 2: OpenAI (ChatGPT)

1. **Get API Key**:
   - Go to https://platform.openai.com/api-keys
   - Sign in to your OpenAI account
   - Click "Create new secret key"
   - Copy the API key (starts with `sk-`)

2. **Set API Key** (Cloudflare Workers):
   ```bash
   wrangler secret put OPENAI_API_KEY
   # Paste your API key when prompted
   ```

3. **Update Configuration**:
   - In `wrangler.toml`, set:
     ```toml
     SOVEREIGN_MODE = "COMMERCIAL_OPENAI"
     ```
   - Optionally modify model in `sovereign-switch.ts`:
     - `gpt-4o-mini` (default - cost-effective)
     - `gpt-4o` (best quality, more expensive)

4. **Deploy**:
   ```bash
   wrangler deploy
   ```

### Option 3: Keep Cloudflare AI (Legacy)

If you want to keep using Cloudflare AI (free but limited quality):

1. **Update Configuration**:
   - In `wrangler.toml`, set:
     ```toml
     SOVEREIGN_MODE = "COMMERCIAL"
     ```

2. **Deploy**:
   ```bash
   wrangler deploy
   ```

## Model Comparison

| Provider | Model | Quality | Speed | Cost | Best For |
|----------|-------|---------|-------|------|----------|
| Cloudflare AI | Llama 3.1 8B | ⭐⭐ | ⚡⚡⚡ | Free | Testing, prototypes |
| OpenAI | GPT-4o-mini | ⭐⭐⭐⭐ | ⚡⚡⚡ | Low | General use, balanced |
| OpenAI | GPT-4o | ⭐⭐⭐⭐⭐ | ⚡⚡ | Medium | Best quality |
| Gemini | Gemini 1.5 Flash | ⭐⭐⭐⭐ | ⚡⚡⚡ | Very Low | **MVP (Recommended)** |
| Gemini | Gemini 1.5 Pro | ⭐⭐⭐⭐⭐ | ⚡ | Medium | Complex reasoning |

## Testing

After setup, test the AI upgrade:

1. **Start local dev server**:
   ```bash
   wrangler dev
   ```

2. **Send a test request**:
   ```bash
   curl -X POST http://localhost:8787 \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello, I need help with packaging"}'
   ```

3. **Check logs**:
   - Watch the console for AI responses
   - Compare quality with previous Cloudflare AI responses

## Troubleshooting

### Error: "GEMINI_API_KEY is required"
- Make sure you've set the secret: `wrangler secret put GEMINI_API_KEY`
- Verify `SOVEREIGN_MODE = "COMMERCIAL_GEMINI"` in `wrangler.toml`

### Error: "OPENAI_API_KEY is required"
- Make sure you've set the secret: `wrangler secret put OPENAI_API_KEY`
- Verify `SOVEREIGN_MODE = "COMMERCIAL_OPENAI"` in `wrangler.toml`

### API Errors (429, 401, etc.)
- Check your API key is valid
- Verify you have credits/quota available
- Check rate limits for your API tier

### Fallback Behavior
- If API key is missing, system falls back to Cloudflare AI
- Check logs for fallback messages

## Cost Estimates

### Gemini Flash 1.5
- **Input**: ~$0.075 per 1M tokens
- **Output**: ~$0.30 per 1M tokens
- **Typical conversation**: ~500 tokens per message
- **Estimated cost**: ~$0.0002 per conversation

### OpenAI GPT-4o-mini
- **Input**: ~$0.15 per 1M tokens
- **Output**: ~$0.60 per 1M tokens
- **Typical conversation**: ~500 tokens per message
- **Estimated cost**: ~$0.0004 per conversation

### OpenAI GPT-4o
- **Input**: ~$2.50 per 1M tokens
- **Output**: ~$10.00 per 1M tokens
- **Typical conversation**: ~500 tokens per message
- **Estimated cost**: ~$0.006 per conversation

**Recommendation**: Start with Gemini Flash 1.5 for MVP - excellent quality at lowest cost.

## Next Steps

After AI upgrade is working:
1. Test with existing flows (discovery, variant selection, consultation)
2. Compare response quality
3. Proceed with MVP flow implementation


