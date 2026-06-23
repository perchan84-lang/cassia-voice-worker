// --- FIX: Tvingar Node att använda IPv4 ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, getVoiceConnection, generateDependencyReport } = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');
const { Readable } = require('stream');
const express = require('express');
require('dotenv').config();

console.log("=== 🛠️ CASSIA ALL-IN-ONE ENGINE (RESTORED) ===");
console.log(generateDependencyReport());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TARGET_CHANNEL_ID = '1505695523594698776';
const SILENCE_TIMEOUT = 2500;

// --- API Endpoints ---
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

// --- Voice & Text Logic ---
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
            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log(`[✅] Ansluten till röstkanal`);
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
    return avg > 1500;
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
            
            // Brusreducering tillagd här
            if (!isAudioSignificant(pcmBuffer)) {
                console.log(`[🔇] Brus detekterat - ignorerar sändning.`);
                return;
            }

            await sendToN8nSatellit(Buffer.concat([createWavHeader(pcmBuffer.length), pcmBuffer]), userId, connection);
        });
    });
}

async function sendToN8nSatellit(wavBuffer, userId, connection) {
    try {
        const response = await axios.post(N8N_WEBHOOK_URL, wavBuffer, {
            headers: { 
                'Content-Type': 'audio/wav', 
                'X-Channel-ID': TARGET_CHANNEL_ID, 
                'X-User-ID': userId 
            },
            responseType: 'arraybuffer' 
        });
        const audioPlayer = createAudioPlayer();
        audioPlayer.play(createAudioResource(Readable.from(response.data)));
        connection.subscribe(audioPlayer);
    } catch (e) { console.error('[❌] N8N-anrop misslyckades:', e.message); }
}

client.login(process.env.DISCORD_TOKEN);
