import express from "express";
import http from "http";
import path from "path";
import "./env.js";
import { setupWebSocket } from "./ws.js";

const app = express();
const server = http.createServer(app);

// Serve the web UI from the project `web/` folder
const webPath = path.join(process.cwd(), "web");
app.use(express.static(webPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(webPath, "index.html"));
});

// WebSocket
setupWebSocket(server);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});