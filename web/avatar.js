import LiveAvatar from "https://unpkg.com/@heygen/liveavatar-web-sdk";

export async function initAvatar(container) {
    // Fetch secure token from backend
    const tokenRes = await fetch('/heygen-token');
    const { token } = await tokenRes.json();

    const avatar = new LiveAvatar({
        token,
        avatarId: "Abigail_expressive_2024112501", // change if needed
        container,
        voice: {
            rate: 1.0,
            emotion: "friendly"
        }
    });

    await avatar.start();
    console.log("🧑‍💻 HeyGen Live Avatar started");

    return avatar;
}