// web/audio.js
// Handles microphone streaming + AI audio playback

import { createSocket } from './socket.js';

/* =========================
   🔊 AI AUDIO PLAYBACK
========================= */

function playAIAudio(base64Audio) {
    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);

    audio.onplay = () => console.log('🔊 Playing AI audio');
    audio.onerror = (e) => console.error('❌ Audio playback error', e);

    audio.play().catch(err => {
        console.error('❌ Autoplay blocked:', err);
    });
}

/* =========================
   🎤 MIC STREAMING CLIENT
========================= */

export function startClient(wsUrl) {
    const ws = createSocket(wsUrl, (msg) => {
        console.log('📩 WS message:', msg);

        // 🔥 AI AUDIO COMES HERE
        if (msg.type === 'ai_audio' && msg.audio) {
            playAIAudio(msg.audio);
        }

        // Optional text logging
        if (msg.type === 'ai_text') {
            console.log('🤖 AI:', msg.text);
        }
    });

    let mediaRecorder;

    async function startMic() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });

        mediaRecorder.addEventListener('dataavailable', (e) => {
            if (!e.data || e.data.size === 0) return;

            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                ws.send(JSON.stringify({
                    type: 'user_audio',
                    audio: base64
                }));
                console.log('🎧 Sent audio chunk');
            };
            reader.readAsDataURL(e.data);
        });

        mediaRecorder.start(250); // 250ms chunks
        console.log('🎤 Mic started');
    }

    function stopMic() {
        if (!mediaRecorder) return;

        mediaRecorder.stop();

        setTimeout(() => {
            ws.send(JSON.stringify({ type: 'user_audio_end' }));
            console.log('🔔 Sent user_audio_end');
        }, 400);
    }

    return { ws, startMic, stopMic };
}