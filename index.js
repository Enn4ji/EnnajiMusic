// BotMusicDiscord - Bot de musique Discord avec Lavalink
// Créé par Rayan elhabib (skz_rayan23)
// https://github.com/rayanelhabib/BotMusicDiscord

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const path = require('path');
const MusicCog = require('./cogs/music.js');
const config = require('./config.js');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
const musicCog = new MusicCog(client);

// Prefix for message commands (default '+')
const PREFIX = config.PREFIX;
const REGISTER_SLASH = String(config.REGISTER_SLASH).toLowerCase() === 'true';

// Normalize token (trim and strip an accidental leading "Bot " prefix)
const ENV_TOKEN = (config.DISCORD_TOKEN || '').trim();
const NORMALIZED_TOKEN = ENV_TOKEN.replace(/^Bot\s+/i, '');
if (ENV_TOKEN && ENV_TOKEN !== NORMALIZED_TOKEN) {
    console.warn('Warning: DISCORD_TOKEN contained a "Bot " prefix. It has been stripped automatically.');
}

// Fail fast if no token provided
if (!NORMALIZED_TOKEN || ENV_TOKEN === 'your_bot_token_here') {
    console.error('❌ DISCORD_TOKEN manquant ou non configuré !');
    console.error('📝 Créez un fichier .env avec votre DISCORD_TOKEN ou modifiez config.js');
    console.error('🔑 Obtenez votre token sur: https://discord.com/developers/applications');
    process.exit(1);
}

// Register slash commands (opt-in)
if (REGISTER_SLASH) {
    const commands = musicCog.commands.map(command => command.toJSON());
    console.log(`[SLASH COMMANDS] Enregistrement de ${commands.length} commandes:`, commands.map(cmd => `/${cmd.name}`).join(', '));
    const rest = new REST({ version: '10' }).setToken(NORMALIZED_TOKEN);
    (async () => {
        try {
            if (!config.CLIENT_ID || config.CLIENT_ID === 'your_client_id_here') {
                console.warn('⚠️ CLIENT_ID manquant. Les slash commands ne seront pas enregistrés automatiquement.');
                console.warn('📝 Pour activer /playstr, modifiez config.js avec votre CLIENT_ID');
                console.warn('🔑 Obtenez votre CLIENT_ID sur: https://discord.com/developers/applications');
                return;
            }
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands(config.CLIENT_ID),
                { body: commands }
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    })();
}

// Handle slash commands (only when enabled)
if (REGISTER_SLASH) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        try {
            await musicCog.execute(interaction);
        } catch (error) {
            // Suppress noisy network/expired interaction errors
            if (error?.code === 10062 /* Unknown interaction */) {
                console.warn('Ignoring expired interaction');
                return;
            }
            console.error('Error executing command:', error);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'An error occurred while executing the command.' });
                } else {
                    await interaction.reply({ content: 'An error occurred while executing the command.', ephemeral: true });
                }
            } catch {}
        }
    });
}

// Handle prefix message commands
client.on('messageCreate', async (message) => {
    try {
        if (!message.guild || message.author.bot) return;
        if (!message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const commandName = (args.shift() || '').toLowerCase();
        if (!commandName) return;
        await musicCog.executePrefix(message, commandName, args);
    } catch (error) {
        console.error('Error executing prefix command:', error);
        if (message && message.reply) {
            await message.reply('An error occurred while executing the command.');
        }
    }
});

// Handler global pour les interactions de composants (toujours actif)
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            const id = interaction.customId || '';
            if ((id.startsWith('seek:') || id.startsWith('jump:')) && typeof musicCog.handleButton === 'function') {
                await musicCog.handleButton(interaction);
                return;
            }
            if (id.startsWith('ctl_') && typeof musicCog.handleControlInteraction === 'function') {
                await musicCog.handleControlInteraction(interaction);
                return;
            }
            // Other button types (lyrics_, q_) are handled internally elsewhere or ignored
        }

        if (interaction.isStringSelectMenu() && typeof musicCog.handleSelect === 'function') {
            await musicCog.handleSelect(interaction);
            return;
        }
    } catch (error) {
        console.error('Global interaction handler error:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true });
            }
        } catch (replyError) {
            console.error('Failed to send error reply:', replyError);
        }
    }
});

// Bot ready event
client.on('ready', () => {
    console.log(`🎵 BotMusicDiscord - Créé par Rayan elhabib (skz_rayan23)`);
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`📡 Bot prêt et connecté !`);
});

// Error handling for client
client.on('error', error => {
    console.error('Client error:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);