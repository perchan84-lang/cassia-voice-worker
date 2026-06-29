// --- FIX: Tvingar Node att använda IPv4 ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, generateDependencyReport, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

console.log("=== 🛠️ CASSIA LIVE BILINGUAL VOICE-STREAM ENGINE ===");
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

            await sendToN8nSatellit(Buffer.concat([createWavHeader(pcmBuffer.length), pcmBuffer]), userId, connection);
        });
    });
}

// --- Hanterar text till realtids-röstström ---
async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        console.log(`[📡] Skickar ljud till n8n, väntar på Groks svar...`);
        
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: { 
                'Content-Type': 'audio/wav', 
                'X-Channel-ID': TARGET_CHANNEL_ID, 
                'X-User-ID': userId 
            },
            responseType: 'json'
        });

        let grokTextReply = "";
        if (response.data) {
            if (typeof response.data === 'string') {
                grokTextReply = response.data;
            } else if (typeof response.data === 'object') {
                const dataObj = Array.isArray(response.data) ? response.data : response.data;
                grokTextReply = dataObj?.text || dataObj?.output || dataObj?.response || dataObj?.clean_text || JSON.stringify(dataObj);
            }
        }

        console.log("[🔍] Detekterad text från n8n:", grokTextReply.substring(0, 50));

        if (!grokTextReply || grokTextReply === "{}" || grokTextReply === "[]") {
            return;
        }

        // --- DYNAMISK SPRÅKDETEKTERING ---
        // Letar efter de 15 vanligaste svenska orden. Hittas inget, kör vi engelska.
        const vanligaSvenskaOrd = /\b(och|att|det|i|på|en|ett|är|jag|ska|med|inte|om|men|eller)\b/i;
        const ärSvenska = vanligaSvenskaOrd.test(grokTextReply);

        let anpassadeInställningar = {};

        if (ärSvenska) {
            console.log("[🇸🇪] Svenska detekterat. Tvingar hög röststabilitet.");
            anpassadeInställningar = {
                stability: 0.65,          // Tar bort den amerikanska brytningen helt
                similarity_boost: 0.90,    // Håller kvar den svenska röstkaraktären
                style: 0.0,
                use_speaker_boost: true
            };
        } else {
            console.log("[🇬🇧] Engelska detekterat. Öppnar upp för mer inlevelse.");
            anpassadeInställningar = {
                stability: 0.45,          // Lägre stabilitet ger fantastisk inlevelse och känslor på engelska
                similarity_boost: 0.85,
                style: 0.10,
                use_speaker_boost: true
            };
        }

        const startAvLänk = "https://api." + "elevenlabs.io";
        const mittenAvLänk = "/v1/text" + "-to-speech/";
        const helaElevenLabsUrl = startAvLänk + mittenAvLänk + ELEVENLABS_VOICE_ID + "/stream";

        const elevenLabsResponse = await axios({
            method: 'post',
            url: helaElevenLabsUrl,
            data: {
                text: grokTextReply,
                model_id: "eleven_multilingual_v2", // Denna modell krävs för att köra flera språk live
                voice_settings: anpassadeInställningar
            },
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'accept': '*/*',
                'content-type': 'application/json'
            },
            responseType: 'stream'
        });

        const resource = createAudioResource(elevenLabsResponse.data, {
            inputType: StreamType.Arbitrary
        });

        audioPlayer.play(resource);

    } catch (e) { 
        console.error('[❌] Fel i röstströmmen/n8n-anropet:', e.message); 
    }
}

client.login(process.env.DISCORD_TOKEN);
