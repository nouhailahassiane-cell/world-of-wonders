const input = document.getElementById("image-input");
const image = document.getElementById("preview-image");
const empty = document.getElementById("empty-state");
const drop = document.getElementById("drop-zone");
const fileLabel = document.getElementById("file-label");
const frame = document.getElementById("preview-frame");
const ratio = document.getElementById("ratio-label");
const notice = document.getElementById("notice");
let selectedFile = null;
let imageUrl = null;
let pollTimer = null;

function useFile(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    notice.textContent = "Please choose a PNG, JPG or WEBP image.";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    notice.textContent = "Please choose an image smaller than 10 MB.";
    return;
  }
  selectedFile = file;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = URL.createObjectURL(file);
  image.src = imageUrl;
  image.hidden = false;
  empty.hidden = true;
  fileLabel.textContent = file.name;
  notice.textContent = "Image loaded. Add your motion prompt and settings.";
}
input.addEventListener("change", e => useFile(e.target.files[0]));
["dragenter", "dragover"].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", e => useFile(e.dataTransfer.files[0]));
document.getElementById("format").addEventListener("change", e => {
  const value = e.target.value;
  frame.className = "preview-frame ratio-" + value.replace(":", "-");
  ratio.textContent = value;
});

function findVideoUrl(data) {
  const candidates = [data.video_url, data.download_url, data.url, data.output?.url, data.downloads?.[0]?.url, data.result?.url];
  return candidates.find(value => typeof value === "string" && /^https:\/\//.test(value));
}
async function checkProject(id, button) {
  try {
    const response = await fetch("/api/video/" + encodeURIComponent(id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check render status.");
    const status = String(data.status || data.state || "processing").toLowerCase();
    const videoUrl = findVideoUrl(data);
    if (videoUrl || ["completed", "complete", "succeeded", "success", "finished"].includes(status)) {
      clearInterval(pollTimer);
      const url = videoUrl || findVideoUrl(data.output || {});
      if (url) {
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.src = url;
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.objectFit = "contain";
        frame.replaceChildren(video);
        notice.textContent = "Your AI video is ready. You can play it here.";
      } else {
        notice.textContent = "The render is complete. Open your Magic Hour dashboard to view the finished video.";
      }
      button.disabled = false;
      button.innerHTML = "Create another video <span>↗</span>";
    } else if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      clearInterval(pollTimer);
      notice.textContent = data.error || "The video generation failed. Please check your provider dashboard.";
      button.disabled = false;
      button.innerHTML = "Try again <span>↗</span>";
    } else {
      notice.textContent = "Your video is rendering… Status: " + status + ". This can take a few minutes.";
    }
  } catch (error) {
    clearInterval(pollTimer);
    notice.textContent = error.message;
    button.disabled = false;
    button.innerHTML = "Check again <span>↗</span>";
  }
}
document.getElementById("generate").addEventListener("click", async e => {
  const button = e.currentTarget;
  const prompt = document.getElementById("prompt").value.trim();
  const duration = document.getElementById("duration").value;
  if (!selectedFile) { notice.textContent = "First upload the image you want to animate."; return; }
  if (!prompt) { notice.textContent = "Add a short description of the camera and scene movement."; document.getElementById("prompt").focus(); return; }
  if (!confirm("Starting an AI video render may use credits from your Magic Hour account. Continue only if you are comfortable with the possible credit charge.")) return;
  button.disabled = true;
  button.textContent = "Uploading and starting render…";
  notice.textContent = "Preparing your image for the AI video service…";
  try {
    const body = new FormData();
    body.append("image", selectedFile);
    body.append("prompt", prompt);
    body.append("duration", duration);
    const response = await fetch("/api/video", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start video generation.");
    if (!data.id) throw new Error("The provider did not return a project ID. Check your Magic Hour dashboard before trying again to avoid duplicate charges.");
    notice.textContent = "Render started. Credits charged: " + (data.creditsCharged ?? "not reported") + ". Checking progress…";
    button.textContent = "Rendering…";
    await checkProject(data.id, button);
    pollTimer = setInterval(() => checkProject(data.id, button), 10000);
  } catch (error) {
    notice.textContent = error.message;
    button.disabled = false;
    button.innerHTML = "Try again <span>↗</span>";
  }
});
