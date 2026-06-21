// --- FIX: Tvingar Node att använda IPv4 för att kringgå Railways IPv6 UDP-blockering ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, generateDependencyReport } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

console.log("=== 🛠️ CASSIA VOICE ENGINE DIAGNOSTIK ===");
console.log(generateDependencyReport());
console.log("=========================================");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const SILENCE_TIMEOUT = 2500;
const TARGET_CHANNEL_ID = '1505695523594698776'; 

client.on('error', (error) => {
    console.error(`[🚨 CLIENT ERROR] ${error.message}`);
});

client.on('ready', async () => {
    console.log(`[🤖] Voice Worker online som ${client.user.tag}`);

    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);

    if (channel && channel.isVoiceBased()) {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        connection.on('error', (error) => {
            console.error(`[🚨 UDP ERROR] ${error.message}`);
        });

        connection.on('stateChange', (oldState, newState) => {
            console.log(`[🔄] Anslutningsstatus ändrades från ${oldState.status} till ${newState.status}`);
        });

        let isEarsAttached = false;

        connection.on(VoiceConnectionStatus.Ready, () => {
            if (!isEarsAttached) {
                console.log(`[🔊] Cassia är ansluten och väntar i: ${channel.name}`);
                setupVoiceReceiver(connection);
                isEarsAttached = true;
            }
        });
    } else {
        console.error('[❌] Kunde inte hitta röstkanalen.');
    }
});

function createWavHeader(dataLength) {
    const sampleRate = 48000;
    const numChannels = 2;
    const bitDepth = 16;
    
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); 
    header.writeUInt16LE(1, 20); 
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28); 
    header.writeUInt16LE(numChannels * (bitDepth / 8), 32); 
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
}

function setupVoiceReceiver(connection) {
    const receiver = connection.receiver;
    
    const activeStreams = new Map();

    receiver.speaking.on('start', (userId) => {
        if (userId === client.user.id) return;
        if (activeStreams.has(userId)) return;

        console.log(`[🎙️] Användare ${userId} pratar...`);
        activeStreams.set(userId, true);
        
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: SILENCE_TIMEOUT,
            },
        });

        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2 });
        const pcmChunks = [];

        audioStream.pipe(decoder);

        decoder.on('data', (chunk) => {
            pcmChunks.push(chunk);
        });

        decoder.on('end', async () => {
            activeStreams.delete(userId);
            
            const pcmBuffer = Buffer.concat(pcmChunks);
            
            if (pcmBuffer.length < 150000) {
                console.log(`[🔇] Ljud för kort (${pcmBuffer.length} bytes). Klassas som brus/knäpp och ignoreras.`);
                return; 
            }

            console.log(`[🛑] Tystnad detekterad. Processar ${pcmBuffer.length} bytes röstdata...`);

            const wavHeader = createWavHeader(pcmBuffer.length);
            const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

            await sendToN8nSatellit(wavBuffer, userId, connection);
        });
    });
}

async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        console.log(`[🚀] Skickar formaterat WAV-ljud till n8n med metadata i headers...`);
        
        // --- FIX: Metadata flyttad till headers för att kringgå att params strippas av Railway/n8n ---
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: {
                'Content-Type': 'audio/wav',
                'Content-Disposition': 'attachment; filename="audio.wav"',
                'X-Channel-ID': TARGET_CHANNEL_ID,
                'X-User-ID': userId
            },
            responseType: 'arraybuffer' 
        });

        console.log('[✅] Fick svar från n8n. Spelar upp ljudet...');
        
        const audioPlayer = createAudioPlayer();
        const stream = Readable.from(response.data);
        const resource = createAudioResource(stream);
        
        connection.subscribe(audioPlayer);
        audioPlayer.play(resource);

        audioPlayer.on(AudioPlayerStatus.Idle, () => {
            console.log('[🛑] Cassia har pratat klart, väntar på ny input...');
        });

    } catch (error) {
        console.error('[❌] Något gick fel vid anropet till n8n:', error.message);
    }
}

client.login(process.env.DISCORD_TOKEN);
