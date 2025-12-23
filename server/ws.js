import WebSocket, { WebSocketServer } from "ws";
import { handleSTT } from "./stt.js";
import { handleLLM } from "./llm.js";
// TTS removed - browser handles speech via SpeechSynthesis

export function setupWebSocket(server) {
    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws) => {
        console.log("🟢 Client connected");

        // Per-connection audio buffer and timers
        ws._audioChunks = [];
        ws._audioTimer = null;
        ws._firstChunkAt = null; // timestamp of first chunk
        ws._maxTimer = null; // hard max wait

        // Process buffered audio function
        const processBufferedAudio = async() => {
            // Clear timers
            if (ws._audioTimer) {
                clearTimeout(ws._audioTimer);
                ws._audioTimer = null;
            }
            if (ws._maxTimer) {
                clearTimeout(ws._maxTimer);
                ws._maxTimer = null;
            }

            const chunks = ws._audioChunks || [];
            ws._audioChunks = [];

            // Validate chunks before processing
            if (!chunks.length) {
                console.log("⚠ No audio chunks to process");
                return;
            }

            // Filter out invalid chunks (too small or null)
            const validChunks = chunks.filter(chunk => {
                if (!chunk || !Buffer.isBuffer(chunk)) return false;
                if (chunk.length < 50) {
                    console.warn(`⚠ Skipping chunk: too small (${chunk.length} bytes)`);
                    return false;
                }
                return true;
            });

            if (!validChunks.length) {
                console.log("⚠ No valid audio chunks after filtering");
                return;
            }

            // If we filtered out chunks, log it
            if (validChunks.length < chunks.length) {
                console.log(`⚠ Filtered ${chunks.length - validChunks.length} invalid chunks, processing ${validChunks.length} valid chunks`);
            }

            try {
                console.log("🎧 Processing aggregated audio (chunks):", validChunks.length);

                // STEP 1 — Speech → Text
                // Pass raw chunk array to handleSTT so it can transcode each
                // WebM fragment individually and concatenate PCM safely.
                const userText = await handleSTT(validChunks);
                console.log("📝 User said:", userText);

                // STEP 2 — Text → AI
                const replyText = await handleLLM(userText);
                console.log("🤖 AI reply:", replyText);

                // Send AI text FIRST (browser handles TTS via SpeechSynthesis)
                ws.send(JSON.stringify({ type: "ai_text", text: replyText }));
                console.log("📤 Sent ai_text to browser");
            } catch (err) {
                // Log full error details for debugging
                const errorDetails = err.statusCode ?
                    `Status code: ${err.statusCode}\n${err.message}` :
                    err.message;

                console.error("❌ Error processing audio:", errorDetails);
                if (err.cause) {
                    console.error("   Caused by:", err.cause.message || err.cause);
                }

                try {
                    // Send user-friendly error message
                    const userMessage = err.statusCode === 403
                        ? "API authentication failed. Please check configuration."
                        : err.message || "An error occurred while processing audio";

                    ws.send(JSON.stringify({
                        type: "error",
                        message: userMessage
                    }));
                } catch (e) {
                    console.error("   Failed to send error to client:", e.message);
                }
            } finally {
                ws._firstChunkAt = null;
            }
        };

        ws.on("message", async(msg) => {
            try {
                const data = JSON.parse(msg.toString());

                if (data.type === "user_audio") {
                    // Store incoming chunk (base64 string → Buffer)
                    try {
                        let buf = null;
                        // Accept multiple formats from different clients:
                        // - base64 string
                        // - Array of byte values (Array<number>)
                        // - Node Buffer serialized ({ type: 'Buffer', data: [...] })
                        if (typeof data.audio === 'string') {
                            buf = Buffer.from(data.audio, 'base64');
                        } else if (Array.isArray(data.audio)) {
                            buf = Buffer.from(data.audio);
                        } else if (data.audio && data.audio.type === 'Buffer' && Array.isArray(data.audio.data)) {
                            buf = Buffer.from(data.audio.data);
                        } else {
                            console.warn('⚠ Unsupported audio chunk format received');
                        }

                        if (buf && buf.length) {
                            ws._audioChunks.push(buf);
                        } else {
                            console.warn('⚠ Dropped empty/invalid audio chunk');
                        }
                    } catch (e) {
                        console.warn("⚠ Failed to decode audio chunk as base64");
                    }

                    const now = Date.now();
                    if (!ws._firstChunkAt) ws._firstChunkAt = now;

                    // Debounce: wait 700ms after last chunk
                    if (ws._audioTimer) clearTimeout(ws._audioTimer);
                    ws._audioTimer = setTimeout(processBufferedAudio, 700);

                    // Max wait: process after 5s from first chunk
                    if (!ws._maxTimer) {
                        ws._maxTimer = setTimeout(processBufferedAudio, 5000);
                    }

                    console.log("🎧 Received audio chunk (buffered)");
                } else if (data.type === "user_audio_end") {
                    console.log("🔔 Received audio end signal");
                    // Process remaining chunks, but validate they're processable
                    const remainingChunks = ws._audioChunks || [];
                    if (remainingChunks.length > 0) {
                        // Check if remaining chunks have any WebM structure
                        const hasStructure = remainingChunks.some(chunk => {
                            if (!chunk || chunk.length < 4) return false;
                            // Check for WebM/Matroska element IDs
                            const firstByte = chunk[0];
                            return firstByte === 0x1a || // EBML
                                firstByte === 0x45 || // Partial EBML
                                firstByte === 0x43 || // Cluster
                                firstByte === 0x1f || // BlockGroup
                                (firstByte >= 0x80 && firstByte <= 0xFE); // Matroska element range
                        });

                        if (!hasStructure && remainingChunks.length < 3) {
                            console.warn("⚠ Remaining chunks after audio_end are likely fragments without structure, skipping...");
                            ws._audioChunks = []; // Clear them
                            return;
                        }
                    }
                    await processBufferedAudio();
                }
            } catch (err) {
                console.error("❌ WS error:", err.message);
            }
        });

        ws.on("close", () => {
            console.log("🔴 Client disconnected");

            if (ws._audioTimer) {
                clearTimeout(ws._audioTimer);
                ws._audioTimer = null;
            }
            if (ws._maxTimer) {
                clearTimeout(ws._maxTimer);
                ws._maxTimer = null;
            }

            if (ws._audioChunks && ws._audioChunks.length) {
                // Fire-and-forget processing on disconnect
                process.nextTick(() => {
                    (async() => {
                        try {
                            const chunks = ws._audioChunks;
                            ws._audioChunks = [];

                            // Validate chunks before processing on disconnect
                            const validChunks = chunks.filter(chunk => {
                                if (!chunk || !Buffer.isBuffer(chunk)) return false;
                                return chunk.length >= 50;
                            });

                            if (!validChunks.length) {
                                console.log("⚠ No valid chunks to process on disconnect");
                                return;
                            }

                            const userText = await handleSTT(validChunks);
                            const replyText = await handleLLM(userText);

                            try {
                                // Send text only - browser handles TTS
                                ws.send(JSON.stringify({ type: "ai_text", text: replyText }));
                            } catch (e) {}
                        } catch (e) {
                            // ignore errors during disconnect
                        }
                    })();
                });
            }
        });
    });
}