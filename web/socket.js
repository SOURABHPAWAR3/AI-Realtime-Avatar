// web/socket.js
// Minimal client WebSocket helper

export function createSocket(url, onMessage) {
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
        console.log('🟢 WS connected');
    });

    ws.addEventListener('message', (ev) => {
        try {
            const data = JSON.parse(ev.data);
            onMessage(data);
        } catch (e) {
            console.error('❌ WS parse error', e);
        }
    });

    ws.addEventListener('close', () => {
        console.log('🔴 WS closed');
    });

    ws.addEventListener('error', (err) => {
        console.error('❌ WS error', err);
    });

    return ws;
}