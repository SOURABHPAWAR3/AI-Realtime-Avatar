import StreamingAvatar, { AvatarQuality, StreamingEvents } from "https://esm.sh/@heygen/streaming-avatar";

let avatar = null;

export async function initAvatar(container) {
    // Fetch secure token from backend
    const tokenRes = await fetch('/heygen-token');
    const { token } = await tokenRes.json();

    avatar = new StreamingAvatar({ token });

    // Listen for stream ready event
    avatar.on(StreamingEvents.STREAM_READY, (event) => {
        console.log("🎥 Stream ready");
        if (event.detail && container) {
            // Attach video element to container
            const videoEl = event.detail;
            videoEl.style.width = "100%";
            videoEl.style.height = "100%";
            videoEl.style.objectFit = "cover";
            container.innerHTML = "";
            container.appendChild(videoEl);
        }
    });

    avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("🔴 Stream disconnected");
    });

    // Start the avatar session
    await avatar.createStartAvatar({
        avatarName: "Abigail_expressive_2024112501", // change if needed
        quality: AvatarQuality.Medium,
        voice: {
            rate: 1.0,
            emotion: "friendly"
        }
    });

    console.log("🧑‍💻 HeyGen Streaming Avatar started");

    return avatar;
}

// Function to make avatar speak
export async function speakText(text) {
    if (avatar) {
        await avatar.speak({ text });
    }
}