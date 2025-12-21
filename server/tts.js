import { ElevenLabsClient } from "elevenlabs";
import fs from "fs";

let elevenlabs = null;

function getElevenLabsClient() {
    if (elevenlabs) return elevenlabs;
    
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new Error(
            "Missing ELEVENLABS_API_KEY. Set it in your environment or in a .env file (ELEVENLABS_API_KEY=...)"
        );
    }
    
    elevenlabs = new ElevenLabsClient({
        apiKey: apiKey,
    });
    
    return elevenlabs;
}

export async function handleTTS(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Invalid text input for TTS: text must be a non-empty string');
    }

    const client = getElevenLabsClient();
    let voiceId = process.env.ELEVENLABS_VOICE_ID || "Rachel"; // Default to Rachel, but allow override
    
    // Common ElevenLabs voice IDs that are usually available
    const fallbackVoices = ["21m00Tcm4TlvDq8ikWAM", "AZnzlk1XvdvUeBnXmlld", "EXAVITQu4vr4xnSDxMaL"];
    
    try {
        let audioStream;
        let lastError = null;
        
        // Try with the specified voice first
        try {
            audioStream = await client.textToSpeech.convert(
                voiceId,
                {
                    text: text.trim(),
                    model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
                    output_format: process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3",
                }
            );
        } catch (firstError) {
            // If 403 and using default "Rachel", try to use a voice ID instead
            const is403 = firstError.status === 403 || firstError.statusCode === 403 || 
                         (firstError.response && firstError.response.status === 403);
            
            if (is403 && voiceId === "Rachel" && !process.env.ELEVENLABS_VOICE_ID) {
                console.warn('⚠ Voice "Rachel" not found, trying fallback voice IDs...');
                lastError = firstError;
                
                // Try fallback voices
                for (const fallbackVoiceId of fallbackVoices) {
                    try {
                        console.log(`🔄 Trying fallback voice: ${fallbackVoiceId}`);
                        audioStream = await client.textToSpeech.convert(
                            fallbackVoiceId,
                            {
                                text: text.trim(),
                                model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
                                output_format: process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3",
                            }
                        );
                        console.log(`✅ Successfully used fallback voice: ${fallbackVoiceId}`);
                        break; // Success, exit loop
                    } catch (fallbackError) {
                        lastError = fallbackError;
                        continue; // Try next fallback
                    }
                }
                
                // If all fallbacks failed, throw the last error
                if (!audioStream) {
                    throw lastError || firstError;
                }
            } else {
                // Not a 403 with default voice, or voice was explicitly set - throw original error
                throw firstError;
            }
        }
        
        // Ensure we have an audio stream
        if (!audioStream) {
            throw new Error('Failed to obtain audio stream from ElevenLabs');
        }

        const chunks = [];
        for await (const chunk of audioStream) {
            chunks.push(chunk);
        }

        if (chunks.length === 0) {
            throw new Error('No audio data received from ElevenLabs');
        }

        return Buffer.concat(chunks);
    } catch (err) {
        // Build a more informative error message
        let errorMessage = err.message || String(err);
        let statusCode = null;
        
        // Check for HTTP status codes in various error formats
        if (err.status) {
            statusCode = err.status;
        } else if (err.statusCode) {
            statusCode = err.statusCode;
        } else if (err.response) {
            statusCode = err.response.status || err.response.statusCode;
        }
        
        if (statusCode === 403) {
            errorMessage = `ElevenLabs API returned 403 Forbidden. This usually means:
- Invalid or expired API key (check ELEVENLABS_API_KEY)
- Insufficient API credits/quota
- Invalid voice ID: "${voiceId}" (check ELEVENLABS_VOICE_ID or use a valid voice name)
- API endpoint access denied`;
        } else if (statusCode === 401) {
            errorMessage = `ElevenLabs API returned 401 Unauthorized. Check your ELEVENLABS_API_KEY.`;
        } else if (statusCode === 429) {
            errorMessage = `ElevenLabs API returned 429 Too Many Requests. Rate limit exceeded, please wait before retrying.`;
        } else if (statusCode) {
            errorMessage = `ElevenLabs API error (Status ${statusCode}): ${errorMessage}`;
        }
        
        // Include original error details if available
        if (err.response && err.response.data) {
            const body = typeof err.response.data === 'string' 
                ? err.response.data 
                : JSON.stringify(err.response.data);
            errorMessage += `\nResponse body: ${body}`;
        }
        
        const enhancedError = new Error(`Error during TTS: ${errorMessage}`);
        enhancedError.cause = err;
        enhancedError.statusCode = statusCode;
        throw enhancedError;
    }
}