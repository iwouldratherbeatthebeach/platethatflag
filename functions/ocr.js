export async function onRequestPost(context) {
  try {
    const { request } = context;
    const { imageBase64 } = await request.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ ok: false, error: "Missing imageBase64" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const VISION_KEY = "AIzaSyCQrt4ae0Sa7Fm7DH34i3fF-7DMJvtR8_A";

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }]
          }]
        })
      }
    );

    if (!visionRes.ok) {
      const err = await visionRes.json().catch(() => ({}));
      return new Response(JSON.stringify({
        ok: false,
        error: err?.error?.message || `Vision API error ${visionRes.status}`
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    const data = await visionRes.json();
    const text = data?.responses?.[0]?.fullTextAnnotation?.text || "";

    return new Response(JSON.stringify({ ok: true, text }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
