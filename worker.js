// --- FIX: Tvingar Node att använda IPv4 ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, generateDependencyReport, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

console.log("=== 🛠️ CASSIA LIVE VOICE-STREAM ENGINE (UPGRADED) ===");
console.log(generateDependencyReport());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'nf4MCGNSdM0hxM95ZBQR';
const TARGET_CHANNEL_ID = '1505695523594698776';
const SILENCE_TIMEOUT = 2500;

// Vi skapar en global spelare så att röstmottagningen inte krockar eller kraschar
const audioPlayer = createAudioPlayer();

// --- Voice Logic ---
client.once('ready', async () => {
    console.log(`[🤖] Cassia online som ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
        if (channel && channel.isVoiceBased()) {
            const connection = joinVoiceChannel({ 
                channelId: channel.id, 
                guildId: channel.guild.id, 
                adapterCreator: channel.guild.voiceAdapterCreator 
            });
            connection.subscribe(audioPlayer);
            
            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log(`[✅] Ansluten till röstkanal och redo att lyssna`);
                setupVoiceReceiver(connection);
            });
        }
    } catch (e) { console.error('[❌] Fel vid anslutning:', e.message); }
});

function createWavHeader(dataLength) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(48000, 24); header.writeUInt32LE(48000 * 2 * 2, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(dataLength, 40);
    return header;
}

function isAudioSignificant(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 100) {
        sum += Math.abs(buffer.readInt16LE(Math.min(i, buffer.length - 2)));
    }
    const avg = sum / (buffer.length / 100);
    const scaled = avg * 4;
    return scaled > 1000;
}

function setupVoiceReceiver(connection) {
    const receiver = connection.receiver;
    const activeStreams = new Map();
    
    receiver.speaking.on('start', (userId) => {
        if (userId === client.user.id || activeStreams.has(userId)) return;
        activeStreams.set(userId, true);
        
        const audioStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_TIMEOUT }});
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2 });
        const pcmChunks = [];
        
        audioStream.pipe(decoder).on('data', (c) => pcmChunks.push(c)).on('end', async () => {
            activeStreams.delete(userId);
            const pcmBuffer = Buffer.concat(pcmChunks);
            if (pcmBuffer.length < 150000) return;
            
            if (!isAudioSignificant(pcmBuffer)) {
                console.log(`[🔇] Brus detekterat - ignorerar sändning.`);
                return;
            }

            // Skicka ljudet till n8n för att trigga Grok
            await sendToN8nSatellit(Buffer.concat([createWavHeader(pcmBuffer.length), pcmBuffer]), userId, connection);
        });
    });
}

// --- ÄNDRAD FUNKTION: Hanterar text till realtids-röstström ---
async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        console.log(`[📡] Skickar ljud till n8n, väntar på Groks råa svar...`);
        
        // 1. Skicka din röst (.wav) till n8n. Notera att vi förväntar oss JSON-text tillbaka nu (inte arraybuffer)
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: { 
                'Content-Type': 'audio/wav', 
                'X-Channel-ID': TARGET_CHANNEL_ID, 
                'X-User-ID': userId 
            },
            responseType: 'json' // Ändrat från arraybuffer till json för att ta emot text
        });

        // --- SKOTTSÄKER TEXTHÄMTNING ---
        let grokTextReply = "";

        if (response.data) {
            if (typeof response.data === 'string') {
                grokTextReply = response.data; // n8n skickade ren text
            } else if (typeof response.data === 'object') {
                // Kollar alla vanliga fält, inklusive om n8n skickade det som en array [0]
                const dataObj = Array.isArray(response.data) ? response.data[0] : response.data;
                grokTextReply = dataObj?.text || dataObj?.output || dataObj?.response || dataObj?.clean_text || JSON.stringify(dataObj);
            }
        }

        console.log("[🔍] Detekterad text från n8n:", grokTextReply.substring(0, 50));

        if (!grokTextReply || grokTextReply === "{}" || grokTextReply === "[]") {
            console.log("[⚠️] n8n svarade, men vi kunde inte extrahera någon giltig text. Råsvar:", JSON.stringify(response.data));
            return;
        }

        // Lägg till dramatiska mikro-pauser för råa, explicita berättelser och svordomar
        const formateradText = grokTextReply
            .replace(/,/g, ', ...')
            .replace(/\!/g, '! ...')
            .replace(/\?/g, '? ...');

        console.log(`[🎙️] Strömmar live från ElevenLabs: "${formateradText.substring(0, 40)}..."`);

        // Sätter ihop länken säkert i egna variabler för att dölja den från app-avbrott
        const startAvLänk = "https://api." + "elevenlabs.io";
        const mittenAvLänk = "/v1/text" + "-to-speech/";
        const helaElevenLabsUrl = startAvLänk + mittenAvLänk + ELEVENLABS_VOICE_ID + "/stream";

        // 2. Öppna en direkt realtidsström mot ElevenLabs med dina ocensurerade röstinställningar
        const elevenLabsResponse = await axios({
            method: 'post',
            url: helaElevenLabsUrl,
            data: {
                text: formateradText,
                model_id: "eleven_turbo_v2_5", // Din supersnabba modell från n8n
                voice_settings: { 
                    stability: 0.35,          // Sänkt för max rå inlevelse och känsla
                    similarity_boost: 0.85,    // Högt så rösten inte sviktar vid grova ord
                    style: 0.15,
                    use_speaker_boost: true
                }
            },
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'accept': '*/*',
                'content-type': 'application/json'
            },
            responseType: 'stream' // Strömmar rådata live direkt i kanalen
        });

        const resource = createAudioResource(elevenLabsResponse.data, {
            inputType: StreamType.Arbitrary
        });

        // Spela upp ljudet live till dig utan att avbryta röstmottagningen
        audioPlayer.play(resource);

    } catch (e) { 
        console.error('[❌] Fel i röstströmmen/n8n-anropet:', e.message); 
    }
}

client.login(process.env.DISCORD_TOKEN);
