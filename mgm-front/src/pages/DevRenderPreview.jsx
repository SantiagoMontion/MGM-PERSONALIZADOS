import { useState, useRef, useEffect } from "react";

export default function DevRenderPreview() {
  const [file, setFile] = useState(null);
  const [renderText, setRenderText] = useState("");
  const [renderObj, setRenderObj] = useState(null);
  const [serverInner, setServerInner] = useState("");
  const [serverPrint, setServerPrint] = useState("");
  const [debug, setDebug] = useState(null);
  const [showGuides, setShowGuides] = useState(false);
  const [showBleed, setShowBleed] = useState(false);
  const [diffPct, setDiffPct] = useState(null);

  const canvasRef = useRef(null);
  const diffRef = useRef(null);

  useEffect(() => {
    try {
      setRenderObj(renderText ? JSON.parse(renderText) : null);
    } catch (err) {
      /* ignore */
    }
  }, [renderText]);

  useEffect(() => {
    drawLocal();
  }, [file, renderObj, showGuides]);

  async function drawLocal() {
    if (!file || !renderObj || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const { canvas_px, place_px, rotate_deg, fit_mode, bg_hex } = renderObj;
      const canvas = canvasRef.current;
      canvas.width = canvas_px.w;
      canvas.height = canvas_px.h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = fit_mode === "contain" && bg_hex ? bg_hex : "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      const { x, y, w, h } = place_px;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(((rotate_deg || 0) * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      if (showGuides) {
        ctx.strokeStyle = "#00f";
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#0f0";
        ctx.strokeRect(x, y, w, h);
      }
    };
    img.src = URL.createObjectURL(file);
  }

  async function handleServer() {
    if (!file || !renderObj) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const res = await fetch(
      `${import.meta.env.VITE_API_BASE}/api/render-dryrun`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ render_v2: renderObj, file_data: b64 }),
      },
    );
    const json = await res.json();
    if (json.ok) {
      setServerInner(json.inner);
      setServerPrint(json.print);
      setDebug(json.debug);
    }
  }

  function compare() {
    if (!serverInner || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const w = canvasRef.current.width;
      const h = canvasRef.current.height;
      const diffCanvas = diffRef.current;
      diffCanvas.width = w;
      diffCanvas.height = h;
      const ctxA = canvasRef.current.getContext("2d");
      const dataA = ctxA.getImageData(0, 0, w, h).data;
      const temp = document.createElement("canvas");
      temp.width = w;
      temp.height = h;
      const tctx = temp.getContext("2d");
      tctx.drawImage(img, 0, 0, w, h);
      const dataB = tctx.getImageData(0, 0, w, h).data;
      const diffCtx = diffCanvas.getContext("2d");
      const diffData = diffCtx.createImageData(w, h);
      let mse = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        const dr = dataA[i] - dataB[i];
        const dg = dataA[i + 1] - dataB[i + 1];
        const db = dataA[i + 2] - dataB[i + 2];
        const err = (dr * dr + dg * dg + db * db) / 3;
        mse += err;
        const val = Math.min(255, Math.sqrt(err));
        diffData.data[i] = val;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 255;
      }
      diffCtx.putImageData(diffData, 0, 0);
      mse /= w * h * 255 * 255;
      setDiffPct(mse * 100);
    };
    img.src = serverInner;
  }

  async function finalize() {
    if (!renderObj) return;
    const jobId = prompt("job_id?");
    if (!jobId) return;
    const res = await fetch(
      `${import.meta.env.VITE_API_BASE}/api/finalize-assets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, render_v2: renderObj }),
      },
    );
    const json = await res.json();
    if (!json.ok) alert(JSON.stringify(json));
    else alert("ok");
  }

  function download() {
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "render.png";
    a.click();
  }

  return (
    <div style={{ display: "flex", gap: "10px" }}>
      <div style={{ flex: 1 }}>
        <h3>Canvas local</h3>
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <textarea
          rows={10}
          cols={30}
          value={renderText}
          onChange={(e) => setRenderText(e.target.value)}
          placeholder="render_v2 JSON"
        />
        <div>
          <label>
            <input
              type="checkbox"
              checked={showGuides}
              onChange={(e) => setShowGuides(e.target.checked)}
            />{" "}
            mostrar guías
          </label>
        </div>
        <canvas ref={canvasRef} style={{ border: "1px solid #ccc" }} />
        <button onClick={download}>Sólo descargar PNG</button>
      </div>
      <div style={{ flex: 1 }}>
        <h3>Server dry-run</h3>
        <button onClick={handleServer}>Render (server)</button>
        {serverInner && (
          <div style={{ position: "relative", display: "inline-block" }}>
            <img
              src={showBleed ? serverPrint : serverInner}
              alt="server"
              style={{ maxWidth: "100%" }}
            />
            {showBleed && debug && (
              <div
                style={{
                  position: "absolute",
                  left: debug.bleed_px,
                  top: debug.bleed_px,
                  width: debug.inner_w_px,
                  height: debug.inner_h_px,
                  boxShadow: "0 0 0 1px red inset",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        )}
        <div>
          <label>
            <input
              type="checkbox"
              checked={showBleed}
              onChange={(e) => setShowBleed(e.target.checked)}
            />{" "}
            Mostrar bleed
          </label>
        </div>
        {debug && (
          <table>
            <tbody>
              {Object.entries(debug).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <h3>Diff</h3>
        <button onClick={compare}>Comparar</button>
        {diffPct != null && (
          <p>{`MSE ${diffPct.toFixed(3)}% ${diffPct < 1 ? "PASS" : "FAIL"}`}</p>
        )}
        <canvas ref={diffRef} style={{ border: "1px solid #ccc" }} />
        <button onClick={finalize}>Usar este render y subir</button>
      </div>
    </div>
  );
}
