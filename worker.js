const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const SILENCE_TIMEOUT = 2500; // Tid i millisekunder av tystnad innan sändning triggas

client.on('ready', () => {
    console.log(`[🤖] Voice Worker online som ${client.user.tag}`);
});

// Trigger för att ansluta botten till kanalen (t.ex. via ett textkommando "!join")
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!join') {
        const channel = message.member?.voice.channel;
        if (!channel) {
            return message.reply('Du måste sitta i en röstkanal, Sir.');
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`[🔊] Ansluten till röstkanalen: ${channel.name}`);
            message.reply('Jag lyssnar nu live, Sir.');
            
            // Starta lyssnar-motorn på anslutningen
            setupVoiceReceiver(connection);
        });
    }
});

function setupVoiceReceiver(connection) {
    const receiver = connection.receiver;

    // Trigger när en användare börjar prata
    receiver.speaking.on('start', (userId) => {
        console.log(`[🎙️] Användare ${userId} pratar...`);
        
        // Prenumerera på användarens ljudström (PCM, 48kHz, Stereo)
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: SILENCE_TIMEOUT,
            },
        });

        // Avkoda Opus till rå PCM för stabilare hantering och konvertering
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2 });
        const pcmChunks = [];

        audioStream.pipe(decoder);

        decoder.on('data', (chunk) => {
            pcmChunks.push(chunk);
        });

        decoder.on('end', async () => {
            console.log(`[🛑] Tystnad detekterad för ${userId}. Processar ljudbuffert...`);
            const buffer = Buffer.concat(pcmChunks);
            
            if (buffer.length < 1000) {
                console.log('[⚠️] Bufferten för kort, ignorerar (förmodligen bara bakgrundsbrus).');
                return;
            }

            await sendToN8nSatellit(buffer, userId);
        });

        decoder.on('error', (err) => {
            console.error('[❌] Fel i ljud-dekodern:', err);
        });
    });
}

async function sendToN8nSatellit(pcmBuffer, userId) {
    try {
        console.log(`[🚀] Skickar ${pcmBuffer.length} bytes röstdata till n8n...`);
        
        // Vi skickar rå PCM binärt. n8n tar emot det som ett binärt filobjekt.
        const response = await axios.post(N8N_WEBHOOK_URL, pcmBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Discord-User': userId,
                'X-Audio-Format': 'pcm-48000-stereo'
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('[✅] n8n tog emot ljudströmmen. Svar:', response.data);
    } catch (error) {
        console.error('[❌] Misslyckades att leverera röstdata till n8n:', error.message);
    }
}

client.login(process.env.DISCORD_TOKEN);