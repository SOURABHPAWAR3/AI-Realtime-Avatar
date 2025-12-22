// web/audio.js
// Browser TTS (SpeechSynthesis) + Mic streaming to server

import { createSocket } from './socket.js';

/* =========================
   🔊 BROWSER TTS (SpeechSynthesis)
========================= */

let speaking = false;

function speak(text) {
    if (!text) return;

    // Stop previous speech if any
    if (speaking) {
        window.speechSynthesis.cancel();
        speaking = false;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
        speaking = true;
        console.log('🔊 Speaking...');
    };

    utterance.onend = () => {
        speaking = false;
        console.log('✅ Speech finished');
    };

    utterance.onerror = (e) => {
        speaking = false;
        console.error('❌ Speech error:', e.error);
    };

    window.speechSynthesis.speak(utterance);
}

/* =========================
   🎤 MIC STREAMING CLIENT
========================= */

export function startClient(wsUrl, avatarInstance) {
    const ws = createSocket(wsUrl, (msg) => {
        console.log('📩 WS message:', msg);

        // 🔥 SERVER TEXT RESPONSE
        if (msg.type === 'ai_text') {
            const reply = msg.text;

            // 1️⃣ Speak via browser SpeechSynthesis
            speak(reply);

            // 2️⃣ Send text to HeyGen Avatar (if available)
            if (avatarInstance && typeof avatarInstance.sendMessage === 'function') {
                avatarInstance.sendMessage(reply);
            }
        }

        // Handle errors from server
        if (msg.type === 'error') {
            console.error('❌ Server error:', msg.message);
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
