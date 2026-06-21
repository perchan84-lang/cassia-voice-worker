// --- FIX: Tvingar Node att använda IPv4 för att kringgå Railways IPv6 UDP-blockering ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
const express = require('express'); 
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

// --- Röst-endpoint ---
app.post('/speak-now', async (req, res) => {
    if (req.headers['x-api-key'] !== process.env.API_SECRET) return res.status(403).send('Obehörig.');
    try {
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
        let connection = getVoiceConnection(channel.guild.id) || joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator });
        const audioPlayer = createAudioPlayer();
        connection.subscribe(audioPlayer);
        audioPlayer.play(createAudioResource(Readable.from(req.body)));
        res.status(200).send('Audio played');
    } catch (e) { res.status(500).send(e.message); }
});

// --- Text-endpoint ---
app.post('/send-text', async (req, res) => {
    if (req.headers['x-api-key'] !== process.env.API_SECRET) return res.status(403).send('Obehörig.');
    try {
        const { channelId, message } = req.body;
        const channel = await client.channels.fetch(channelId || TARGET_CHANNEL_ID);
        await channel.send(message);
        res.status(200).send('Message sent');
    } catch (e) { res.status(500).send(e.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[🌐] API-lyssnare online på port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TARGET_CHANNEL_ID = '1505695523594698776'; 

client.on('ready', async () => {
    console.log(`[🤖] Voice Worker online som ${client.user.tag}`);
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
    if (channel && channel.isVoiceBased()) {
        const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator });
        connection.on(VoiceConnectionStatus.Ready, () => setupVoiceReceiver(connection));
    }
});

// --- Text-lyssnare ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== TARGET_CHANNEL_ID) return;
    try {
        await axios.post(N8N_WEBHOOK_URL, { user: message.author.username, text: message.content, timestamp: new Date() });
    } catch (e) { console.error('[❌] Fel i text-lyssnare:', e.message); }
});

// --- RÖST-LOGIK ---
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
        if (userId === client.user.id || activeStreams.has(userId)) return;
        activeStreams.set(userId, true);
        const audioStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 2500 }});
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2 });
        const pcmChunks = [];
        audioStream.pipe(decoder).on('data', (c) => pcmChunks.push(c)).on('end', async () => {
            activeStreams.delete(userId);
            const pcmBuffer = Buffer.concat(pcmChunks);
            if (pcmBuffer.length < 150000) return;
            const wavBuffer = Buffer.concat([createWavHeader(pcmBuffer.length), pcmBuffer]);
            await sendToN8nSatellit(wavBuffer, userId, connection);
        });
    });
}

async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: { 'Content-Type': 'audio/wav', 'Content-Disposition': 'attachment; filename="audio.wav"' },
            params: { channel_id: TARGET_CHANNEL_ID, user_id: userId },
            responseType: 'arraybuffer' 
        });
        const audioPlayer = createAudioPlayer();
        audioPlayer.play(createAudioResource(Readable.from(response.data)));
        connection.subscribe(audioPlayer);
    } catch (e) { console.error('[❌] Fel i n8n-anrop:', e.message); }
}

client.login(process.env.DISCORD_TOKEN);
