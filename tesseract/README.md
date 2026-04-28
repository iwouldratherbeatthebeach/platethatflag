# Tesseract.js Assets

These files must be downloaded and committed here so OCR works without CDN dependency.

Run this from the repo root:

```bash
cd tesseract

# 1. Worker script (~100KB)
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js" -o worker.min.js

# 2. WASM core — SIMD+LSTM (modern browsers, ~3MB)
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js" -o tesseract-core-simd-lstm.wasm.js

# 3. WASM core — non-SIMD fallback (~3MB)
curl -L "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js" -o tesseract-core-lstm.wasm.js

# 4. English language data (~10MB, gzipped)
curl -L "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" -o eng.traineddata.gz
```

After downloading, commit all four files to git.
Cloudflare Pages will serve them from /tesseract/*.
