/** MCP Media App template and builder for the preview panel. */

export const MCP_MEDIA_TOOL_NAME = "personaplex";

export const MCP_MEDIA_APP_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PersonaPlex</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #1a1a2e, #0f0f1a 70%);
        color: #eef4ff;
        min-height: 100vh;
        padding: 18px;
        box-sizing: border-box;
      }
      .card {
        width: min(760px, 100%);
        margin: 0 auto;
        border: 1px solid #2a2a5a;
        border-radius: 14px;
        padding: 20px;
        background: rgba(12, 12, 30, 0.82);
        backdrop-filter: blur(8px);
      }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .subtitle { margin: 0 0 6px; font-size: 13px; color: #a78bfa; font-family: monospace; }
      p { margin: 0 0 14px; color: #9fb5d8; font-size: 14px; }
      .section { margin-top: 16px; }
      .label {
        margin-bottom: 6px;
        font-size: 13px;
        color: #9fb5d8;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .label .req { color: #ff8ea1; font-size: 11px; }
      .label .opt { color: #6b8ab5; font-size: 11px; }
      .row {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr;
      }
      input[type="text"], input[type="number"], select, textarea {
        width: 100%;
        border: 1px solid #2a2a5a;
        border-radius: 10px;
        padding: 9px 10px;
        background: #13132a;
        color: #eef4ff;
        font-size: 14px;
        box-sizing: border-box;
        font-family: inherit;
      }
      textarea {
        resize: vertical;
        min-height: 72px;
      }
      input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
        outline: none;
        border-color: #a78bfa;
      }
      .range-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .range-wrap input[type="range"] {
        flex: 1;
        accent-color: #a78bfa;
      }
      .range-val {
        min-width: 42px;
        text-align: right;
        font-size: 14px;
        color: #eef4ff;
        font-variant-numeric: tabular-nums;
      }
      .status {
        margin-top: 12px;
        min-height: 19px;
        font-size: 13px;
        color: #9fb5d8;
      }
      .status.error { color: #ff8ea1; }
      .status.success { color: #34c59b; }
      .apply-btn {
        border: 0;
        border-radius: 10px;
        padding: 10px 20px;
        font-weight: 700;
        font-size: 14px;
        color: #fff;
        background: linear-gradient(135deg, #a78bfa, #6d28d9);
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .apply-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .actions {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
      }
      .result-area {
        margin-top: 16px;
        display: none;
      }
      .result-area.visible { display: block; }
      .result-audio {
        margin-top: 8px;
      }
      .result-audio audio {
        width: 100%;
        border-radius: 10px;
      }
      .result-text {
        margin-top: 10px;
        padding: 12px;
        background: #13132a;
        border: 1px solid #2a2a5a;
        border-radius: 10px;
        font-size: 14px;
        color: #eef4ff;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      .result-meta {
        margin-top: 8px;
        font-size: 12px;
        color: #6b8ab5;
      }
      .voice-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      .voice-group-label {
        font-size: 11px;
        color: #6b8ab5;
        padding: 4px 0 2px;
        grid-column: 1 / -1;
      }
      @media (max-width: 600px) {
        .row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>PersonaPlex</h1>
      <div class="subtitle">fal-ai/personaplex</div>
      <p>Real-time speech-to-speech AI with persona control. Provide audio input and a persona prompt to generate a conversational response.</p>

      <div class="section">
        <div class="label">Audio URL <span class="req">required</span></div>
        <input type="text" id="audio-url" placeholder="https://example.com/input-speech.wav" />
      </div>

      <div class="section">
        <div class="label">Persona Prompt <span class="opt">optional</span></div>
        <textarea id="prompt" placeholder="You are a wise and friendly teacher who explains concepts clearly and patiently..." rows="3"></textarea>
      </div>

      <div class="section row">
        <div>
          <div class="label">Voice <span class="opt">default: NATF2</span></div>
          <select id="voice">
            <optgroup label="Natural Female">
              <option value="NATF0">NATF0</option>
              <option value="NATF1">NATF1</option>
              <option value="NATF2" selected>NATF2</option>
              <option value="NATF3">NATF3</option>
            </optgroup>
            <optgroup label="Natural Male">
              <option value="NATM0">NATM0</option>
              <option value="NATM1">NATM1</option>
              <option value="NATM2">NATM2</option>
              <option value="NATM3">NATM3</option>
            </optgroup>
            <optgroup label="Variety Female">
              <option value="VARF0">VARF0</option>
              <option value="VARF1">VARF1</option>
              <option value="VARF2">VARF2</option>
              <option value="VARF3">VARF3</option>
              <option value="VARF4">VARF4</option>
            </optgroup>
            <optgroup label="Variety Male">
              <option value="VARM0">VARM0</option>
              <option value="VARM1">VARM1</option>
              <option value="VARM2">VARM2</option>
              <option value="VARM3">VARM3</option>
              <option value="VARM4">VARM4</option>
            </optgroup>
          </select>
        </div>
        <div>
          <div class="label">Seed <span class="opt">optional</span></div>
          <input type="number" id="seed" placeholder="Random" min="0" />
        </div>
      </div>

      <div class="section row">
        <div>
          <div class="label">Audio Temperature <span class="opt">0 &ndash; 2</span></div>
          <div class="range-wrap">
            <input type="range" id="temp-audio" min="0" max="2" step="0.05" value="0.8" />
            <span class="range-val" id="temp-audio-val">0.80</span>
          </div>
        </div>
        <div>
          <div class="label">Text Temperature <span class="opt">0 &ndash; 2</span></div>
          <div class="range-wrap">
            <input type="range" id="temp-text" min="0" max="2" step="0.05" value="0.7" />
            <span class="range-val" id="temp-text-val">0.70</span>
          </div>
        </div>
      </div>

      <div class="section row">
        <div>
          <div class="label">Top-K Audio <span class="opt">1 &ndash; 2048</span></div>
          <div class="range-wrap">
            <input type="range" id="topk-audio" min="1" max="2048" step="1" value="250" />
            <span class="range-val" id="topk-audio-val">250</span>
          </div>
        </div>
        <div>
          <div class="label">Top-K Text <span class="opt">1 &ndash; 1000</span></div>
          <div class="range-wrap">
            <input type="range" id="topk-text" min="1" max="1000" step="1" value="25" />
            <span class="range-val" id="topk-text-val">25</span>
          </div>
        </div>
      </div>

      <div class="status" id="status">Ready.</div>
      <div class="actions">
        <button type="button" id="confirm-btn" class="apply-btn">Generate</button>
      </div>

      <div class="result-area" id="result-area">
        <div class="label">Response</div>
        <div class="result-audio" id="result-audio"></div>
        <div class="result-text" id="result-text"></div>
        <div class="result-meta" id="result-meta"></div>
      </div>
    </main>
    <script>
      const audioUrlInput = document.getElementById("audio-url");
      const promptInput = document.getElementById("prompt");
      const voiceSelect = document.getElementById("voice");
      const seedInput = document.getElementById("seed");
      const tempAudioInput = document.getElementById("temp-audio");
      const tempAudioVal = document.getElementById("temp-audio-val");
      const tempTextInput = document.getElementById("temp-text");
      const tempTextVal = document.getElementById("temp-text-val");
      const topkAudioInput = document.getElementById("topk-audio");
      const topkAudioVal = document.getElementById("topk-audio-val");
      const topkTextInput = document.getElementById("topk-text");
      const topkTextVal = document.getElementById("topk-text-val");
      const confirmBtn = document.getElementById("confirm-btn");
      const statusEl = document.getElementById("status");
      const resultArea = document.getElementById("result-area");
      const resultAudio = document.getElementById("result-audio");
      const resultText = document.getElementById("result-text");
      const resultMeta = document.getElementById("result-meta");

      const projectId = __PROJECT_ID_JSON__;
      const apiBaseUrl = "http://127.0.0.1:8765";

      function setStatus(message, type) {
        try {
          if (!statusEl) return;
          statusEl.textContent = message;
          statusEl.className = "status";
          if (type === "error") statusEl.classList.add("error");
          if (type === "success") statusEl.classList.add("success");
        } catch (e) {}
      }

      tempAudioInput?.addEventListener("input", () => {
        try { if (tempAudioVal) tempAudioVal.textContent = Number.parseFloat(tempAudioInput.value).toFixed(2); } catch (e) {}
      });
      tempTextInput?.addEventListener("input", () => {
        try { if (tempTextVal) tempTextVal.textContent = Number.parseFloat(tempTextInput.value).toFixed(2); } catch (e) {}
      });
      topkAudioInput?.addEventListener("input", () => {
        try { if (topkAudioVal) topkAudioVal.textContent = topkAudioInput.value; } catch (e) {}
      });
      topkTextInput?.addEventListener("input", () => {
        try { if (topkTextVal) topkTextVal.textContent = topkTextInput.value; } catch (e) {}
      });

      confirmBtn?.addEventListener("click", async () => {
        try {
          const audioUrl = (audioUrlInput?.value || "").trim();
          if (!audioUrl) {
            setStatus("Audio URL is required.", "error");
            audioUrlInput?.focus();
            return;
          }

          confirmBtn.disabled = true;
          setStatus("Generating speech response...", "");
          resultArea?.classList.remove("visible");

          const payload = {
            audio_url: audioUrl,
            voice: voiceSelect?.value || "NATF2",
            temperature_audio: Number.parseFloat(tempAudioInput?.value || "0.8"),
            temperature_text: Number.parseFloat(tempTextInput?.value || "0.7"),
            top_k_audio: Number.parseInt(topkAudioInput?.value || "250", 10),
            top_k_text: Number.parseInt(topkTextInput?.value || "25", 10),
          };

          const prompt = (promptInput?.value || "").trim();
          if (prompt) {
            payload.prompt = prompt;
          }

          const seedVal = (seedInput?.value || "").trim();
          if (seedVal !== "") {
            const seedNum = Number.parseInt(seedVal, 10);
            if (Number.isFinite(seedNum) && seedNum >= 0) {
              payload.seed = seedNum;
            }
          }

          const response = await fetch(
            apiBaseUrl + "/api/claude/personaplex/generate",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(errBody || "Request failed: " + response.status);
          }

          const result = await response.json();

          if (resultArea) resultArea.classList.add("visible");
          if (result.audio && result.audio.url && resultAudio) {
            resultAudio.textContent = "";
            var audioEl = document.createElement("audio");
            audioEl.controls = true;
            audioEl.autoplay = true;
            audioEl.src = result.audio.url;
            audioEl.style.cssText = "width:100%;border-radius:10px;";
            if (result.text) {
              try {
                var vtt = "WEBVTT\\n\\n00:00:00.000 --> 99:59:59.999\\n" + result.text;
                var trackBlob = new Blob([vtt], { type: "text/vtt" });
                var trackUrl = URL.createObjectURL(trackBlob);
                var track = document.createElement("track");
                track.kind = "captions";
                track.srclang = "en";
                track.label = "Response";
                track.src = trackUrl;
                track.default = true;
                audioEl.appendChild(track);
              } catch (e) {}
            }
            resultAudio.appendChild(audioEl);
          }
          if (result.text && resultText) {
            resultText.textContent = result.text;
          }
          const meta = [];
          if (result.duration != null) meta.push("Duration: " + Number(result.duration).toFixed(2) + "s");
          if (result.seed != null) meta.push("Seed: " + result.seed);
          if (resultMeta) resultMeta.textContent = meta.join(" | ");

          setStatus("Response received!", "success");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to generate";
          setStatus(message, "error");
        } finally {
          if (confirmBtn) confirmBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;

/** Build the MCP media app HTML template with an escaped projectId injected. */
export function buildMcpMediaAppHtml({
	projectId,
}: {
	projectId: string | null;
}): string {
	try {
		const resolvedProjectId = (projectId || "default").trim() || "default";
		const safeProjectId = JSON.stringify(resolvedProjectId);
		return MCP_MEDIA_APP_TEMPLATE.replace(
			/__PROJECT_ID_JSON__/g,
			safeProjectId
		);
	} catch {
		return MCP_MEDIA_APP_TEMPLATE.replace(
			/__PROJECT_ID_JSON__/g,
			JSON.stringify("default")
		);
	}
}
