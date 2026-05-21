const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const axios = require('axios');

process.env.FFMPEG_PATH = require('ffmpeg-static');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

client.login(DISCORD_TOKEN);

client.once('ready', () => {
    console.log(`=== Cassia Voice Streamer Online: ${client.user.tag} ===`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!prata')) return;

    const userPrompt = message.content.replace('!prata', '').trim();
    if (!userPrompt) return message.reply("Vad vill du att jag ska svara på, Sir?");

    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) return message.reply("Du måste sitta i en röstkanal för att jag ska kunna prata med dig, Sir.");

    try {
        await message.channel.sendTyping();

        // Anropa n8n för att få det synkade textsvaret
        const n8nResponse = await axios.post(N8N_WEBHOOK_URL, {
            prompt: userPrompt,
            sessionId: "par_master_session",
            user: "Pär"
        });

        const cassiaTextReply = n8nResponse.data.output;
        if (!cassiaTextReply) throw new Error("Inget svar från Cassias hjärna i n8n.");

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // Strömma live från ElevenLabs direkt till röstkanalen
        const elevenLabsResponse = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
            data: {
                text: cassiaTextReply,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.35, similarity_boost: 0.75 }
            },
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'accept': 'audio/mpeg',
                'content-type': 'application/json'
            },
            responseType: 'stream'
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(elevenLabsResponse.data, {
            inputType: StreamType.Arbitrary
        });

        player.play(resource);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            connection.destroy();
        });

        player.on('error', error => {
            console.error(`Spelarfelt: ${error.message}`);
            connection.destroy();
        });

    } catch (error) {
        console.error("Fel i röstkedjan:", error.message);
        message.reply(`Det uppstod ett tekniskt fel i röstströmmen, Sir: ${error.message}`);
    }
});