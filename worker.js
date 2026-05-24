const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const SILENCE_TIMEOUT = 2500;
const TARGET_CHANNEL_ID = '1505695523594698776'; 

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

        // --- NYA DEBUG-LYSSNARE FÖR ATT SLUTA GISSA ---
        connection.on('debug', (message) => {
            console.log(`[🐛 UDP DEBUG] ${message}`);
        });

        connection.on('error', (error) => {
            console.error(`[🚨 UDP ERROR] ${error.message}`);
        });

        connection.on('stateChange', (oldState, newState) => {
            console.log(`[🔄] Anslutningsstatus ändrades från ${oldState.status} till ${newState.status}`);
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`[🔊] Cassia är ansluten och väntar i: ${channel.name}`);
            setupVoiceReceiver(connection);
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

    receiver.speaking.on('start', (userId) => {
        console.log(`[🎙️] Användare ${userId} pratar...`);
        
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
            console.log(`[🛑] Tystnad detekterad. Processar röstdata...`);
            const pcmBuffer = Buffer.concat(pcmChunks);
            
            if (pcmBuffer.length < 1000) {
                return; // Ignorera korta brus
            }

            const wavHeader = createWavHeader(pcmBuffer.length);
            const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

            await sendToN8nSatellit(wavBuffer, userId, connection);
        });
    });
}

async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        console.log(`[🚀] Skickar formaterat WAV-ljud till n8n...`);
        
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: {
                'Content-Type': 'audio/wav',
                'Content-Disposition': 'attachment; filename="audio.wav"'
            },
            responseType: 'arraybuffer' 
        });

        console.log('[✅] Fick svar från n8n (ElevenLabs). Spelar upp ljudet...');
        
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
