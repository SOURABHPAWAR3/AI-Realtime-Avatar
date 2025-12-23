import fetch from 'node-fetch';

export async function getHeyGenToken() {
    const apiKey = process.env.HEYGEN_API_KEY;
    
    if (!apiKey) {
        throw new Error('HEYGEN_API_KEY is not set. Please add it to your .env file.');
    }

    const res = await fetch('https://api.heygen.com/v1/streaming.create_token', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await res.json();

    if (!res.ok) {
        const errorMsg = data?.error?.message || data?.message || `HTTP ${res.status}`;
        throw new Error(`HeyGen API error: ${errorMsg}`);
    }

    if (!data?.data?.token) {
        throw new Error('HeyGen API returned invalid response (no token)');
    }

    return data.data.token;
}