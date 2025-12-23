import express from "express";
import http from "http";
import path from "path";
import "./env.js";
import { setupWebSocket } from "./ws.js";
import { getHeyGenToken } from "./heygen.js";

const app = express();
const server = http.createServer(app);

// Serve the web UI from the project `web/` folder
const webPath = path.join(process.cwd(), "web");
app.use(express.static(webPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(webPath, "index.html"));
});

// HeyGen Token API
app.get("/heygen-token", async(req, res) => {
    try {
        const token = await getHeyGenToken();
        res.json({ token });
    } catch (err) {
        console.error("HeyGen token error:", err);
        res.status(500).json({ error: "HeyGen token error" });
    }
});

// WebSocket
setupWebSocket(server);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});