import fetch from 'node-fetch';

export async function getHeyGenToken() {
    const res = await fetch('https://api.heygen.com/v1/streaming.create_token', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.HEYGEN_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await res.json();
    return data.data.token;
}