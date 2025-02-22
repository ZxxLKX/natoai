const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const { getLlama, LlamaChatSession } = require("node-llama-cpp"); // Import LLaMA cpp model

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(cors());

const TOKENS_DB = "tokens.json";
const USAGE_DB = "usage.json";

if (!fs.existsSync(TOKENS_DB)) fs.writeFileSync(TOKENS_DB, "{}");
if (!fs.existsSync(USAGE_DB)) fs.writeFileSync(USAGE_DB, "{}");

// 🔹 Setup LLaMA Model
const llama = await getLlama();
const model = await llama.loadModel({
    modelPath: "Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf", // Sesuaikan dengan path model LLaMA yang sudah kamu download
});
const context = await model.createContext();
const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
});

// 🔹 Ambil Token (1x per bulan per device)
app.post("/token", (req, res) => {
    try {
        let { device_id, ip } = req.body;
        if (!device_id || !ip) return res.json({ error: "Device ID & IP diperlukan!" });

        let tokens = JSON.parse(fs.readFileSync(TOKENS_DB));
        let month = new Date().toISOString().slice(0, 7);

        if (tokens[device_id] && tokens[device_id].month === month) {
            return res.json({ error: "Token sudah diambil bulan ini!" });
        }

        let token = crypto.randomBytes(16).toString("hex");
        tokens[device_id] = { token, ip, month, type: "free", usage: 0 };
        fs.writeFileSync(TOKENS_DB, JSON.stringify(tokens, null, 2));

        res.json({ token });
    } catch (error) {
        handleError(error, "POST /token");
        res.json({ error: "Terjadi kesalahan saat memproses permintaan token!" });
    }
});

// 🔹 Chat API dengan LLaMA AI Model
app.post("/chat", async (req, res) => {
    try {
        let { model: modelType, token, message } = req.body;
        let tokens = JSON.parse(fs.readFileSync(TOKENS_DB));

        let user = Object.values(tokens).find(entry => entry.token === token);
        if (!user) return res.json({ error: "Token tidak valid!" });

        if (!["dannsdk-free", "dannsdk-prem"].includes(modelType)) {
            return res.json({ error: "Model harus 'dannsdk-free' atau 'dannsdk-prem'!" });
        }

        if (user.type === "free" && user.usage >= 300) {
            return res.json({ error: "Batas 300 chat/bulan telah habis! Upgrade ke premium!" });
        }

        // Menggunakan LLaMA Model untuk menghasilkan respons
        const prompt = `Ini adalah DannGPT, AI yang diciptakan oleh DannDev. Pertanyaan: ${message}`;
        const response = await session.prompt(prompt);

        // Update Penggunaan Token
        user.usage++;
        tokens[user.token] = user;
        fs.writeFileSync(TOKENS_DB, JSON.stringify(tokens, null, 2));

        // Simpan Log Pemakaian
        let usage = JSON.parse(fs.readFileSync(USAGE_DB));
        if (!usage[user.token]) usage[user.token] = [];
        usage[user.token].push({ time: new Date().toISOString(), message });
        fs.writeFileSync(USAGE_DB, JSON.stringify(usage, null, 2));

        res.json({ response: response.text, remaining: user.type === "free" ? 300 - user.usage : "Unlimited" });
    } catch (error) {
        handleError(error, "POST /chat");
        res.json({ error: "Terjadi kesalahan saat memproses pesan: " + error.message });
    }
});

// 🔹 Dashboard Statistik Pemakaian Token
app.get("/dashboard", (req, res) => {
    try {
        let usage = JSON.parse(fs.readFileSync(USAGE_DB));
        let stats = Object.entries(usage).map(([token, logs]) => ({
            token,
            total_usage: logs.length,
            last_used: logs.length ? logs[logs.length - 1].time : "Belum digunakan"
        }));

        res.json({ stats });
    } catch (error) {
        handleError(error, "GET /dashboard");
        res.json({ error: "Terjadi kesalahan saat mengambil statistik!" });
    }
});

// 🔹 UI Dokumentasi + Tombol Ambil Token
app.get("/", (req, res) => {
    res.send(`
        <html>
        <head>
            <title>DannGPT API Docs</title>
            <style>
                body { font-family: Arial, sans-serif; background: #121212; color: white; text-align: center; }
                h1 { color: #00c8ff; }
                .container { width: 80%; margin: auto; }
                .endpoint { background: #222; padding: 15px; margin: 10px; border-radius: 5px; }
                pre { background: #333; padding: 10px; border-radius: 5px; text-align: left; overflow-x: auto; }
                button { background: #00c8ff; color: white; border: none; padding: 10px 20px; margin: 10px; cursor: pointer; font-size: 16px; }
                #tokenBox { margin-top: 10px; font-size: 18px; color: #00ff88; font-weight: bold; }
            </style>
            <script>
                async function getToken() {
                    const device_id = navigator.userAgent.replace(/\\s/g, '') + Math.random().toString(36).substring(7);
                    const ip = await (await fetch("https://api64.ipify.org?format=json")).json();

                    let response = await fetch("/token", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ device_id, ip: ip.ip })
                    });

                    let data = await response.json();
                    document.getElementById("tokenBox").innerText = data.token || data.error;
                }
            </script>
        </head>
        <body>
            <div class="container">
                <h1>🔥 DannGPT API Documentation 🔥</h1>
                <p>API resmi DannGPT, AI yang dibuat oleh DannDev.</p>
                
                <div class="endpoint">
                    <h3>📌 Ambil Token Gratis (1x per device per bulan)</h3>
                    <button onclick="getToken()">Ambil Token</button>
                    <div id="tokenBox">Klik tombol di atas untuk mendapatkan token</div>
                </div>

                <div class="endpoint">
                    <h3>📌 Kirim Chat ke DannGPT</h3>
                    <pre>POST /chat</pre>
                    <p>Body JSON:</p>
                    <pre>
{
    "model": "dannsdk-free",  // atau "dannsdk-prem"
    "token": "your-token-here",
    "message": "Apa pendapatmu tentang AI?"
}
                    </pre>
                </div>

                <div class="endpoint">
                    <h3>📌 Dashboard Pemakaian Token</h3>
                    <pre>GET /dashboard</pre>
                </div>

                <p>© 2025 DannDev | All Rights Reserved</p>
            </div>
        </body>
        </html>
    `);
});

// 🔹 Global Error Handling Middleware
app.use((err, req, res, next) => {
    handleError(err, "Global Middleware Error");
    res.status(500).json({ error: "Terjadi kesalahan di server!" });
});

// 🔹 Function to Handle Errors
function handleError(error, context) {
    console.error(`[ERROR] ${context}:`, error.message);
    // Log the error to a file for monitoring purposes
    fs.appendFileSync('error_log.txt', `[${new Date().toISOString()}] [${context}] ${error.stack}\n`);
}

app.listen(PORT, () => console.log(`🚀 DannGPT API berjalan di http://localhost:${PORT}`));
