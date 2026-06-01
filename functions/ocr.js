function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function stripDataUrl(value) {
  return String(value || "")
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .trim();
}

function normalizePlateInput(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeDigits(value) {
  return String(value || "")
    .replace(/O/g, "0")
    .replace(/Q/g, "0")
    .replace(/D/g, "0")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

function addCandidate(set, value) {
  const cleaned = normalizePlateInput(value);
  if (cleaned.length >= 2 && cleaned.length <= 10) set.add(cleaned);
}

function extractPlateCandidates(text) {
  const set = new Set();
  const upper = String(text || "").toUpperCase();
  const compact = normalizePlateInput(upper);
  const sources = [upper, compact];

  for (const source of sources) {
    const normalizedSource = source.replace(/[^A-Z0-9]/g, " ");
    const chunks = normalizedSource.match(/[A-Z0-9]{2,10}/g) || [];

    for (const chunk of chunks) {
      addCandidate(set, chunk);
    }

    const joined = chunks.join("");
    const patterns = [
      /([A-Z]{3})([0-9OQDSBIL]{4})/g,
      /([A-Z]{2})([0-9OQDSBIL]{4})/g,
      /([0-9OQDSBIL]{4})([A-Z]{3})/g,
      /([0-9OQDSBIL]{4})([A-Z]{2})/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(joined)) !== null) {
        if (/^[A-Z]/.test(match[1])) {
          addCandidate(set, `${match[1]}${normalizeDigits(match[2])}`);
        } else {
          addCandidate(set, `${normalizeDigits(match[1])}${match[2]}`);
        }
      }
    }
  }

  return Array.from(set).slice(0, 20);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const key = env?.GOOGLE_VISION_API_KEY;

    if (!key) {
      return jsonResponse({
        ok: false,
        error: "Missing GOOGLE_VISION_API_KEY Cloudflare secret"
      }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Request body must be JSON" }, 400);
    }

    const imageBase64 = stripDataUrl(payload?.imageBase64);

    if (!imageBase64) {
      return jsonResponse({ ok: false, error: "Missing imageBase64" }, 400);
    }

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 5 }],
            imageContext: { languageHints: ["en"] }
          }]
        })
      }
    );

    const data = await visionRes.json().catch(() => ({}));

    if (!visionRes.ok) {
      return jsonResponse({
        ok: false,
        error: data?.error?.message || `Vision API error ${visionRes.status}`
      }, 502);
    }

    const response = data?.responses?.[0] || {};
    const text =
      response?.fullTextAnnotation?.text ||
      response?.textAnnotations?.[0]?.description ||
      "";

    const candidates = extractPlateCandidates(text);

    return jsonResponse({ ok: true, text, candidates });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error?.message || error)
    }, 500);
  }
}
