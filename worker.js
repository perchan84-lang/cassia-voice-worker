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
app.use(express.json()); // Stöd för JSON (text)
app.use(express.raw({ type: 'audio/*', limit: '10mb' })); // Stöd för röstbinär

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
});

// --- Text-lyssnare: Skickar allt hon ser till n8n ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== TARGET_CHANNEL_ID) return;
    
    try {
        await axios.post(N8N_WEBHOOK_URL, {
            user: message.author.username,
            text: message.content,
            timestamp: new Date()
        });
        console.log(`[💬] Text skickad till n8n: ${message.content}`);
    } catch (e) {
        console.error('[❌] Kunde inte skicka text till n8n:', e.message);
    }
});

// --- Röst-lyssnare ---
// (Här behåller du din befintliga setupVoiceReceiver-funktion)
// ...

client.login(process.env.DISCORD_TOKEN);
