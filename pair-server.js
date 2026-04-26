require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const QRCode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const authDir = "auth_info_web";
const sessionPath = path.join(authDir, "helox-session.json");

function createSessionId(phoneNumber) {
  const raw = `${phoneNumber}|${Date.now()}|helox-md-webpair`;
  const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20).toUpperCase();
  return `HELOX-${digest}`;
}

function saveSession(data) {
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
}

function getExistingSession() {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  } catch {
    return null;
  }
}

async function createSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: "silent" })
  });
  sock.ev.on("creds.update", saveCreds);
  return sock;
}

function normalizeError(error) {
  const msg = String(error?.message || error || "Unknown error");
  if (/Connection Closed/i.test(msg)) {
    return "Connection closed by WhatsApp. Retry in 5-10 seconds and ensure the number format is valid (country code + number, no +).";
  }
  if (/timed out|timeout/i.test(msg)) {
    return "Request timed out. Please try again.";
  }
  return msg;
}

async function waitForSocketReady(sock, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Socket startup timeout."));
    }, timeoutMs);

    const onUpdate = (update) => {
      if (update.connection === "open" || update.connection === "connecting" || update.qr) {
        cleanup();
        resolve();
      }
      if (update.connection === "close") {
        cleanup();
        reject(new Error("Connection Closed"));
      }
    };

    function cleanup() {
      clearTimeout(timeout);
      sock.ev.off("connection.update", onUpdate);
    }

    sock.ev.on("connection.update", onUpdate);
  });
}

async function requestPairingCodeWithRetry(phone, retries = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let sock = null;
    try {
      sock = await createSocket();
      if (sock.authState.creds.registered) {
        const existing = getExistingSession();
        sock.end(undefined);
        return {
          alreadyRegistered: true,
          existingSessionId: existing?.sessionId || null
        };
      }

      await waitForSocketReady(sock, 18000);
      await delay(1200);
      const pairingCode = await sock.requestPairingCode(phone);
      sock.end(undefined);
      return { pairingCode };
    } catch (error) {
      lastError = error;
      if (sock) {
        try {
          sock.end(undefined);
        } catch {
          // Ignore teardown errors.
        }
      }
      if (attempt < retries) {
        await delay(1800);
      }
    }
  }
  throw lastError || new Error("Failed to generate pairing code.");
}

app.get("/", async (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`
    <html>
      <head>
        <title>HELOX-MD Pairing</title>
        <style>
          :root {
            --bg: #04050f;
            --panel: #111629;
            --panel-alt: #0e1324;
            --text: #f6f7ff;
            --muted: #aab2c8;
            --primary: #8b5cf6;
            --primary-soft: #a78bfa;
            --success: #34d399;
            --danger: #f87171;
            --border: #2a3550;
            --glass: rgba(16, 22, 42, 0.78);
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: "Inter", "Segoe UI", Arial, sans-serif;
            color: var(--text);
            background:
              radial-gradient(650px 320px at 5% -10%, rgba(124, 58, 237, 0.35), transparent 70%),
              radial-gradient(780px 380px at 100% -5%, rgba(168, 85, 247, 0.25), transparent 70%),
              linear-gradient(180deg, #050712 0%, #04050f 100%);
            padding: 28px 14px;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .shell {
            width: 100%;
            max-width: 900px;
            border: 1px solid rgba(95, 111, 150, 0.34);
            border-radius: 26px;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(18, 24, 45, 0.94), rgba(10, 14, 28, 0.96));
            box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(10px);
          }
          .hero {
            padding: 26px 26px 20px;
            border-bottom: 1px solid rgba(118, 136, 177, 0.2);
            background: linear-gradient(90deg, rgba(139, 92, 246, 0.15), rgba(17, 24, 39, 0.04) 45%);
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            letter-spacing: 0.2px;
            color: #ddd6fe;
            background: rgba(139, 92, 246, 0.14);
            border: 1px solid rgba(167, 139, 250, 0.35);
            border-radius: 999px;
            padding: 6px 12px;
            margin-bottom: 14px;
            font-weight: 600;
          }
          .title {
            margin: 0;
            font-weight: 800;
            line-height: 1.15;
            font-size: clamp(28px, 5vw, 38px);
          }
          .title span {
            background: linear-gradient(90deg, #ddd6fe 10%, #fff 45%, #c4b5fd 80%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }
          .sub {
            margin: 12px 0 0;
            color: var(--muted);
            max-width: 620px;
            line-height: 1.5;
          }
          .content {
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 0;
          }
          .panel {
            padding: 24px;
          }
          .panel + .panel {
            border-left: 1px solid rgba(118, 136, 177, 0.2);
            background: rgba(8, 12, 25, 0.34);
          }
          .mode-row {
            display: flex;
            gap: 10px;
            margin-bottom: 14px;
          }
          .mode-btn {
            flex: 1;
            border-radius: 11px;
            border: 1px solid #364465;
            background: #131a30;
            color: #d4dcf2;
            font-weight: 600;
            padding: 11px;
            cursor: pointer;
            transition: 0.18s ease;
          }
          .mode-btn.active {
            border-color: #8b5cf6;
            background: linear-gradient(90deg, rgba(139, 92, 246, 0.25), rgba(109, 40, 217, 0.26));
            color: #fff;
            box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.3);
          }
          .field {
            margin-top: 14px;
          }
          label {
            display: block;
            color: #d6def2;
            font-size: 13px;
            margin-bottom: 8px;
            font-weight: 600;
          }
          input,
          button {
            width: 100%;
            border-radius: 12px;
            padding: 12px 13px;
            font-size: 15px;
          }
          input {
            border: 1px solid #33415f;
            background: var(--panel-alt);
            color: #fff;
            outline: none;
          }
          input:focus {
            border-color: var(--primary-soft);
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.24);
          }
          button#run {
            margin-top: 14px;
            border: none;
            cursor: pointer;
            color: #fff;
            font-weight: 700;
            background: linear-gradient(90deg, #8b5cf6, #7c3aed);
            box-shadow: 0 12px 24px rgba(109, 40, 217, 0.35);
            transition: transform 0.15s ease, filter 0.2s ease;
          }
          button#run:hover {
            transform: translateY(-1px);
            filter: brightness(1.06);
          }
          .mini {
            margin-top: 10px;
            font-size: 12px;
            color: #9ca8c1;
          }
          code {
            background: #0b1328;
            border: 1px solid #25304a;
            color: #dbeafe;
            border-radius: 6px;
            padding: 2px 6px;
          }
          .status {
            margin-top: 14px;
            border: 1px solid #2e3a57;
            border-radius: 12px;
            background: var(--glass);
            padding: 11px 12px;
            color: #dbe7ff;
            min-height: 44px;
            display: flex;
            align-items: center;
            font-size: 14px;
          }
          .status.success {
            border-color: rgba(52, 211, 153, 0.45);
            color: #d1fae5;
          }
          .status.error {
            border-color: rgba(248, 113, 113, 0.45);
            color: #fee2e2;
          }
          .result-card {
            border: 1px solid #2c3752;
            border-radius: 14px;
            background: linear-gradient(180deg, #0b1020, #090d1a);
            padding: 16px;
            margin-top: 14px;
            min-height: 240px;
            display: flex;
            justify-content: center;
            align-items: center;
            text-align: center;
          }
          .placeholder {
            color: #97a3bf;
            font-size: 14px;
            line-height: 1.5;
            max-width: 280px;
          }
          .pair-code {
            margin: 2px 0 8px;
            font-size: clamp(30px, 6vw, 40px);
            letter-spacing: 3px;
            font-weight: 900;
            color: #d8b4fe;
            text-shadow: 0 0 24px rgba(216, 180, 254, 0.25);
          }
          .pair-note {
            color: #cfd8ee;
            font-size: 14px;
            line-height: 1.45;
          }
          img.qr {
            width: min(320px, 100%);
            background: #fff;
            border-radius: 12px;
            padding: 9px;
            border: 1px solid #44506d;
          }
          .steps h3 {
            margin: 2px 0 12px;
            font-size: 16px;
          }
          .steps ol {
            margin: 0;
            padding-left: 18px;
            color: #c8d1e8;
            line-height: 1.7;
            font-size: 14px;
          }
          .steps li + li {
            margin-top: 4px;
          }
          .tips {
            margin-top: 14px;
            border-top: 1px solid rgba(112, 130, 170, 0.2);
            padding-top: 14px;
            color: #93a1be;
            font-size: 13px;
            line-height: 1.55;
          }
          @media (max-width: 800px) {
            .content {
              grid-template-columns: 1fr;
            }
            .panel + .panel {
              border-left: none;
              border-top: 1px solid rgba(118, 136, 177, 0.2);
            }
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <section class="hero">
            <div class="badge">💫 HELOX-MD PAIR CODE</div>
            <h1 class="title"><span>Connect WhatsApp in Seconds</span></h1>
            <p class="sub">Use your phone number to generate a secure pairing code or QR. Your local session is saved after successful link.</p>
          </section>
          <section class="content">
            <div class="panel">
              <div class="mode-row">
                <button class="mode-btn active" id="modeCodeBtn" type="button" onclick="switchMode('code')">Pairing Code</button>
                <button class="mode-btn" id="modeQrBtn" type="button" onclick="switchMode('qr')">QR Pairing</button>
              </div>
              <div class="field" id="phoneField">
                <label for="phone">Phone Number (country code, no +)</label>
                <input id="phone" placeholder="25261XXXXXXX" />
              </div>
              <button id="run" type="button" onclick="runPairing()">Generate Pairing Code</button>
              <div class="mini">Endpoints: <code>/pair?phone=25261XXXXXXX</code> and <code>/pair/qr</code></div>
              <div id="status" class="status">Ready to pair your account.</div>
              <div id="result" class="result-card">
                <div class="placeholder">Choose a pairing mode, then generate your code. The result will appear here.</div>
              </div>
            </div>
            <div class="panel">
              <div class="steps">
                <h3>How to link</h3>
                <ol>
                  <li>Open WhatsApp on your phone.</li>
                  <li>Go to <strong>Linked devices</strong>.</li>
                  <li>Select <strong>Link with phone number</strong> or scan QR.</li>
                  <li>Enter the generated code or scan the QR shown here.</li>
                </ol>
              </div>
              <div class="tips">
                If you are already paired, remove <code>auth_info_web</code> and retry.<br />
                Keep this page open while linking to avoid connection timeout.
              </div>
            </div>
          </section>
        </div>
        <script>
          let mode = "code";

          function setStatus(text, tone) {
            const el = document.getElementById("status");
            el.className = "status" + (tone ? " " + tone : "");
            el.textContent = text;
          }

          function switchMode(nextMode) {
            mode = nextMode;
            const codeBtn = document.getElementById("modeCodeBtn");
            const qrBtn = document.getElementById("modeQrBtn");
            const phoneField = document.getElementById("phoneField");
            const run = document.getElementById("run");
            const result = document.getElementById("result");

            codeBtn.classList.toggle("active", nextMode === "code");
            qrBtn.classList.toggle("active", nextMode === "qr");
            phoneField.style.display = nextMode === "code" ? "block" : "none";
            run.textContent = nextMode === "code" ? "Generate Pairing Code" : "Generate QR";

            result.innerHTML = '<div class="placeholder">Result area reset for ' + (nextMode === "code" ? "pairing code." : "QR generation.") + "</div>";
            setStatus("Ready. Click the button to continue.");
          }

          function renderPairingCode(data) {
            const result = document.getElementById("result");
            const wrapper = document.createElement("div");

            if (data.registered) {
              wrapper.innerHTML =
                '<div class="pair-note">This instance is already paired.<br />Delete <code>auth_info_web</code> to create a new pair.</div>';
              result.innerHTML = "";
              result.appendChild(wrapper);
              setStatus("Already paired.", "success");
              return;
            }

            wrapper.innerHTML = '<div class="pair-code"></div><div class="pair-note"></div>';
            wrapper.querySelector(".pair-code").textContent = data.pairingCode || "----";
            wrapper.querySelector(".pair-note").textContent =
              data.note || "Enter this code in WhatsApp linked devices.";
            result.innerHTML = "";
            result.appendChild(wrapper);
            setStatus("Pairing code generated successfully.", "success");
          }

          function renderQr(data) {
            const result = document.getElementById("result");
            const wrap = document.createElement("div");

            if (data.registered) {
              wrap.innerHTML =
                '<div class="pair-note">This instance is already paired.<br />Delete <code>auth_info_web</code> to create a new QR pair.</div>';
              result.innerHTML = "";
              result.appendChild(wrap);
              setStatus("Already paired.", "success");
              return;
            }

            if (data.qrImageDataUrl) {
              const img = document.createElement("img");
              img.className = "qr";
              img.src = data.qrImageDataUrl;
              img.alt = "Pairing QR";
              wrap.appendChild(img);
            } else {
              const fallback = document.createElement("div");
              fallback.className = "pair-note";
              fallback.textContent = "QR image not returned.";
              wrap.appendChild(fallback);
            }

            if (data.note) {
              const note = document.createElement("div");
              note.className = "pair-note";
              note.style.marginTop = "10px";
              note.textContent = data.note;
              wrap.appendChild(note);
            }

            result.innerHTML = "";
            result.appendChild(wrap);
            setStatus("QR generated successfully.", "success");
          }

          async function runPairing() {
            setStatus(mode === "code" ? "Generating pairing code..." : "Generating QR...");
            const run = document.getElementById("run");
            run.disabled = true;
            run.style.opacity = "0.75";
            try {
              if (mode === "code") {
                const phone = document.getElementById("phone").value.trim();
                const res = await fetch("/pair?phone=" + encodeURIComponent(phone));
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || "Failed to generate pairing code.");
                renderPairingCode(data);
              } else {
                const res = await fetch("/pair/qr");
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || "Failed to generate QR.");
                renderQr(data);
              }
            } catch (error) {
              setStatus("Error: " + (error && error.message ? error.message : "Unknown error"), "error");
            } finally {
              run.disabled = false;
              run.style.opacity = "1";
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.get("/pair", async (req, res) => {
  const phone = String(req.query.phone || "").replace(/\D/g, "");
  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone. Use /pair?phone=25261XXXXXXX" });
  }
  if (phone.length < 8) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid phone number. Use country code + full number, no + sign." });
  }

  try {
    const pairResult = await requestPairingCodeWithRetry(phone, 3);
    if (pairResult.alreadyRegistered) {
      return res.json({
        ok: true,
        registered: true,
        message: "Already paired. Delete auth_info_web to create a new pair."
      });
    }

    const pairingCode = pairResult.pairingCode;
    const formattedCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
    const sessionId = createSessionId(phone);

    saveSession({
      project: "helox-md",
      source: "web-pair",
      phone,
      sessionId,
      createdAt: new Date().toISOString()
    });

    return res.json({
      ok: true,
      brand: "HELOX-MD",
      pairingCode: formattedCode,
      note: "Enter pairing code in WhatsApp > Linked devices > Link with phone number."
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: normalizeError(error) });
  }
});

app.get("/pair/qr", async (_req, res) => {
  try {
    const sock = await createSocket();

    if (sock.authState.creds.registered) {
      sock.end(undefined);
      return res.json({
        ok: true,
        registered: true,
        message: "Already paired. Delete auth_info_web to create a new QR pair."
      });
    }

    const qrPayload = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("QR generation timeout. Try again."));
      }, 25000);

      sock.ev.on("connection.update", (update) => {
        if (update.qr) {
          clearTimeout(timeout);
          resolve(update.qr);
        }
        if (update.connection === "close") {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            clearTimeout(timeout);
            reject(new Error("Logged out. Clear auth and retry."));
          }
        }
      });
    });

    const qrImageDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 360 });
    const sessionId = createSessionId("qr");

    saveSession({
      project: "helox-md",
      source: "web-qr",
      sessionId,
      createdAt: new Date().toISOString()
    });

    // Give client time to scan before closing transport aggressively.
    await delay(2000);
    sock.end(undefined);

    return res.json({
      ok: true,
      brand: "HELOX-MD",
      qrImageDataUrl,
      note: "Scan this QR from WhatsApp -> Linked devices -> Link a device."
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: normalizeError(error) });
  }
});

app.listen(PORT, () => {
  console.log(`HELOX-MD Pairing server is running on port ${PORT}`);
});
