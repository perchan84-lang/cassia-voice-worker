// --- FIX: Tvingar Node att använda IPv4 för att kringgå Railways IPv6 UDP-blockering ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, generateDependencyReport } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
const express = require('express'); // Nytt tillägg
require('dotenv').config();

// --- Express-server för att ta emot n8n-anrop ---
const app = express();
app.use(express.raw({ type: '*/*', limit: '10mb' }));

app.post('/speak-now', async (req, res) => {
    try {
        console.log('[📥] Mottog externt röstuppspelningsanrop.');
        const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator
        });

        const audioPlayer = createAudioPlayer();
        const stream = Readable.from(req.body);
        const resource = createAudioResource(stream);
        
        connection.subscribe(audioPlayer);
        audioPlayer.play(resource);
        
        res.status(200).send('Audio played successfully');
    } catch (e) {
        console.error('[❌] Fel i /speak-now:', e);
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[🌐] API-lyssnare online på port ${PORT}`));
// --- Slut på Express-server ---

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
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
            adapterCreator: channel.guild.voiceAdapterCreator
        });
        connection.on(VoiceConnectionStatus.Ready, () => {
            setupVoiceReceiver(connection);
        });
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
        if (userId === client.user.id) return;
        const audioStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_TIMEOUT }});
        const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2 });
        const pcmChunks = [];
        audioStream.pipe(decoder).on('data', (c) => pcmChunks.push(c)).on('end', async () => {
            const pcmBuffer = Buffer.concat(pcmChunks);
            if (pcmBuffer.length < 150000) return;
            const wavBuffer = Buffer.concat([createWavHeader(pcmBuffer.length), pcmBuffer]);
            await sendToN8nSatellit(wavBuffer, connection);
        });
    });
}

async function sendToN8nSatellit(wavBuffer, connection) {
    try {
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: { 'Content-Type': 'audio/wav' },
            responseType: 'arraybuffer' 
        });
        const audioPlayer = createAudioPlayer();
        audioPlayer.play(createAudioResource(Readable.from(response.data)));
        connection.subscribe(audioPlayer);
    } catch (e) { console.error(e); }
}

client.login(process.env.DISCORD_TOKEN);
