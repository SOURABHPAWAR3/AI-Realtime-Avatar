let ws;
let mediaRecorder;
let audioStream;

function connectWS() {
    ws = new WebSocket("ws://localhost:3000");

    ws.onopen = () => console.log("🟢 WS connected");
    ws.onerror = err => console.error("WS error", err);
}

async function startMic() {
    connectWS();

    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);

    mediaRecorder.ondataavailable = async(event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            const arrayBuffer = await event.data.arrayBuffer();
            ws.send(JSON.stringify({
                type: "user_audio",
                audio: Array.from(new Uint8Array(arrayBuffer))
            }));
        }
    };

    // Send audio every 300ms (real-time feeling)
    mediaRecorder.start(300);
    console.log("🎤 Mic started");
}

function stopMic() {
    mediaRecorder.stop();
    audioStream.getTracks().forEach(t => t.stop());
    console.log("🛑 Mic stopped");
}