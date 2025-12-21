import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import OpenAI from "openai";

ffmpeg.setFfmpegPath(ffmpegPath);

let openaiClient = null;

function getOpenAIClient() {
    if (openaiClient) return openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error(
            "Missing OPENAI_API_KEY. Set it in your environment or in a .env file (OPENAI_API_KEY=...)"
        );
    }
    openaiClient = new OpenAI({ apiKey });
    return openaiClient;
}

export async function handleSTT(rawAudioBuffer) {
    // Create unique temp filenames to avoid races across rapid requests
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wavPath = path.join(`temp-output-${id}.wav`);

    // If caller passed an array of Buffer chunks (recommended), we'll
    // transcode each chunk separately to raw PCM and concatenate safely.
    let totalBytes = 0;
    const isArray = Array.isArray(rawAudioBuffer);
    if (isArray) {
        totalBytes = rawAudioBuffer.reduce((s, b) => s + (b ? b.length : 0), 0);
    } else if (rawAudioBuffer && rawAudioBuffer.length) {
        totalBytes = rawAudioBuffer.length;
    }

    console.log(`🗂️ Received audio (${isArray ? 'chunks' : 'buffer'}): ${totalBytes} bytes`);

    let inputPath = null;
    try {
        if (isArray) {
            // MediaRecorder sends WebM fragments where only the first chunk has the EBML header.
            // Subsequent chunks are continuation fragments. We need to concatenate all chunks
            // into a single WebM file before processing, not process them individually.
            
            // Filter out empty chunks
            const validChunks = rawAudioBuffer.filter(buf => buf && buf.length > 0);
            
            if (!validChunks.length) {
                throw new Error('No valid audio chunks to process');
            }
            
            // Find which chunk has the EBML header (should be the first one from MediaRecorder)
            const EBML_FULL = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
            const EBML_PARTIAL = Buffer.from([0x45, 0xdf, 0xa3]); // Missing the 0x1a byte
            let headerChunkIndex = -1;
            let orderedChunks = [];
            let needsHeaderPrepend = false;
            
            // Debug: Check first few bytes of first chunk
            if (validChunks.length > 0 && validChunks[0].length > 0) {
                const firstBytes = validChunks[0].slice(0, Math.min(20, validChunks[0].length));
                console.log(`🔍 First chunk preview (${validChunks[0].length} bytes):`, firstBytes.toString('hex').substring(0, 40));
            }
            
            // First, try to find a chunk with complete EBML header
            for (let i = 0; i < validChunks.length; i++) {
                const ebmlIndex = validChunks[i].indexOf(EBML_FULL);
                if (ebmlIndex !== -1) {
                    headerChunkIndex = i;
                    console.log(`✅ Found complete EBML header in chunk ${i} at offset ${ebmlIndex}`);
                    // If EBML is not at the start, trim leading bytes
                    if (ebmlIndex > 0) {
                        console.warn(`⚠ Trimming ${ebmlIndex} bytes from chunk ${i} before EBML header`);
                        orderedChunks.push(validChunks[i].slice(ebmlIndex));
                    } else {
                        orderedChunks.push(validChunks[i]);
                    }
                    // Add remaining chunks after the header chunk (in order)
                    for (let j = i + 1; j < validChunks.length; j++) {
                        orderedChunks.push(validChunks[j]);
                    }
                    // Add chunks before the header chunk (shouldn't happen, but handle it)
                    for (let j = 0; j < i; j++) {
                        orderedChunks.push(validChunks[j]);
                    }
                    break;
                }
            }
            
            // If no complete header found, check for partial EBML header (missing 0x1a)
            if (headerChunkIndex === -1) {
                for (let i = 0; i < validChunks.length; i++) {
                    const partialIndex = validChunks[i].indexOf(EBML_PARTIAL);
                    if (partialIndex !== -1 && partialIndex === 0) {
                        // Found partial header at the start - prepend 0x1a
                        console.log(`✅ Found partial EBML header in chunk ${i} (missing 0x1a), will prepend it`);
                        headerChunkIndex = i;
                        const fixedChunk = Buffer.concat([Buffer.from([0x1a]), validChunks[i]]);
                        orderedChunks.push(fixedChunk);
                        // Add remaining chunks after the header chunk
                        for (let j = i + 1; j < validChunks.length; j++) {
                            orderedChunks.push(validChunks[j]);
                        }
                        // Add chunks before the header chunk
                        for (let j = 0; j < i; j++) {
                            orderedChunks.push(validChunks[j]);
                        }
                        break;
                    }
                }
            }
            
            // If still no header found, check if first chunk starts with partial pattern
            if (headerChunkIndex === -1 && validChunks.length > 0) {
                const firstChunk = validChunks[0];
                if (firstChunk.length >= 3 && 
                    firstChunk[0] === 0x45 && 
                    firstChunk[1] === 0xdf && 
                    firstChunk[2] === 0xa3) {
                    console.log('✅ First chunk starts with partial EBML pattern, prepending 0x1a');
                    const fixedFirstChunk = Buffer.concat([Buffer.from([0x1a]), firstChunk]);
                    orderedChunks = [fixedFirstChunk, ...validChunks.slice(1)];
                    headerChunkIndex = 0;
                } else {
                    console.warn('⚠ No EBML header found in any chunk - MediaRecorder may have sent fragments only');
                    console.warn(`   Chunk sizes: ${validChunks.map(c => c.length).join(', ')} bytes`);
                    // Try to prepend a minimal WebM header structure
                    console.log('🔧 Attempting to prepend minimal WebM header...');
                    orderedChunks = validChunks;
                    needsHeaderPrepend = true;
                }
            }
            
            // Concatenate all chunks into a single file
            const combinedWebmPath = path.join(`temp-combined-${id}.webm`);
            let combinedBuffer = Buffer.concat(orderedChunks);
            
            console.log(`🗂️ Concatenated ${orderedChunks.length} WebM chunks into single file (${combinedBuffer.length} bytes)`);
            
            // If we need to prepend a header, check if chunks are valid WebM fragments
            // If they're just raw data without structure, we can't process them
            if (needsHeaderPrepend) {
                // Check if the chunks look like WebM fragments (should have some structure)
                // Raw opus data or completely unstructured data can't be processed
                const firstChunkStart = validChunks[0]?.slice(0, 10);
                const hasWebMStructure = firstChunkStart && (
                    firstChunkStart[0] === 0x43 || // Cluster ID
                    firstChunkStart[0] === 0x1f || // BlockGroup ID
                    firstChunkStart[0] === 0x1a || // EBML ID
                    firstChunkStart[0] === 0x45 || // Partial EBML
                    (firstChunkStart[0] >= 0x80 && firstChunkStart[0] <= 0xFE) // Matroska element IDs
                );
                
                if (!hasWebMStructure) {
                    console.warn('⚠ Chunks appear to be raw data fragments without WebM structure');
                    console.warn('   These fragments cannot be processed without a complete WebM header');
                    throw new Error('Invalid audio input: chunks are raw fragments without WebM structure. Cannot process without initialization segment.');
                }
                
                // Create a more complete minimal WebM structure
                // This includes EBML header + Segment header + Tracks (minimal)
                console.log('🔧 Prepending minimal WebM structure...');
                
                // EBML Header
                const ebmlHeader = Buffer.from([
                    0x1a, 0x45, 0xdf, 0xa3, // EBML Header ID
                    0xa3, // Size (27 bytes)
                    0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
                    0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion = 1
                    0x42, 0xf2, 0x81, 0x04, // EBMLMaxIDLength = 4
                    0x42, 0xf3, 0x81, 0x08  // EBMLMaxSizeLength = 8
                ]);
                
                // Segment header (minimal - just the ID, size will be calculated)
                // Segment ID: 0x18538067, but we'll use a simpler approach
                // For now, just prepend EBML header and let ffmpeg handle the rest
                combinedBuffer = Buffer.concat([ebmlHeader, combinedBuffer]);
            }
            
            // Verify the combined buffer has EBML header
            const finalEbmlIndex = combinedBuffer.indexOf(EBML_FULL);
            let hasValidHeader = finalEbmlIndex !== -1;
            
            if (finalEbmlIndex === -1) {
                // Check for partial header one more time
                const partialIndex = combinedBuffer.indexOf(EBML_PARTIAL);
                if (partialIndex === 0) {
                    console.log('🔧 Fixing partial EBML header in final buffer');
                    combinedBuffer = Buffer.concat([Buffer.from([0x1a]), combinedBuffer]);
                    hasValidHeader = true;
                } else {
                    console.warn('⚠ No EBML header found in final combined buffer');
                }
            } else if (finalEbmlIndex > 0) {
                console.warn(`⚠ Trimming ${finalEbmlIndex} bytes before EBML header in final buffer`);
                combinedBuffer = combinedBuffer.slice(finalEbmlIndex);
                hasValidHeader = true;
            } else {
                hasValidHeader = true;
            }
            
            // Write the final buffer
            fs.writeFileSync(combinedWebmPath, combinedBuffer);
            
            if (hasValidHeader) {
                console.log('✅ Final WebM file has valid EBML header');
            } else {
                console.warn('⚠ Final WebM file may be invalid - attempting to process anyway');
            }
            
            inputPath = combinedWebmPath;

            // Convert combined WebM to WAV (Whisper requirement): mono, 16kHz, 16-bit PCM
            // Use additional options to handle potentially incomplete WebM files
            await new Promise((resolve, reject) => {
                let attemptCount = 0;
                const maxAttempts = 4;
                
                const tryProcess = (options, attemptNum) => {
                    attemptCount++;
                    console.log(`🔄 Processing attempt ${attemptNum}/${maxAttempts}...`);
                    
                    let ffmpegCmd = ffmpeg(options.inputFile || combinedWebmPath);
                    
                    // Apply input options
                    if (options.inputOptions && Array.isArray(options.inputOptions)) {
                        ffmpegCmd = ffmpegCmd.inputOptions(options.inputOptions);
                    }
                    
                    // Apply format if specified
                    if (options.inputFormat) {
                        ffmpegCmd = ffmpegCmd.inputFormat(options.inputFormat);
                    }
                    
                    return ffmpegCmd
                        .toFormat('wav')
                        .audioCodec('pcm_s16le')
                        .audioChannels(1)
                        .audioFrequency(16000)
                        .on('start', (cmd) => {
                            if (attemptNum === 1) {
                                console.log('ffmpeg(combined) start:', cmd);
                            } else {
                                console.log(`ffmpeg(attempt ${attemptNum}) start:`, cmd);
                            }
                        })
                        .on('stderr', (line) => {
                            // Filter out common non-critical warnings
                            if (!line.includes('File ended prematurely') && 
                                !line.includes('Estimating duration from bitrate') &&
                                !line.includes('Truncating packet') &&
                                !line.includes('Format matroska,webm detected only with low score') &&
                                !line.includes('Guessed Channel Layout')) {
                                // Only log actual errors
                                if (line.includes('Error') || line.includes('Invalid')) {
                                    console.error(`ffmpeg(attempt ${attemptNum}) stderr:`, line);
                                }
                            }
                        })
                        .on('end', () => {
                            console.log(`✅ Successfully processed audio on attempt ${attemptNum}`);
                            resolve();
                        })
                        .on('error', (err) => {
                            if (attemptCount < maxAttempts) {
                                // Try next approach
                                const nextOptions = [
                                    { 
                                        inputFile: combinedWebmPath,
                                        inputOptions: ['-fflags', '+genpts'] 
                                    },
                                    { 
                                        inputFile: combinedWebmPath,
                                        inputOptions: ['-fflags', '+genpts', '-err_detect', 'ignore_err'] 
                                    },
                                    { 
                                        inputFile: combinedWebmPath,
                                        inputFormat: 'webm',
                                        inputOptions: ['-fflags', '+genpts', '-err_detect', 'ignore_err'] 
                                    },
                                    // Last resort: try with very lenient options
                                    { 
                                        inputFile: combinedWebmPath,
                                        inputOptions: ['-f', 'webm', '-fflags', '+genpts+igndts', '-err_detect', 'ignore_err', '-analyzeduration', '1000000'] 
                                    }
                                ];
                                if (nextOptions[attemptCount]) {
                                    console.warn(`⚠ Attempt ${attemptNum} failed, trying alternative approach...`);
                                    setTimeout(() => tryProcess(nextOptions[attemptCount], attemptCount + 1), 100);
                                } else {
                                    reject(err);
                                }
                            } else {
                                reject(err);
                            }
                        })
                        .save(wavPath);
                };
                
                // Start with standard options
                tryProcess({ 
                    inputFile: combinedWebmPath,
                    inputOptions: ['-fflags', '+genpts'] 
                }, 1);
            });

            // Cleanup combined WebM file
            try {
                if (fs.existsSync(combinedWebmPath)) fs.unlinkSync(combinedWebmPath);
            } catch (e) {}
        } else {
            // Single-buffer path: write and transcode normally
            inputPath = path.join(`temp-input-${id}.webm`);

            // Sanitize / validate input buffer before writing to disk to avoid
            // creating corrupt WebM files that ffmpeg cannot parse.
            // EBML header for WebM/Matroska: 0x1A 0x45 0xDF 0xA3
            const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
            let writeBuffer = rawAudioBuffer;

            const idx = rawAudioBuffer.indexOf(EBML);
            if (idx === -1) {
                console.warn('⚠ No EBML header found in audio buffer; file may not be WebM.');
                // For very small buffers without EBML, reject early
                if (rawAudioBuffer.length < 100) {
                    throw new Error('Invalid audio input: missing WebM EBML header and buffer too small (< 100 bytes)');
                }
                // For larger buffers, try to process anyway (might be a valid fragment)
                console.warn('⚠ Attempting to process buffer without EBML header (may fail)');
            } else if (idx > 0) {
                console.warn(`⚠ Trimming ${idx} bytes of leading data before EBML header`);
                writeBuffer = rawAudioBuffer.slice(idx);
            }

            console.log(`🗂️ Writing audio to ${inputPath} (${writeBuffer.length} bytes)`);
            fs.writeFileSync(inputPath, writeBuffer);

            // Convert to WAV (Whisper requirement): mono, 16kHz, 16-bit PCM
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .toFormat('wav')
                    .audioCodec('pcm_s16le')
                    .audioChannels(1)
                    .audioFrequency(16000)
                    .on('start', (cmd) => console.log('ffmpeg start:', cmd))
                    .on('stderr', (line) => console.error('ffmpeg stderr:', line))
                    .on('end', resolve)
                    .on('error', reject)
                    .save(wavPath);
            });
        }

        // Transcribe with OpenAI Whisper
        const openai = getOpenAIClient();
        try {
            const defaultLanguage = process.env.WHISPER_LANGUAGE || "en";
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(wavPath),
                model: "whisper-1",
                language: defaultLanguage,
                // set additional options if needed for accuracy
            });
            return transcription.text;
        } catch (err) {
            // Build a more informative error message for the client/logs by
            // probing several common error shapes returned by HTTP libraries
            let details = err.message || String(err);

            try {
                // axios-like: err.response.status / err.response.data
                if (err.response && (err.response.status || err.response.statusCode)) {
                    const code = err.response.status || err.response.statusCode;
                    details = `Status code: ${code}`;
                }
                if (err.response && err.response.data) {
                    const body = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
                    details += `\nBody: ${body}`;
                }

                // fetch-like: err.status / err.statusText
                if (!details && (err.status || err.statusCode)) {
                    details = `Status code: ${err.status || err.statusCode}`;
                }

                // openai-js v4/v5 may put JSON in err.body or err.json
                if (err.body) {
                    const b = typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
                    details += `\nBody: ${b}`;
                }
            } catch (e) {
                // ignore any error while building details
            }

            const e2 = new Error(`Error during transcription: ${details}`);
            e2.cause = err;
            throw e2;
        }
    } finally {
        // Best-effort cleanup; ignore errors so we don't mask transcription errors
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        } catch (e) {}
        try {
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
        } catch (e) {}
    }
}