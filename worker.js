export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = url.origin;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "World of Wonders AI Video Studio", providerConfigured: Boolean(env.MAGIC_HOUR_API_KEY) });
      }
      if (!env.MAGIC_HOUR_API_KEY) return json({ error: "Video generation is not configured yet. Add the MAGIC_HOUR_API_KEY secret in Cloudflare." }, 503);

      if (url.pathname === "/api/video" && request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("multipart/form-data")) return json({ error: "Upload an image and prompt using the studio form." }, 400);
        const form = await request.formData();
        const file = form.get("image");
        const prompt = String(form.get("prompt") || "").trim();
        const seconds = Number(form.get("duration") || 5);
        if (!(file instanceof File)) return json({ error: "Please upload an image." }, 400);
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return json({ error: "Please use a PNG, JPG or WEBP image." }, 400);
        if (file.size > 10 * 1024 * 1024) return json({ error: "Image must be 10 MB or smaller." }, 413);
        if (!prompt || prompt.length > 1500) return json({ error: "Add a prompt of 1–1500 characters." }, 400);
        if (![5, 8, 10].includes(seconds)) return json({ error: "Choose 5, 8 or 10 seconds." }, 400);

        const auth = { Authorization: `Bearer ${env.MAGIC_HOUR_API_KEY}`, "Content-Type": "application/json" };
        const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
        const uploadResponse = await fetch("https://api.magichour.ai/v1/files/upload-urls", {
          method: "POST", headers: auth,
          body: JSON.stringify({ items: [{ type: "image", extension: ext }] })
        });
        const uploadData = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) return json({ error: uploadData.message || uploadData.error || "Could not prepare the image upload." }, 502);
        const uploadItem = uploadData.items?.[0];
        if (!uploadItem?.upload_url || !uploadItem?.file_path) return json({ error: "The video provider returned an unexpected upload response." }, 502);

        const putResponse = await fetch(uploadItem.upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file
        });
        if (!putResponse.ok) return json({ error: "Image upload failed. Please try again." }, 502);

        const createResponse = await fetch("https://api.magichour.ai/v1/image-to-video", {
          method: "POST", headers: auth,
          body: JSON.stringify({
            assets: { image_file_path: uploadItem.file_path },
            end_seconds: seconds,
            style: { prompt }
          })
        });
        const project = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok) return json({ error: project.message || project.error || "The video provider could not start this render." }, 502);
        return json({
          ok: true,
          id: project.id || project.project_id,
          status: project.status || "processing",
          creditsCharged: project.credits_charged ?? null,
          estimatedFrameCost: project.estimated_frame_cost ?? null,
          message: "Your video is being generated."
        }, 202);
      }

      const match = url.pathname.match(/^\/api\/video\/([A-Za-z0-9_-]+)$/);
      if (match && request.method === "GET") {
        const result = await fetch(`https://api.magichour.ai/v1/video-projects/${encodeURIComponent(match[1])}`, {
          headers: { Authorization: `Bearer ${env.MAGIC_HOUR_API_KEY}` }
        });
        const data = await result.json().catch(() => ({}));
        return json(result.ok ? data : { error: data.message || data.error || "Could not check video status." }, result.ok ? 200 : 502);
      }
      return json({ error: "API route not found." }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
