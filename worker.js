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

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`[🔊] Cassia är ansluten och väntar i: ${channel.name}`);
            setupVoiceReceiver(connection);
        });
    } else {
        console.error('[❌] Kunde inte hitta röstkanalen.');
    }
});

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
            const buffer = Buffer.concat(pcmChunks);
            
            if (buffer.length < 1000) {
                return; // Ignorera korta brus
            }

            // Skickar ljudet och väntar på svar från n8n (ElevenLabs)
            await sendToN8nSatellit(buffer, userId, connection);
        });
    });
}

async function sendToN8nSatellit(pcmBuffer, userId, connection) {
    try {
        console.log(`[🚀] Skickar ljud till n8n...`);
        
        const response = await axios.post(N8N_WEBHOOK_URL, pcmBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream'
            },
            responseType: 'arraybuffer' // Viktigt: Säger åt axios att vi väntar oss en binär ljudfil tillbaka
        });

        console.log('[✅] Fick svar från n8n (ElevenLabs). Spelar upp ljudet...');
        
        // --- NY LOGIK: SPELA UPP LJUDSVARET ---
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
