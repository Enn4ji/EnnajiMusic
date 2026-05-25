// BotMusicDiscord - Module de musique
// Créé par Rayan elhabib (skz_rayan23)
// https://github.com/rayanelhabib/BotMusicDiscord

const { SlashCommandBuilder } = require('@discordjs/builders');
const { createCanvas } = require('canvas');
const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { Riffy } = require('riffy');
const { Classic } = require('musicard');
const { getLyrics } = require('genius-lyrics-api');
const fs = require('fs').promises;
const path = require('path');

class MusicCog {
    constructor(client) {
        this.client = client;
        this.prefix = process.env.PREFIX || 'j!';
        
        // Watermark - Créé par Rayan elhabib (skz_rayan23)
        this.author = 'Ennahi (httpsmizo06)';
        this.projectName = 'BotMusicDiscord';
        this.paddCooldownSeconds = Number(process.env.PADD_COOLDOWN_SECONDS || 5);
        this.userPaddCooldownUntil = new Map();
        this.loopModeByGuild = new Map(); // guildId -> 'off' | 'track' | 'queue'
        this.stayInChannelGuilds = new Set(); // guildIds with 24/7 enabled
        this.controlMessageByGuild = new Map(); // guildId -> messageId for control panel
        this.controlMessageObjByGuild = new Map(); // guildId -> Message object cache
        this.nowPlayingIntervalByGuild = new Map(); // guildId -> Interval handle
        this.queueCache = new Map(); // messageId -> { guildId, page, perPage, total, byUserId }
        this.suggestionsCache = new Map(); // messageId -> { tracks: Array<Track> }
        this.djRoleName = process.env.DJ_ROLE_NAME || '';
        // Track history for previous/next controls
        this.playHistoryByGuild = new Map(); // guildId -> Track[] (played before current)
        this.currentTrackByGuild = new Map(); // guildId -> Track (current)
        // Delayed leave handling to avoid abrupt disconnects on queue end
        this.pendingLeaveTimeoutByGuild = new Map(); // guildId -> Timeout
        // Smooth position tracking for fluid timer updates
        this.smoothBasePosByGuild = new Map(); // guildId -> ms
        this.smoothBaseTimeByGuild = new Map(); // guildId -> epoch ms
        // Cooldown system for seek buttons to prevent spam
        this.seekCooldowns = new Map(); // seek_${guildId}_${userId} -> timestamp
        // Quick playback mode per guild: 'normal' | 'slow' | 'fast'
        this.quickModeByGuild = new Map();
        // Seek coalescing removed per user request
        this.pendingSeekByGuild = new Map();
        
        // User statistics tracking
        this.userStats = new Map(); // userId -> { servers: Map, friends: Map, tracks: Map, totalTime: number }
        this.statsFile = path.join(__dirname, 'user_stats.json');
        this.ensureStatsFile();

        // 🚀 NOUVELLES OPTIMISATIONS ULTRA-PERFORMANCE
        this.initializeOptimizations();

        const lavalinkHost = process.env.LAVALINK_HOST || 'lava-v4.ajieblogs.eu.org';
        const lavalinkPort = Number(process.env.LAVALINK_PORT || 443);
        const lavalinkPassword = process.env.LAVALINK_PASSWORD || 'https://dsc.gg/ajidevserver';
        const lavalinkSecure = String(process.env.LAVALINK_SECURE || 'false').toLowerCase() === 'true';

        this.riffy = new Riffy(client, [{
            host: lavalinkHost,
            password: lavalinkPassword,
            port: lavalinkPort,
            secure: lavalinkSecure,
            name: "Main Node"
        }], {
            send: (payload) => {
                const guild = client.guilds.cache.get(payload.d.guild_id);
                if (guild) guild.shard.send(payload);
            },
            defaultSearchPlatform: "ytmsearch",
            restVersion: "v4",
            spotify: {
                clientId: process.env.SPOTIFY_CLIENT_ID,
                clientSecret: process.env.SPOTIFY_CLIENT_SECRET
            }
        });

        // Path for JSON playlist storage
        this.playlistFile = path.join(__dirname, 'playlists.json');
        this.ensurePlaylistFile();

        // Initialize Riffy when the client is ready
        client.on('ready', async () => {
            this.riffy.init(client.user.id);
            console.log('MusicCog: Riffy initialized');
            console.log(`🎵 EnnvjiMusic by Ennaji (httpsmizo06) - Music module loaded`);
            
            // Load user statistics
            try {
                const loadedStats = await this.loadUserStats();
                for (const [uid, data] of Object.entries(loadedStats)) {
                    this.userStats.set(uid, data);
                }
                console.log(`Loaded statistics for ${Object.keys(loadedStats).length} users`);
            } catch (error) {
                console.error('Error loading user statistics:', error);
            }
            
            // Clean up old cooldowns every 5 minutes
            setInterval(() => {
                const now = Date.now();
                const cooldownMs = 1000; // 1 second
                for (const [key, timestamp] of this.seekCooldowns.entries()) {
                    if (now - timestamp > cooldownMs * 2) { // Remove after 2x cooldown
                        this.seekCooldowns.delete(key);
                    }
                }
            }, 5 * 60 * 1000); // Every 5 minutes
        });

        // Riffy event handlers
        this.riffy.on("nodeConnect", (node) => {
            console.log(`MusicCog: Node "${node.name}" connected.`);
        });

        this.riffy.on("nodeError", (node, error) => {
            console.error(`MusicCog: Node "${node.name}" error: ${error.message}`);
            console.error(`EnnvjiMusic by Ennaji (httpsmizo06) - Error logged`);
        });

        // 🎵 SYSTÈME DE STATISTIQUES INDÉPENDANT (SANS LAVALINK)
        this.riffy.on("trackStart", async (player, track) => {
            const channel = client.channels.cache.get(player.textChannel);
            try {
                // Maintain simple play history
                const gid = player.guildId;
                // Cancel any pending leave timeout when playback resumes
                try {
                    const to = this.pendingLeaveTimeoutByGuild.get(gid);
                    if (to) {
                        clearTimeout(to);
                        this.pendingLeaveTimeoutByGuild.delete(gid);
                    }
                } catch {}
                const prev = this.currentTrackByGuild.get(gid);
                if (prev && prev !== track) {
                    const hist = this.playHistoryByGuild.get(gid) || [];
                    hist.push(prev);
                    if (hist.length > 20) hist.shift(); // limit history size
                    this.playHistoryByGuild.set(gid, hist);
                }
                this.currentTrackByGuild.set(gid, track);
                // Initialize smoothing baseline
                this.smoothBasePosByGuild.set(gid, 0);
                this.smoothBaseTimeByGuild.set(gid, Date.now());
            } catch {}
            try {

                const musicard = await Classic({
                    // Utiliser un dégradé si dispo, sinon fond clair
                    backgroundImage: gradientPng || undefined,
                    backgroundColor: gradientPng ? '#FFFFFF' : '#F8FAFC',
                    thumbnailImage: track.info.thumbnail || 'https://via.placeholder.com/150',
                    progress: 0,
                    progressColor: '#F59E0B',
                    progressBarColor: '#60A5FA',
                    name: track.info.title,
                    nameColor: '#111827',
                    author: track.info.author,
                    authorColor: '#374151',
                    startTime: '0:00',
                    endTime: new Date(track.info.length).toISOString().substr(14, 5),
                    timeColor: '#111827',
                });
                // Best-effort generation; if CDN blocks, fallback silently
                try {
                await fs.writeFile('musicard.png', musicard);
                await channel.send({
                    content: `Now Playing: **${track.info.title}** by ${track.info.author}`,
                    files: [{ attachment: 'musicard.png', name: 'musicard.png' }]
                });
                    await fs.unlink('musicard.png').catch(() => {});
                } catch {}
            } catch (error) {
                console.error('Error generating musicard:', error);
                await channel.send(`Now Playing: **${track.info.title}** by ${track.info.author}`);
            }

            // Send control panel embed with playback buttons and selects
            try {
                const embed = this.createNowPlayingEmbed(player, track, channel.guild);
                const selects = await this.buildSelectRows(player.guildId, track, track.info?.requester);
                const rows = this.buildControlRows(player.guildId, player, track.info?.requester);
                const msg = await channel.send({ embeds: [embed], components: [...selects, ...rows] });
                this.controlMessageByGuild.set(player.guildId, msg.id);
                // Cache the message object and start live updater
                this.controlMessageObjByGuild = this.controlMessageObjByGuild || new Map();
                this.controlMessageObjByGuild.set(player.guildId, msg);
                this.startNowPlayingUpdater(player);
            } catch (e) {
                console.error('Error sending control panel:', e);
            }
        });

        this.riffy.on("queueEnd", async (player) => {
            try {
            const channel = client.channels.cache.get(player.textChannel);
                if (!channel) return;
                const guildId = player.guildId;
                // stop live updater
                try { this.stopNowPlayingUpdater(guildId); } catch {}
                if (this.stayInChannelGuilds.has(guildId)) {
                    const embed = this.createEmbed('Queue ended', '24/7 mode is enabled. I will stay in the channel.');
                    await channel.send({ embeds: [embed] });
                    return;
                }

                // Schedule a delayed leave to avoid abrupt disconnects
                try {
                    const existing = this.pendingLeaveTimeoutByGuild.get(guildId);
                    if (existing) clearTimeout(existing);
                } catch {}

                await channel.send({ embeds: [this.createEmbed('Queue ended', 'Leaving the voice channel in 90 seconds if nothing plays. Use +247 to stay 24/7.')] });
                const to = setTimeout(() => {
                    try {
                        const p = this.riffy.players.get(guildId);
                        if (!p || p.playing || p.paused || p.queue.size) return; // playback resumed, do not leave
                        p.destroy();
                    } catch {}
                    this.pendingLeaveTimeoutByGuild.delete(guildId);
                }, 90_000);
                this.pendingLeaveTimeoutByGuild.set(guildId, to);
                // Clear smoothing baseline
                this.smoothBasePosByGuild.delete(guildId);
                this.smoothBaseTimeByGuild.delete(guildId);
            } catch (e) {
                console.error('queueEnd handler error:', e);
            }
        });

        // Attempt to support track end loop behavior if event exists
        try {
            this.riffy.on("trackEnd", async (player, track) => {
                try {
                    const guildId = player.guildId;
                    const mode = this.loopModeByGuild.get(guildId) || 'off';
                    if (mode === 'track') {
                        // Requeue the same track at the front
                        if (track) {
                            track.info.requester = track.info.requester || this.client.user;
                            player.queue.add(track);
                        }
                    } else if (mode === 'queue') {
                        // Move just-finished track to the end of the queue
                        if (track) {
                            track.info.requester = track.info.requester || this.client.user;
                            player.queue.add(track);
                        }
                    }
                    
                    // Update user statistics when track ends
                    if (track && track.info.requester && track.info.length) {
                        this.updateUserStats(track.info.requester.id, guildId, track, track.info.length);
                    }
                } catch (err) {
                    console.error('trackEnd loop handler error:', err);
                }
            });
        } catch {}

        client.on("raw", (d) => {
            if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(d.t)) return;
            this.riffy.updateVoiceState(d);
        });

        // Note: interaction handling is delegated globally in index.js to avoid duplicate handlers here
    }

    // 🚀 SYSTÈME D'OPTIMISATIONS ULTRA-PERFORMANCE
    initializeOptimizations() {
        // Cache intelligent pour les statistiques utilisateur
        this.userStatsCache = new Map(); // Cache en mémoire
        this.cacheExpiry = new Map();    // Expiration du cache
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes

        // Cache des résultats de recherche
        this.searchCache = new Map();
        this.searchCacheTimeout = 5 * 60 * 1000; // 5 minutes

        // Système de métriques en temps réel
        this.metrics = {
            commandsExecuted: 0,
            tracksPlayed: 0,
            errors: 0,
            responseTime: [],
            memoryUsage: [],
            cacheHits: 0,
            cacheMisses: 0
        };

        // Gestionnaire d'erreurs robuste
        this.connectionRetryCount = new Map();
        this.maxRetries = 3;
        this.errorCount = new Map();

        // Système de plugins modulaire
        this.plugins = new Map();
        this.initializePlugins();

        // Nettoyage automatique de la mémoire
        setInterval(() => {
            this.cleanupMemory();
        }, 5 * 60 * 1000); // Toutes les 5 minutes

        // Vérification de santé du bot
        setInterval(() => {
            this.healthCheck();
        }, 30 * 1000); // Toutes les 30 secondes

        // Sauvegarde par lots des statistiques
        this._statsSaveTimeout = null;
        this.statsSaveInterval = 10 * 60 * 1000; // 10 minutes

        console.log('🚀 Optimisations ultra-performance initialisées !');
    }

    // 🔧 Initialisation des plugins
    initializePlugins() {
        // Plugin AutoDJ
        this.registerPlugin('autoDJ', {
            name: 'AutoDJ',
            enabled: true,
            init: (cog) => {
                cog.autoDJEnabled = new Map();
                cog.autoDJQueue = new Map();
            },
            enable: (guildId) => {
                this.autoDJEnabled.set(guildId, true);
                return 'AutoDJ activé ! 🎵';
            },
            disable: (guildId) => {
                this.autoDJEnabled.delete(guildId);
                return 'AutoDJ désactivé ! 🔇';
            }
        });

        // Plugin SmartQueue
        this.registerPlugin('smartQueue', {
            name: 'SmartQueue',
            enabled: true,
            init: (cog) => {
                cog.smartQueueEnabled = new Map();
                cog.queueHistory = new Map();
            },
            enable: (guildId) => {
                this.smartQueueEnabled.set(guildId, true);
                return 'SmartQueue activé ! 🧠';
            },
            disable: (guildId) => {
                this.smartQueueEnabled.delete(guildId);
                return 'SmartQueue désactivé ! 📝';
            }
        });

        // Plugin VoiceEffects
        this.registerPlugin('voiceEffects', {
            name: 'VoiceEffects',
            enabled: true,
            init: (cog) => {
                cog.voiceEffectsEnabled = new Map();
                cog.activeEffects = new Map();
            },
            enable: (guildId) => {
                this.voiceEffectsEnabled.set(guildId, true);
                return 'VoiceEffects activé ! 🎭';
            },
            disable: (guildId) => {
                this.voiceEffectsEnabled.delete(guildId);
                return 'VoiceEffects désactivé ! 🎵';
            }
        });
    }

    // 📦 Enregistrement des plugins
    registerPlugin(name, plugin) {
        this.plugins.set(name, plugin);
        if (plugin.init) {
            plugin.init(this);
        }
        console.log(`🔌 Plugin ${plugin.name} enregistré !`);
    }

    // 🛡️ Wrapper de sécurité pour toutes les opérations
    async safeOperation(operation, fallback, context = '') {
        const startTime = Date.now();
        try {
            const result = await operation();
            this.logMetric('responseTime', Date.now() - startTime);
            this.logMetric('commandsExecuted', 1);
            return result;
        } catch (error) {
            this.logMetric('errors', 1);
            console.error(`❌ Erreur dans ${context}:`, error);
            return fallback;
        }
    }

    // 📊 Collecte des métriques en temps réel
    logMetric(type, value) {
        if (this.metrics[type] !== undefined) {
            if (Array.isArray(this.metrics[type])) {
                this.metrics[type].push(value);
                // Garder seulement les 1000 dernières valeurs
                if (this.metrics[type].length > 1000) {
                    this.metrics[type].shift();
                }
            } else {
                this.metrics[type] = value;
            }
        }
    }

    // 🧹 Nettoyage automatique de la mémoire
    cleanupMemory() {
        try {
            const now = Date.now();
            
            // Nettoyer les caches expirés
            for (const [key, expiry] of this.cacheExpiry.entries()) {
                if (now > expiry) {
                    this.userStatsCache.delete(key);
                    this.cacheExpiry.delete(key);
                }
            }

            // Nettoyer le cache de recherche expiré
            for (const [key, data] of this.searchCache.entries()) {
                if (now - data.timestamp > this.searchCacheTimeout) {
                    this.searchCache.delete(key);
                }
            }

            // Nettoyer les anciens messages de contrôle
            for (const [guildId, messageId] of this.controlMessageByGuild.entries()) {
                try {
                    const message = this.controlMessageObjByGuild.get(guildId);
                    if (message && message.createdTimestamp && (now - message.createdTimestamp > 30 * 60 * 1000)) {
                        this.controlMessageByGuild.delete(guildId);
                        this.controlMessageObjByGuild.delete(guildId);
                    }
                } catch {}
            }

            // Libérer la mémoire des caches vides
            if (this.userStatsCache.size > 1000) {
                const entries = Array.from(this.userStatsCache.entries());
                entries.slice(0, 500).forEach(([key]) => {
                    this.userStatsCache.delete(key);
                    this.cacheExpiry.delete(key);
                });
            }

            console.log('🧹 Nettoyage mémoire effectué');
        } catch (error) {
            console.error('Erreur lors du nettoyage mémoire:', error);
        }
    }

    // ❤️ Vérification de santé du bot
    healthCheck() {
        try {
            // Vérifier la connexion Lavalink
            const nodes = this.riffy.nodes;
            let healthyNodes = 0;
            for (const node of nodes.values()) {
                if (node.connected) healthyNodes++;
            }

            // Vérifier l'état des players
            const players = this.riffy.players;
            let activePlayers = 0;
            for (const player of players.values()) {
                if (player.playing || player.paused) activePlayers++;
            }

            // Vérifier l'utilisation mémoire
            const memUsage = process.memoryUsage();
            this.logMetric('memoryUsage', memUsage.heapUsed);

            // Log de santé toutes les 5 minutes
            if (this.metrics.commandsExecuted % 100 === 0) {
                console.log(`❤️ Santé du bot: Nodes: ${healthyNodes}/${nodes.size}, Players: ${activePlayers}, Mémoire: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
            }
        } catch (error) {
            console.error('Erreur lors de la vérification de santé:', error);
        }
    }

    // 🔄 Gestion des erreurs de connexion
    async handleConnectionError(guildId) {
        const retries = this.connectionRetryCount.get(guildId) || 0;
        if (retries < this.maxRetries) {
            this.connectionRetryCount.set(guildId, retries + 1);
            console.log(`🔄 Tentative de reconnexion ${retries + 1}/${this.maxRetries} pour le serveur ${guildId}`);
            
            try {
                await this.reconnectPlayer(guildId);
                this.connectionRetryCount.delete(guildId);
                return true;
            } catch (error) {
                console.error(`❌ Échec de reconnexion ${retries + 1}/${this.maxRetries}:`, error);
                return false;
            }
        } else {
            console.error(`❌ Échec de reconnexion après ${this.maxRetries} tentatives pour le serveur ${guildId}`);
            this.connectionRetryCount.delete(guildId);
            return false;
        }
    }

    // 🔌 Reconnexion automatique d'un player
    async reconnectPlayer(guildId) {
        try {
            const player = this.riffy.players.get(guildId);
            if (player) {
                // Tenter de reconnecter le player
                await player.connect();
                console.log(`✅ Player reconnecté pour le serveur ${guildId}`);
                return true;
            }
        } catch (error) {
            console.error(`❌ Erreur lors de la reconnexion du player:`, error);
            throw error;
        }
    }

    // 🎵 Cache intelligent pour les statistiques
    async getCachedUserStats(userId) {
        const now = Date.now();
        const cacheKey = `stats_${userId}`;
        
        // Vérifier le cache
        if (this.userStatsCache.has(cacheKey)) {
            const expiry = this.cacheExpiry.get(cacheKey);
            if (now < expiry) {
                this.logMetric('cacheHits', 1);
                return this.userStatsCache.get(cacheKey);
            }
        }

        this.logMetric('cacheMisses', 1);
        
        // Charger depuis le fichier
        const stats = this.userStats.get(userId) || this.createDefaultUserStats();
        
        // Mettre en cache
        this.userStatsCache.set(cacheKey, stats);
        this.cacheExpiry.set(cacheKey, now + this.cacheTimeout);
        
        return stats;
    }

    // 📊 Création de statistiques par défaut
    createDefaultUserStats() {
        return {
            servers: new Map(),
            friends: new Map(),
            tracks: new Map(),
            totalTime: 0,
            lastSeen: Date.now()
        };
    }

    // 🔍 Cache intelligent pour la recherche
    async searchTracksWithCache(query) {
        const cacheKey = query.toLowerCase().trim();
        const now = Date.now();
        
        // Vérifier le cache
        if (this.searchCache.has(cacheKey)) {
            const cached = this.searchCache.get(cacheKey);
            if (now - cached.timestamp < this.searchCacheTimeout) {
                this.logMetric('cacheHits', 1);
                return cached.results;
            }
        }

        this.logMetric('cacheMisses', 1);
        
        // Effectuer la recherche
        const results = await this.searchTracks(query);
        
        // Mettre en cache
        this.searchCache.set(cacheKey, {
            results,
            timestamp: now
        });
        
        return results;
    }

    // 📈 Sauvegarde par lots des statistiques
    async batchSaveStats() {
        try {
            const statsToSave = {};
            for (const [userId, stats] of this.userStats.entries()) {
                // Convertir les Maps en objets pour la sauvegarde JSON
                statsToSave[userId] = {
                    ...stats,
                    servers: Object.fromEntries(stats.servers),
                    friends: Object.fromEntries(stats.friends),
                    tracks: Object.fromEntries(stats.tracks)
                };
            }
            
            await fs.writeFile(this.statsFile, JSON.stringify(statsToSave, null, 2));
            console.log(`💾 Statistiques sauvegardées par lots: ${Object.keys(statsToSave).length} utilisateurs`);
        } catch (error) {
            console.error('❌ Erreur lors de la sauvegarde par lots:', error);
        }
    }

    // 🎯 Optimisation de la sauvegarde des stats
    async saveUserStats() {
        // Sauvegarde par lots toutes les 10 minutes au lieu de 5
        if (!this._statsSaveTimeout) {
            this._statsSaveTimeout = setTimeout(() => {
                this.batchSaveStats();
                this._statsSaveTimeout = null;
            }, this.statsSaveInterval);
        }
    }

    // Live updater for the Now Playing embed (position/progress every second)
    startNowPlayingUpdater(player) {
        try {
            const guildId = player.guildId;
            if (this.nowPlayingIntervalByGuild?.has(guildId)) {
                clearInterval(this.nowPlayingIntervalByGuild.get(guildId));
            } else {
                this.nowPlayingIntervalByGuild = this.nowPlayingIntervalByGuild || new Map();
            }
            this.nowPlayingIntervalByGuild.set(guildId, setInterval(async () => {
                try {
                    const p = this.riffy.players.get(guildId);
                    const msg = this.controlMessageObjByGuild?.get(guildId);
                    if (!p || !p.current || !msg || !msg.editable) return;

                    // Smooth current position to avoid laggy timer
                    const rawPos = Number(p.position || 0);
                    const basePos = this.smoothBasePosByGuild.get(guildId) ?? rawPos;
                    const baseTime = this.smoothBaseTimeByGuild.get(guildId) ?? Date.now();
                    const isPaused = Boolean(p.paused);
                    let smoothPos = rawPos;
                    if (!isPaused) {
                        const elapsed = Date.now() - baseTime;
                        smoothPos = basePos + elapsed;
                        // correct drift if too far from raw (e.g., seek)
                        if (Math.abs(smoothPos - rawPos) > 1500) {
                            this.smoothBasePosByGuild.set(guildId, rawPos);
                            this.smoothBaseTimeByGuild.set(guildId, Date.now());
                            smoothPos = rawPos;
                        }
                    } else {
                        // paused: keep baseline aligned to raw
                        this.smoothBasePosByGuild.set(guildId, rawPos);
                        this.smoothBaseTimeByGuild.set(guildId, Date.now());
                        smoothPos = rawPos;
                    }

                    // Build embed using smoothPos as the current position
                    const embed = this.createNowPlayingEmbed({ ...p, position: smoothPos }, p.current, msg.guild);
                    await msg.edit({ embeds: [embed], components: msg.components });
                } catch {}
            }, 1000));
        } catch {}
    }

    stopNowPlayingUpdater(guildId) {
        try {
            if (!this.nowPlayingIntervalByGuild) return;
            const it = this.nowPlayingIntervalByGuild.get(guildId);
            if (it) clearInterval(it);
            this.nowPlayingIntervalByGuild.delete(guildId);
        } catch {}
    }

    createEmbed(title, description) {
        const embed = new EmbedBuilder()
            .setColor(0xFF7A00)
            .setTitle(title)
            .setDescription(description || '')
            .setTimestamp()
            .setFooter({ text: 'BotMusicDiscord by Rayan elhabib (skz_rayan23)', iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png' });
        if (this.client?.user) {
            embed.setAuthor({ name: this.client.user.username, iconURL: this.client.user.displayAvatarURL({ size: 128 }) });
            embed.setThumbnail(this.client.user.displayAvatarURL({ size: 128 }));
        }
        return embed;
    }

    userIsDJ(member) {
        if (!member) return false;
        if (!this.djRoleName) return true; // if not configured, allow
        return member.roles.cache.some(r => r.name.toLowerCase() === this.djRoleName.toLowerCase())
            || member.permissions.has(PermissionsBitField.Flags.ManageGuild)
            || member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    // Vérifie si l'utilisateur est le propriétaire de la piste en cours
    isTrackOwner(player, userId) {
        if (!player || !player.current) return false;
        const currentTrack = player.current;
        return currentTrack.info && currentTrack.info.requester && currentTrack.info.requester.id === userId;
    }

    // Vérifie si l'utilisateur peut contrôler la musique (SEULEMENT le propriétaire de la piste)
    canControlMusic(member, player) {
        if (!member) return false;
        // SEULEMENT le propriétaire de la piste peut contrôler sa musique
        return this.isTrackOwner(player, member.id);
    }

    async resolveWithTimeout(query, requester, timeoutMs = 12000) {
        const resolvePromise = this.riffy.resolve({ query, requester });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('RESOLVE_TIMEOUT')), timeoutMs));
        return Promise.race([resolvePromise, timeoutPromise]);
    }

    async executePrefix(message, commandName, args) {
        const member = message.member;
        const voiceChannel = member?.voice?.channel;

        // Enforce special cooldown: after +padd, block other commands for N seconds
        const now = Date.now();
        const until = this.userPaddCooldownUntil.get(message.author.id);
        if (commandName !== 'padd' && until && until > now) {
            const secondsLeft = Math.ceil((until - now) / 1000);
            const embed = this.createEmbed('Cooldown active', `Please wait ${secondsLeft}s after using ${this.prefix}padd before using other commands.`);
            return void message.reply({ embeds: [embed] });
        }

        const needsVoice = !['queue', 'help', 'pcreate', 'pdelete', 'padd', 'premove', 'lyrics'].includes(commandName);
        if (needsVoice && !voiceChannel) {
            const embed = this.createEmbed('Join a voice channel', 'You need to be in a voice channel to use this command.');
            return void message.reply({ embeds: [embed] });
        }

        if (needsVoice) {
            const me = message.guild.members.me;
            if (!voiceChannel.permissionsFor(me).has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
                const embed = this.createEmbed('Missing permissions', 'I need permissions to join and speak in your voice channel.');
                return void message.reply({ embeds: [embed] });
            }
        }

        try {
            if (commandName === 'play') {
                const query = args.join(' ');
                if (!query) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}play <query|url|spotify>`)] });

                const searchingMsg = await message.reply({ embeds: [this.createEmbed('Searching', `Looking for: ${query}`)] });
                const player = this.riffy.createConnection({
                    guildId: message.guild.id,
                    voiceChannel: voiceChannel.id,
                    textChannel: message.channel.id,
                    deaf: true
                });

                let resolve;
                try {
                    resolve = await this.resolveWithTimeout(query, message.author);
                } catch (e) {
                    if (String(e?.message) === 'RESOLVE_TIMEOUT') {
                        return void searchingMsg.edit({ embeds: [this.createEmbed('Timeout', 'Search took too long. Please try again later.')] });
                    }
                    return void searchingMsg.edit({ embeds: [this.createEmbed('Error', 'Failed to resolve the query.')] });
                }
                const { loadType, tracks, playlistInfo } = resolve || {};

                if (loadType === 'empty') {
                    return void searchingMsg.edit({ embeds: [this.createEmbed('No results', 'No results found for your query.')] });
                }

                if (loadType === 'playlist') {
                    for (const track of tracks) {
                        track.info.requester = message.author;
                        player.queue.add(track);
                    }
                    await searchingMsg.edit({ embeds: [this.createEmbed('Playlist queued', `Added playlist **${playlistInfo.name}** with ${tracks.length} tracks.`)] });
                } else {
                    const track = tracks.shift();
                    if (!track || !track.info) {
                        return void searchingMsg.edit({ embeds: [this.createEmbed('No results', 'No playable track found for your query.')] });
                    }
                    track.info.requester = message.author;
                    player.queue.add(track);
                    const embed = this.createEmbed('Queued', `Added **${track.info.title}** to the queue.`)
                        .addFields({ name: 'Channel', value: `<#${message.channel.id}>`, inline: true });
                    await searchingMsg.edit({ embeds: [embed] });
                }

                if (!player.playing && !player.paused) player.play();
            }

            else if (commandName === 'pause') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                if (!this.canControlMusic(message.member, player)) {
                    const errorMessage = 'Seul la personne qui a lancé cette musique peut la contrôler.';
                    return void message.reply({ embeds: [this.createEmbed('Permission denied', errorMessage)] });
                }
                if (player.paused) return void message.reply({ embeds: [this.createEmbed('Already paused', 'The player is already paused.')] });
                player.pause(true);
                await message.reply({ embeds: [this.createEmbed('Paused', 'Paused the current song.')] });
            }

            else if (commandName === 'skip') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player || !player.queue.size) return void message.reply({ embeds: [this.createEmbed('Nothing to skip', 'No music is playing or no songs in queue to skip.')] });
                if (!this.canControlMusic(message.member, player)) {
                    const errorMessage = 'Seul la personne qui a lancé cette musique peut la contrôler.';
                    return void message.reply({ embeds: [this.createEmbed('Permission denied', errorMessage)] });
                }
                player.stop();
                await message.reply({ embeds: [this.createEmbed('Skipped', 'Skipped the current song.')] });
            }

            else if (commandName === 'stop') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                if (!this.canControlMusic(message.member, player)) {
                    const errorMessage = 'Seul la personne qui a lancé cette musique peut la contrôler.';
                    return void message.reply({ embeds: [this.createEmbed('Permission denied', errorMessage)] });
                }
                player.destroy();
                await message.reply({ embeds: [this.createEmbed('Stopped', 'Stopped playback and cleared the queue.')] });
            }

            else if (commandName === 'resume') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                if (!this.canControlMusic(message.member, player)) {
                    const errorMessage = 'Seul la personne qui a lancé cette musique peut la contrôler.';
                    return void message.reply({ embeds: [this.createEmbed('Permission denied', errorMessage)] });
                }
                if (!player.paused) return void message.reply({ embeds: [this.createEmbed('Not paused', 'The player is not paused.')] });
                player.pause(false);
                await message.reply({ embeds: [this.createEmbed('Resumed', 'Resumed the current song.')] });
            }

            else if (commandName === 'queue') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player || !player.queue.size) return void message.reply({ embeds: [this.createEmbed('Queue', 'No music is playing or the queue is empty.')] });
                const perPage = 10;
                const page = 0;
                const embed = this.buildQueuePageEmbed(player, page, perPage);
                const row = this.buildQueueRow(message.author.id, page, Math.ceil(player.queue.size / perPage));
                const sent = await message.reply({ embeds: [embed], components: [row] });
                this.queueCache.set(sent.id, {
                    guildId: message.guild.id,
                    page,
                    perPage,
                    total: player.queue.size,
                    byUserId: message.author.id,
                });
            }

            else if (commandName === 'help') {
                const embed = this.createEmbed('Music Bot Commands', 'Use the following prefix commands:')
                    .addFields(
                        { name: `${this.prefix}play <query>`, value: 'Play a song or playlist' },
                        { name: `${this.prefix}pause`, value: 'Pause the current song' },
                        { name: `${this.prefix}skip`, value: 'Skip the current song' },
                        { name: `${this.prefix}stop`, value: 'Stop playback and clear the queue' },
                        { name: `${this.prefix}resume`, value: 'Resume the paused song' },
                        { name: `${this.prefix}queue`, value: 'Show the music queue' },
                        { name: `${this.prefix}np`, value: 'Show the currently playing track' },
                        { name: `${this.prefix}volume <0-200>`, value: 'Set playback volume' },
                        { name: `${this.prefix}seek <mm:ss>`, value: 'Seek to a position' },
                        { name: `${this.prefix}loop <off|track|queue>`, value: 'Set loop mode' },
                        { name: `${this.prefix}shuffle`, value: 'Shuffle the queue' },
                        { name: `${this.prefix}clear`, value: 'Clear the queue' },
                        { name: `${this.prefix}247`, value: 'Toggle 24/7 mode (stay in channel)' },
                        { name: `${this.prefix}move <from> <to>`, value: 'Move a track within the queue' },
                        { name: `${this.prefix}remove <index|start-end>`, value: 'Remove track(s) from the queue' },
                        { name: `${this.prefix}jump <index>`, value: 'Jump to a specific track (play it next)' },
                        { name: `${this.prefix}pcreate <name>`, value: 'Create a new playlist' },
                        { name: `${this.prefix}pdelete <name>`, value: 'Delete a playlist' },
                        { name: `${this.prefix}padd <name> <query>`, value: 'Add a song to a playlist' },
                        { name: `${this.prefix}premove <name> <index>`, value: 'Remove a song from a playlist' },
                        { name: `${this.prefix}pplay <name>`, value: 'Play a saved playlist' },
                        { name: `${this.prefix}filter <name>`, value: 'Apply an audio filter' },
                        { name: `${this.prefix}lyrics [query]`, value: 'Fetch song lyrics' },
                        { name: `${this.prefix}profile`, value: 'Show your music listening statistics' },
                    );
                await message.reply({ embeds: [embed] });
            }

            else if (commandName === 'pcreate') {
                const name = args.join(' ');
                if (!name) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}pcreate <name>`)] });
                const playlists = await this.loadPlaylists();
                const userId = message.author.id;
                if (!playlists[userId]) playlists[userId] = {};
                if (playlists[userId][name]) return void message.reply({ embeds: [this.createEmbed('Exists', `Playlist **${name}** already exists.`)] });
                playlists[userId][name] = [];
                await this.savePlaylists(playlists);
                await message.reply({ embeds: [this.createEmbed('Playlist created', `Created playlist **${name}**.`)] });
            }

            else if (commandName === 'pdelete') {
                const name = args.join(' ');
                if (!name) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}pdelete <name>`)] });
                const playlists = await this.loadPlaylists();
                const userId = message.author.id;
                if (!playlists[userId] || !playlists[userId][name]) return void message.reply({ embeds: [this.createEmbed('Not found', `Playlist **${name}** does not exist.`)] });
                delete playlists[userId][name];
                await this.savePlaylists(playlists);
                await message.reply({ embeds: [this.createEmbed('Playlist deleted', `Deleted playlist **${name}**.`)] });
            }

            else if (commandName === 'padd') {
                const name = args.shift();
                const query = (args || []).join(' ');
                if (!name || !query) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}padd <name> <query>`)] });
                const playlists = await this.loadPlaylists();
                const userId = message.author.id;
                if (!playlists[userId] || !playlists[userId][name]) return void message.reply({ embeds: [this.createEmbed('Not found', `Playlist **${name}** does not exist.`)] });

                const resolve = await this.riffy.resolve({ query, requester: message.author });
                if (resolve.loadType === 'empty') return void message.reply({ embeds: [this.createEmbed('No results', 'No results found for your query.')] });
                const track = resolve.tracks[0];
                playlists[userId][name].push({
                    title: track.info.title,
                    author: track.info.author,
                    uri: track.info.uri,
                    length: track.info.length
                });
                await this.savePlaylists(playlists);
                await message.reply({ embeds: [this.createEmbed('Added to playlist', `Added **${track.info.title}** to **${name}**.`)] });

                // Start cooldown timer for this user
                const until = Date.now() + this.paddCooldownSeconds * 1000;
                this.userPaddCooldownUntil.set(message.author.id, until);
            }

            else if (commandName === 'premove') {
                const name = args.shift();
                const indexStr = args.shift();
                const index = Number(indexStr) - 1;
                if (!name || !indexStr || Number.isNaN(index)) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}premove <name> <index>`)] });
                const playlists = await this.loadPlaylists();
                const userId = message.author.id;
                if (!playlists[userId] || !playlists[userId][name]) return void message.reply({ embeds: [this.createEmbed('Not found', `Playlist **${name}** does not exist.`)] });
                if (index < 0 || index >= playlists[userId][name].length) return void message.reply({ embeds: [this.createEmbed('Invalid index', `Use ${this.prefix}queue to see the playlist.`)] });
                const removed = playlists[userId][name][index];
                playlists[userId][name].splice(index, 1);
                await this.savePlaylists(playlists);
                await message.reply({ embeds: [this.createEmbed('Removed from playlist', `Removed **${removed.title}** from **${name}**.`)] });
            }

            else if (commandName === 'pplay') {
                const name = args.join(' ');
                if (!name) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}pplay <name>`)] });
                const playlists = await this.loadPlaylists();
                const userId = message.author.id;
                if (!playlists[userId] || !playlists[userId][name]) return void message.reply({ embeds: [this.createEmbed('Not found', `Playlist **${name}** does not exist.`)] });

                const player = this.riffy.createConnection({
                    guildId: message.guild.id,
                    voiceChannel: voiceChannel.id,
                    textChannel: message.channel.id,
                    deaf: true
                });
                for (const trackData of playlists[userId][name]) {
                    const resolve = await this.riffy.resolve({ query: trackData.uri, requester: message.author });
                    if (resolve.loadType !== 'empty') {
                        const resolvedTrack = resolve.tracks[0];
                        resolvedTrack.info.requester = message.author;
                        player.queue.add(resolvedTrack);
                    }
                }
                if (!player.playing && !player.paused) player.play();
                await message.reply({ embeds: [this.createEmbed('Playlist playing', `Playing playlist **${name}** with ${playlists[userId][name].length} tracks.`)] });
            }

            else if (commandName === 'filter') {
                const filter = (args.shift() || '').toLowerCase();
                if (!filter) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}filter <none|bassboost|nightcore|vaporwave|8d|karaoke|tremolo|vibrato|rotation|distortion|channelmix|lowpass|slowmode>`)] });
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                const filters = {
                    none: () => player.filters.clearFilters(),
                    bassboost: () => player.filters.setBassboost(true, { value: 3 }),
                    nightcore: () => player.filters.setNightcore(true, { rate: 1.5 }),
                    vaporwave: () => player.filters.setVaporwave(true, { pitch: 0.5 }),
                    '8d': () => player.filters.set8D(true, { rotationHz: 0.2 }),
                    karaoke: () => player.filters.setKaraoke(true, { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
                    tremolo: () => player.filters.setTremolo(true, { frequency: 2, depth: 0.5 }),
                    vibrato: () => player.filters.setVibrato(true, { frequency: 4, depth: 0.5 }),
                    rotation: () => player.filters.setRotation(true, { rotationHz: 0.2 }),
                    distortion: () => player.filters.setDistortion(true, { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1 }),
                    channelmix: () => player.filters.setChannelMix(true, { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 }),
                    lowpass: () => player.filters.setLowPass(true, { smoothing: 20 }),
                    slowmode: () => player.filters.setSlowmode(true, { rate: 0.8 })
                };
                if (!filters[filter]) return void message.reply({ embeds: [this.createEmbed('Invalid filter', 'Available: none, bassboost, nightcore, vaporwave, 8d, karaoke, tremolo, vibrato, rotation, distortion, channelmix, lowpass, slowmode')] });
                filters[filter]();
                await message.reply({ embeds: [this.createEmbed('Filter applied', `Applied **${filter === 'none' ? 'no' : filter}** filter.`)] });
            }

            else if (commandName === 'lyrics') {
                const query = args.join(' ');
                const player = this.riffy.players.get(message.guild.id);
                let title, artist;
                if (query) {
                    title = query; artist = '';
                } else if (player && player.current) {
                    title = player.current.info.title; artist = player.current.info.author;
                } else {
                    return void message.reply({ embeds: [this.createEmbed('No song', 'No song is currently playing, and no query was provided.')] });
                }
                try {
                    const lyrics = await getLyrics({ title, artist, apiKey: process.env.GENIUS_API_KEY, optimizeQuery: true });
                    if (!lyrics) return void message.reply({ embeds: [this.createEmbed('No lyrics', 'No lyrics found for this song.')] });
                    const chunks = lyrics.match(/(.|[\r\n]){1,4000}/g) || ['No lyrics available.'];
                    const embed = new EmbedBuilder()
                        .setTitle(`Lyrics for ${title}${artist ? ` by ${artist}` : ''}`)
                        .setDescription(chunks[0])
                        .setColor(0xFF7A00)
                        .setFooter({ text: `Page 1 of ${chunks.length}` })
                        .setTimestamp();
                    if (this.client?.user) embed.setThumbnail(this.client.user.displayAvatarURL({ size: 128 }));
                    await message.reply({ embeds: [embed] });
                } catch (e) {
                    console.error('Lyrics error:', e);
                    await message.reply({ embeds: [this.createEmbed('Error', 'Error fetching lyrics. Please try again later.')] });
                }
            }

            else if (commandName === 'np') {
                const player = this.riffy.players.get(message.guild.id);
                if (!player || !player.current) return void message.reply({ embeds: [this.createEmbed('Now Playing', 'Nothing is currently playing.')] });
                const track = player.current;
                const embed = this.createNowPlayingEmbed(player, track, message.guild);
                await message.reply({ embeds: [embed] });
            }

            else if (commandName === 'volume') {
                if (!this.userIsDJ(message.member)) return void message.reply({ embeds: [this.createEmbed('DJ only', 'This command requires the DJ role.')] });
                const value = Number(args.shift());
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                if (Number.isNaN(value) || value < 0 || value > 200) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}volume <0-200>`)] });
                player.setVolume(value);
                await message.reply({ embeds: [this.createEmbed('Volume', `Set volume to **${value}%**.`)] });
            }

            else if (commandName === 'seek') {
                const time = (args.shift() || '').trim();
                const player = this.riffy.players.get(message.guild.id);
                if (!player) return void message.reply({ embeds: [this.createEmbed('Nothing playing', 'No music is currently playing.')] });
                const match = time.match(/^(\d{1,2}):(\d{2})$/);
                if (!match) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}seek <mm:ss>`)] });
                const minutes = Number(match[1]);
                const seconds = Number(match[2]);
                const position = (minutes * 60 + seconds) * 1000;
                player.seek(position);
                await message.reply({ embeds: [this.createEmbed('Seek', `Seeked to **${time}**.`)] });
            }

            else if (commandName === 'loop') {
                if (!this.userIsDJ(message.member)) return void message.reply({ embeds: [this.createEmbed('DJ only', 'This command requires the DJ role.')] });
                const mode = (args.shift() || '').toLowerCase();
                if (!['off', 'track', 'queue'].includes(mode)) return void message.reply({ embeds: [this.createEmbed('Usage', `${this.prefix}loop <off|track|queue>`)] });
                this.loopModeByGuild.set(message.guild.id, mode);
                await message.reply({ embeds: [this.createEmbed('Loop', `Loop mode set to **${mode}**.`)] });
            }

            else if (commandName === 'shuffle') {
                if (!this.userIsDJ(message.member)) return void message.reply({ embeds: [this.createEmbed('DJ only', 'This command requires the DJ role.')] });
                const player = this.riffy.players.get(message.guild.id);
                if (!player || player.queue.size < 2) return void message.reply({ embeds: [this.createEmbed('Shuffle', 'Not enough tracks to shuffle.')] });
                const shuffled = player.queue.sort(() => Math.random() - 0.5);
                player.queue.clear();
                shuffled.forEach(t => player.queue.add(t));
                await message.reply({ embeds: [this.createEmbed('Shuffle', 'Shuffled the queue.')] });
            }

            else if (commandName === 'clear') {
                if (!this.userIsDJ(message.member)) return void message.reply({ embeds: [this.createEmbed('DJ only', 'This command requires the DJ role.')] });
                const player = this.riffy.players.get(message.guild.id);
                if (!player || !player.queue.size) return void message.reply({ embeds: [this.createEmbed('Clear', 'Queue is already empty.')] });
                player.queue.clear();
                await message.reply({ embeds: [this.createEmbed('Clear', 'Cleared the queue.')] });
            }

            else if (commandName === '247') {
                if (!this.userIsDJ(message.member)) return void message.reply({ embeds: [this.createEmbed('DJ only', 'This command requires the DJ role.')] });
                const enabled = this.stayInChannelGuilds.has(message.guild.id);
                if (enabled) this.stayInChannelGuilds.delete(message.guild.id); else this.stayInChannelGuilds.add(message.guild.id);
                await message.reply({ embeds: [this.createEmbed('24/7', `24/7 mode is now **${enabled ? 'disabled' : 'enabled'}**.`)] });
            }

            else if (commandName === 'profile') {
                await this.showUserProfile(message, message.author.id);
            }

        } catch (error) {
            console.error('executePrefix error:', error);
            return void message.reply({ embeds: [this.createEmbed('Error', 'An error occurred while executing the command.')] });
        }
    }

    // Wrapper: select visual style from env NP_STYLE: 'card' | 'fields' | 'compact' | 'poster'
    createNowPlayingEmbed(player, track, guild) {
        const style = String(process.env.NP_STYLE || 'card').toLowerCase();
        if (style === 'fields') return this.createNowPlayingEmbedFields(player, track, guild);
        if (style === 'compact') return this.createNowPlayingEmbedCompact(player, track, guild);
        if (style === 'poster') return this.createNowPlayingEmbedPoster(player, track, guild);
        return this.createNowPlayingEmbedCard(player, track, guild);
    }

    // Style: Card (par défaut)
    createNowPlayingEmbedCard(player, track, guild) {
        const totalMs = Number(track.info.length) || 0;
        const currentMs = Number(player.position || 0);
        const duration = new Date(totalMs).toISOString().substr(14, 5);
        const position = new Date(currentMs).toISOString().substr(14, 5);
        const deci = Math.floor((currentMs % 1000) / 100);
        const positionDeci = `${position}.${deci}`;
        const bar = this.createProgressBar(currentMs, totalMs, 24, true);
        const mode = this.loopModeByGuild.get(player.guildId) || 'off';
        const queueLength = player.queue.size;
        const requester = track.info.requester ? `<@${track.info.requester.id}>` : 'Unknown';
        const remainingMs = Math.max(0, totalMs - currentMs);
        const remaining = new Date(remainingMs).toISOString().substr(14, 5);
        const percent = totalMs > 0 ? Math.floor((currentMs / totalMs) * 100) : 0;
        return new EmbedBuilder()
            .setColor(0x0E1B4D)
            .setAuthor({ name: `${guild.name}`, iconURL: guild.iconURL({ size: 128 }) || this.client.user.displayAvatarURL({ size: 128 }) })
            .setTitle('Now Playing')
            .setURL(track.info.uri)
            .setDescription([
                bar,
                `⏱ ${positionDeci} / ${duration}`,
                `🎶 ${track.info.title}`,
                `by ${track.info.author} • Requested by ${requester}`,
                `👑 **Seul ${requester} peut contrôler cette musique**`
            ].join('\n'))
            .setThumbnail(track.info.thumbnail || this.client.user.displayAvatarURL({ size: 128 }))
            .setFooter({ text: `by ${track.info.author} • Loop: ${mode} • Queue: ${queueLength} • Volume: ${player.volume ?? 100}%` })
            .setTimestamp();
    }

    // Style: Fields (structuré)
    createNowPlayingEmbedFields(player, track, guild) {
        const totalMs = Number(track.info.length) || 0;
        const currentMs = Number(player.position || 0);
        const duration = new Date(totalMs).toISOString().substr(14, 5);
        const position = new Date(currentMs).toISOString().substr(14, 5);
        const requester = track.info.requester ? `<@${track.info.requester.id}>` : 'Unknown';
        const topRule = '──────────────';
        return new EmbedBuilder()
            .setColor(0x1F2937)
            .setAuthor({ name: 'Now Playing', iconURL: guild.iconURL({ size: 128 }) || this.client.user.displayAvatarURL({ size: 128 }) })
            .setTitle(track.info.title)
            .setURL(track.info.uri)
            .setThumbnail(track.info.thumbnail || this.client.user.displayAvatarURL({ size: 128 }))
            .setDescription(`${topRule}\n_${track.info.author}_\n${topRule}`)
            .addFields(
                { name: 'Artist', value: track.info.author || 'Unknown', inline: true },
                { name: 'Time', value: `${position} / ${duration}`, inline: true },
                { name: 'Requested by', value: requester, inline: true },
                { name: 'Queue', value: String(player.queue.size), inline: true },
                { name: 'Volume', value: `${player.volume ?? 100}%`, inline: true },
                { name: 'Loop', value: (this.loopModeByGuild.get(player.guildId) || 'off').toString(), inline: true }
            )
            .setFooter({ text: '— • — • —' })
            .setTimestamp();
    }

    // Style: Compact (mobile-friendly)
    createNowPlayingEmbedCompact(player, track, guild) {
        const totalMs = Number(track.info.length) || 0;
        const currentMs = Number(player.position || 0);
        const duration = new Date(totalMs).toISOString().substr(14, 5);
        const position = new Date(currentMs).toISOString().substr(14, 5);
        const size = 18;
        const ratio = totalMs > 0 ? Math.max(0, Math.min(1, currentMs / totalMs)) : 0;
        const idx = Math.min(size - 1, Math.floor(ratio * size));
        let bar = '';
        for (let i = 0; i < size; i++) bar += i === idx ? '🔘' : '▬';
        const requester = track.info.requester ? `<@${track.info.requester.id}>` : 'Unknown';
        const rule = '────────────';
        return new EmbedBuilder()
            .setColor(0x0D9488)
            .setDescription([
                `▶ [${track.info.title}](${track.info.uri})`,
                `_${track.info.author}_`,
                rule,
                `${bar} \`${position}/${duration}\``,
                `Requested by ${requester}`
            ].join('\n'))
            .setThumbnail(track.info.thumbnail || this.client.user.displayAvatarURL({ size: 128 }))
            .setTimestamp();
    }

    // Style: Poster (grand visuel)
    createNowPlayingEmbedPoster(player, track, guild) {
        const totalMs = Number(track.info.length) || 0;
        const currentMs = Number(player.position || 0);
        const duration = new Date(totalMs).toISOString().substr(14, 5);
        const position = new Date(currentMs).toISOString().substr(14, 5);
        const requester = track.info.requester ? `<@${track.info.requester.id}>` : 'Unknown';
        const rule = '────────────────────────';
        return new EmbedBuilder()
            .setColor(0x3B82F6)
            .setTitle(track.info.title)
            .setURL(track.info.uri)
            .setDescription([`
_${track.info.author}_`,
                rule,
                `⏱ ${position} / ${duration}`,
                rule,
                `Requested by ${requester}`
            ].join('\n'))
            .setImage(track.info.thumbnail || this.client.user.displayAvatarURL({ size: 256 }))
            .setTimestamp();
    }

    createProgressBar(currentMs, totalMs, size, _showTicks = false) {
        // YouTube-like: a single sleek line with a circle cursor
        if (!totalMs || totalMs <= 0) return '─'.repeat(size);
        const ratio = Math.max(0, Math.min(1, currentMs / totalMs));
        const index = Math.min(size - 1, Math.floor(ratio * size));
        const before = '━'.repeat(Math.max(0, index));
        const knob = '●';
        const after = '─'.repeat(Math.max(0, size - index - 1));
        return before + knob + after;
    }

    buildControlRows(guildId, player, user = null) {
        const isPaused = Boolean(player?.paused);
        const toggleEmoji = isPaused ? '▶️' : '⏸️';
        
        // Vérifier les permissions de contrôle
        let canControl = true;
        if (user) {
            const member = this.client.guilds.cache.get(guildId)?.members?.cache?.get(user.id);
            canControl = this.canControlMusic(member, player);
        }
        
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ctl_play_${guildId}`).setEmoji('▶').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            // previous track
            new ButtonBuilder().setCustomId(`ctl_prevtrack_${guildId}`).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_pause_${guildId}`).setEmoji(toggleEmoji).setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            // next track
            new ButtonBuilder().setCustomId(`ctl_skip_${guildId}`).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            // jump info helper
            new ButtonBuilder().setCustomId(`ctl_jump_${guildId}`).setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ctl_voldown_${guildId}`).setEmoji('🔉').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            // quick slow mode toggle
            new ButtonBuilder().setCustomId(`ctl_qslow_${guildId}`).setEmoji('🐌').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_like_${guildId}`).setEmoji('❤️').setStyle(ButtonStyle.Secondary),
            // quick fast mode toggle
            new ButtonBuilder().setCustomId(`ctl_qfast_${guildId}`).setEmoji('⚡').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_volup_${guildId}`).setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
        );
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ctl_247_${guildId}`).setEmoji('🕐').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_loop_${guildId}`).setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_clear_${guildId}`).setEmoji('🗑️').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_filter_${guildId}`).setEmoji('🎛️').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
            new ButtonBuilder().setCustomId(`ctl_stop_${guildId}`).setEmoji('⏹️').setStyle(ButtonStyle.Secondary).setDisabled(!canControl),
        );
        return [row1, row2, row3];
    }

    async buildSelectRows(guildId, track, user = null) {
        const rows = [];
        
        // Vérifier les permissions de contrôle
        let canControl = true;
        if (user) {
            const member = this.client.guilds.cache.get(guildId)?.members?.cache?.get(user.id);
            const player = this.riffy.players.get(guildId);
            canControl = this.canControlMusic(member, player);
        }
        
        try {
            const suggestions = await this.riffy.resolve({ query: `${track.info.author} ${track.info.title}`, requester: track.info.requester || this.client.user });
            const options = (suggestions.tracks || []).slice(0, 5).map((t, i) => ({ label: t.info.title.substring(0, 100), value: `s_${i}` }));
            if (options.length) {
                const select = new (require('discord.js').StringSelectMenuBuilder)()
                    .setCustomId(`sel_suggest_${guildId}`)
                    .setPlaceholder('Suggested Tracks!')
                    .setDisabled(!canControl)
                    .addOptions(options);
                rows.push(new ActionRowBuilder().addComponents(select));
                this.suggestionsCache.set(`sel_suggest_${guildId}`, suggestions.tracks.slice(0, 5));
            }
        } catch {}
        const quality = new (require('discord.js').StringSelectMenuBuilder)()
            .setCustomId(`sel_quality_${guildId}`)
            .setPlaceholder('Select Quality')
            .setDisabled(!canControl)
            .addOptions(
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
            );
        rows.push(new ActionRowBuilder().addComponents(quality));
        return rows;
    }

    buildQueuePageEmbed(player, page, perPage) {
        const start = page * perPage;
        const items = player.queue.slice(start, start + perPage);
        const lines = items.map((t, i) => {
            const duration = new Date(t.info.length).toISOString().substr(14, 5);
            return `${start + i + 1}. **${t.info.title}** by ${t.info.author} [${duration}]`;
        }).join('\n') || 'No tracks.';
        const embed = this.createEmbed('Current Queue', lines);
        if (player.current) embed.addFields({ name: 'Now Playing', value: `**${player.current.info.title}**`, inline: false });
        embed.setFooter({ text: `Page ${page + 1} of ${Math.max(1, Math.ceil(player.queue.size / perPage))} | BotMusicDiscord by Rayan elhabib` });
        return embed;
    }

    buildQueueRow(userId, page, totalPages) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`q_prev_${userId}_${page}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`q_next_${userId}_${page}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        );
    }

    async handleControlInteraction(interaction) {
        console.log('=== BUTTON INTERACTION START ===');
        console.log('Interaction customId:', interaction.customId);
        
        // Parse the interaction ID safely
        const parts = interaction.customId.split('_');
        console.log('Parsed parts:', parts);
        
        if (parts.length < 3) {
            console.log('Invalid button configuration - not enough parts');
            await this.safeReply(interaction, 'Invalid button configuration.');
            return;
        }

        const action = parts[1];
        const guildId = parts[2];
        console.log('Action:', action);
        console.log('GuildId:', guildId);
        
        // Get player safely
            const player = this.riffy.players.get(guildId);
            if (!player) {
            await this.safeReply(interaction, 'No active player.');
                return;
            }

        // Check permissions (SEULEMENT le propriétaire de la piste)
            const member = interaction.guild?.members?.cache?.get(interaction.user.id);
            if (!this.canControlMusic(member, player)) {
                const errorMessage = 'Seul la personne qui a lancé cette musique peut la contrôler.';
                await this.safeReply(interaction, errorMessage);
                return;
            }

        // Defer reply to prevent timeout
            if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }

            let response = '';
        
        try {
            // Handle different button actions
            switch (action) {
                case 'play':
                if (!player.playing) player.play();
                response = 'Playing.';
                    break;
                    
                case 'pause':
                player.pause(!player.paused);
                response = player.paused ? 'Paused.' : 'Resumed.';
                    break;
                    
                // removed legacy seek buttons (prev10/next10)
                    
                case 'skip':
                    if (!player.queue.size) {
                        response = 'No next track.';
                    } else {
                player.stop();
                        response = 'Skipped to next.';
                    }
                    break;
                    
                case 'prevtrack':
                    response = await this.handlePreviousTrack(player, guildId, interaction.user);
                    break;
                    
                case 'stop':
                player.destroy();
                response = 'Stopped and cleared.';
                    break;
                    
                case 'voldown':
                    const volDown = Math.max(0, (player.volume ?? 100) - 10);
                    player.setVolume(volDown);
                    response = `Volume: ${volDown}%`;
                    break;
                    
                case 'volup':
                    const volUp = Math.min(200, (player.volume ?? 100) + 10);
                    player.setVolume(volUp);
                    response = `Volume: ${volUp}%`;
                    break;
                    
                case 'clear':
                player.queue.clear();
                response = 'Cleared queue.';
                    break;
                    
                case 'loop':
                const cur = this.loopModeByGuild.get(guildId) || 'off';
                const next = cur === 'off' ? 'track' : cur === 'track' ? 'queue' : 'off';
                this.loopModeByGuild.set(guildId, next);
                response = `Loop: ${next}`;
                    break;
                    
                case 'shuffle':
                if (player.queue.size < 2) {
                        response = 'Not enough tracks to shuffle.';
                    } else {
                const shuffled = player.queue.sort(() => Math.random() - 0.5);
                player.queue.clear();
                shuffled.forEach(t => player.queue.add(t));
                response = 'Shuffled.';
            }
                    break;
                    
                case '247':
                    const enabled = this.stayInChannelGuilds.has(guildId);
                    if (enabled) {
                        this.stayInChannelGuilds.delete(guildId);
                    } else {
                        this.stayInChannelGuilds.add(guildId);
                    }
                    response = `24/7 ${enabled ? 'disabled' : 'enabled'}.`;
                    break;
                    
                case 'like':
                    response = 'Saved track (placeholder).';
                    break;
                    
                case 'jump':
                    response = 'Use +jump <index> command for precise jump.';
                    break;
                    
                case 'filter':
                    response = 'Use +filter command to apply filters.';
                    break;
                    
                default:
                    response = 'Unknown button action.';
                    break;
            }
            
            // Quick speed modes
            if (action === 'qslow' || action === 'qfast') {
                const currentMode = this.quickModeByGuild.get(guildId) || 'normal';
                const targetMode = action === 'qslow' ? (currentMode === 'slow' ? 'normal' : 'slow') : (currentMode === 'fast' ? 'normal' : 'fast');
                this.quickModeByGuild.set(guildId, targetMode);
                try {
                    if (targetMode === 'slow') {
                        player.filters.setTimescale(true, { rate: 0.85, pitch: 1.0, speed: 1.0 });
                        response = 'Slow mode: ON (0.85x)';
                    } else if (targetMode === 'fast') {
                        player.filters.setTimescale(true, { rate: 1.25, pitch: 1.0, speed: 1.0 });
                        response = 'Fast mode: ON (1.25x)';
                    } else {
                        player.filters.clearTimescale?.();
                        player.filters.setTimescale(false);
                        response = 'Playback speed: normal';
                    }
                } catch (e) {
                    console.error('Failed to toggle speed mode:', e);
                    response = 'Failed to toggle speed mode.';
                }
            }
        } catch (error) {
            console.error(`Error in button action ${action}:`, error);
            response = 'Action failed. Please try again.';
        }

        // Send response safely
        await this.safeReply(interaction, response);

        // Update control panel if needed
            try {
                const controlId = this.controlMessageByGuild.get(guildId);
                if (controlId && interaction.message?.id === controlId && player.current) {
                    const updated = this.createNowPlayingEmbed(player, player.current, interaction.guild);
                    const selects = await this.buildSelectRows(guildId, player.current, interaction.user);
                    const rows = this.buildControlRows(guildId, player, interaction.user);
                    await interaction.message.edit({ embeds: [updated], components: [...selects, ...rows] });
                }
        } catch (updateError) {
            console.error('Failed to update control panel:', updateError);
        }
    }

    // handle seek buttons (seek:<ms>) – improved, robust version
    async handleButton(interaction) {
        try {
            if (!interaction.isButton()) return;

            const rawId = String(interaction.customId || '');
            console.log('[SEEK] button pressed:', rawId);
            // Accept only exact pattern: seek:<signed-integer>
            const m = rawId.match(/^seek:(-?\d+)$/);
            if (!m) return;
            const delta = Number.parseInt(m[1], 10);
            if (Number.isNaN(delta)) return;

            // Quick ack to avoid the interaction timing out
            if (!interaction.deferred && !interaction.replied) {
                try { await interaction.deferUpdate(); } catch {}
            }

            const guildId = interaction.guildId;
            if (!guildId) { console.warn('[SEEK] missing guildId'); return; }

            const player = this.riffy?.players?.get(guildId);
            if (!player || !player.current) { console.warn('[SEEK] no player/current for guild', guildId); return; }

            // Guard: live/streaming tracks may not support seeking
            try {
                const info = player.current?.info || {};
                if (info.isStream === true || info.isSeekable === false) {
                    try { await interaction.followUp({ content: 'This track cannot be seeked (live/stream).', flags: MessageFlags.Ephemeral }); } catch {}
                    return;
                }
            } catch {}

            // Optional: per-guild seek lock to avoid overlapping seeks
            this._seekLocks = this._seekLocks || new Set();
            if (this._seekLocks.has(guildId)) {
                console.warn('[SEEK] lock active, ignoring concurrent seek in guild', guildId);
                // Another seek in progress — best-effort ignore to avoid races
                return;
            }
            this._seekLocks.add(guildId);

            try {
                const currentMs = Number(player.position || 0);
                const durationMs = Number(player.current?.info?.length || 0);
                if (!Number.isFinite(currentMs) || !Number.isFinite(durationMs) || durationMs <= 0) { console.warn('[SEEK] invalid pos/duration', { currentMs, durationMs }); return; }

                // Dynamic safety margin: 5% of duration, clamped to [5s, 15s]
                const safetyMs = Math.max(5000, Math.min(15000, Math.floor(durationMs * 0.05)));
                const maxSeek = Math.max(0, durationMs - safetyMs);

                let target = currentMs + delta;
                if (target < 0) target = 0;
                if (target > maxSeek) target = maxSeek;

                if (target === currentMs) { console.log('[SEEK] noop target equals current'); return; }
                console.log('[SEEK] calc', { guildId, delta, currentMs, durationMs, safetyMs, maxSeek, target });

                // Seek (support both Promise-returning and sync implementations)
                if (typeof player.seek === 'function') {
                    try {
                        await player.seek(target);
                    } catch (err) {
                        // fallback non-blocking (best-effort)
                        try { player.seek(target); } catch (_) {}
                    }
                }

                // Update the embed footer with new time (best-effort)
                let msg = interaction.message;
                try {
                    // If partial message, attempt to fetch a full message
                    if (msg && msg.partial && typeof msg.fetch === 'function') {
                        try { msg = await msg.fetch(); } catch {}
                    }
                } catch {}

                if (msg && msg.editable) {
                    try {
                        // Build a fresh EmbedBuilder from the first embed (if present)
                        const orig = msg.embeds && msg.embeds[0];
                        const embed = orig ? EmbedBuilder.from(orig) : new EmbedBuilder();

                        const fmt = (ms) => {
                            const s = Math.max(0, Math.floor(ms / 1000));
                            const m = Math.floor(s / 60);
                            const ss = s % 60;
                            return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
                        };
                        const footerText = `▶ ${fmt(target)} / ${fmt(durationMs)}`;

                        // Preserve existing footer fields but replace text
                        const prevFooter = embed.data?.footer || {};
                        embed.setFooter({ text: footerText, iconURL: prevFooter.iconURL });

                        // Try to edit message while preserving components
                        await msg.edit({ embeds: [embed], components: msg.components });
                    } catch (e) {
                        // ignore embed update errors — not critical
                    }
                }

                // If playback stopped unexpectedly, try to resume playback (best-effort)
                try {
                    if (!player.playing && !player.paused && typeof player.play === 'function') {
                        try { player.play(); } catch {}
                    }
                } catch {}
            } finally {
                // release lock
                this._seekLocks.delete(guildId);
            }
        } catch (e) {
            console.error('handleButton(seek) error:', e);
        }
    }

    // Handle string select menus (suggested tracks / quality)
    async handleSelect(interaction) {
        try {
            if (!interaction.isStringSelectMenu()) return;
            const id = String(interaction.customId || '');

            if (id.startsWith('sel_suggest_')) {
                const guildId = id.split('_')[2];
                const tracks = this.suggestionsCache.get(`sel_suggest_${guildId}`) || [];
                const index = Number((interaction.values[0] || '').replace('s_', ''));
                const pick = tracks[index];
                const player = this.riffy.players.get(guildId);
                if (!player || !pick) return await this.safeComponentReply(interaction, '❌ Aucune piste disponible.', true);
                
                // Vérifier les permissions
                const member = interaction.guild?.members?.cache?.get(interaction.user.id);
                if (!this.canControlMusic(member, player)) {
                    const errorMessage = '❌ Seul la personne qui a lancé cette musique peut ajouter des suggestions.';
                    return await this.safeComponentReply(interaction, errorMessage, true);
                }
                
                pick.info.requester = interaction.user;
                player.queue.add(pick);
                if (!player.playing && !player.paused) player.play();
                
                return await this.safeComponentReply(interaction, `✅ Ajouté à la file: ${pick.info.title}`, true);
            }

            if (id.startsWith('sel_quality_')) {
                const guildId = id.split('_')[2];
                const player = this.riffy.players.get(guildId);
                if (!player) return await this.safeComponentReply(interaction, '❌ Aucun lecteur actif.', true);
                
                // Vérifier les permissions
                const member = interaction.guild?.members?.cache?.get(interaction.user.id);
                if (!this.canControlMusic(member, player)) {
                    const errorMessage = '❌ Seul la personne qui a lancé cette musique peut changer la qualité.';
                    return await this.safeComponentReply(interaction, errorMessage, true);
                }
                
                const val = interaction.values[0];
                const vol = val === 'low' ? 60 : val === 'medium' ? 100 : 140;
                player.setVolume(vol);
                
                return await this.safeComponentReply(interaction, `✅ Qualité définie: ${val} (volume ${vol}%)`, true);
            }
        } catch (e) {
            console.error('handleSelect error:', e);
        }
    }

    // Helper method for safe interaction replies
    async safeReply(interaction, content) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
                } else {
                await interaction.editReply({ content });
            }
        } catch (error) {
            console.error('Failed to send reply:', error);
        }
    }

    // Helper method for component interactions that should preserve components
    async safeComponentReply(interaction, content, preserveComponents = true) {
        try {
            if (preserveComponents && interaction.isStringSelectMenu()) {
                // Pour les menus de sélection, utiliser deferUpdate pour garder les composants
                await interaction.deferUpdate();
                // Envoyer un message temporaire qui disparaîtra
                return await interaction.followUp({ 
                    content: content, 
                    flags: MessageFlags.Ephemeral,
                    ephemeral: true
                });
            } else {
                // Pour les autres interactions, utiliser la méthode normale
                return await this.safeReply(interaction, content);
            }
        } catch (error) {
            console.error('Failed to send component reply:', error);
            // Fallback vers la méthode normale
            return await this.safeReply(interaction, content);
        }
    }

    // Handle seek backward (-10s) - VERSION SIMPLIFIÉE ET FONCTIONNELLE
    async handleSeekBackward(player, guildId) {
        try {
            console.log('=== SEEK BACKWARD START ===');
            
            // Vérification simple et efficace
            if (!player || !player.current) {
                console.log('No player or no current track');
                return 'No track playing.';
            }

            const currentPos = player.position || 0;
            const newPos = Math.max(0, currentPos - 10_000);
            
            console.log(`Seek -10s: current=${currentPos}ms, new=${newPos}ms`);
            
            // Vérifier si on est déjà au début
            if (currentPos === 0) {
                console.log('Already at start');
                return 'Already at start.';
            }

            // Vérifier si le seek va changer la position
            if (newPos === currentPos) {
                console.log('No change in position');
                return 'Cannot seek backward from current position.';
            }

            console.log('Executing seek backward...');
            
            // Exécuter le seek directement
            player.seek(newPos);
            console.log(`Seek -10s completed: ${Math.floor(currentPos/1000)}s → ${Math.floor(newPos/1000)}s`);
            return `Seek -10s (${Math.floor(currentPos/1000)}s → ${Math.floor(newPos/1000)}s).`;
            
        } catch (error) {
            console.error('Seek backward error:', error);
            return 'Seek failed: ' + error.message + ' | BotMusicDiscord by Rayan elhabib';
        }
    }

    // Handle seek forward (+10s) - VERSION SIMPLIFIÉE ET FONCTIONNELLE
    async handleSeekForward(player, guildId) {
        try {
            console.log('=== SEEK FORWARD START ===');
            
            // Vérification simple et efficace
            if (!player || !player.current) {
                console.log('No player or no current track');
                return 'No track playing.';
            }

            const currentPos = player.position || 0;
            const trackLength = player.current.info.length;
            const newPos = Math.min(trackLength, currentPos + 10_000);
            
            console.log(`Seek +10s: current=${currentPos}ms, new=${newPos}ms, length=${trackLength}ms`);
            
            if (newPos >= trackLength) {
                console.log('Already at end');
                return 'Already at start.';
            }

            if (newPos === currentPos) {
                console.log('No change in position');
                return 'Cannot seek forward from current position.';
            }

            console.log('Executing seek forward...');
            
            // Exécuter le seek directement
            player.seek(newPos);
            console.log(`Seek +10s completed: ${Math.floor(currentPos/1000)}s → ${Math.floor(newPos/1000)}s`);
            return `Seek +10s (${Math.floor(currentPos/1000)}s → ${Math.floor(newPos/1000)}s).`;
            
        } catch (error) {
            console.error('Seek forward error:', error);
            return 'Seek failed: ' + error.message + ' | BotMusicDiscord by Rayan elhabib';
        }
    }

    // Handle previous track
    async handlePreviousTrack(player, guildId, user) {
        try {
            const hist = this.playHistoryByGuild.get(guildId) || [];
            if (!hist.length) {
                return 'No previous track.';
            }

            const previousTrack = hist.pop();
            this.playHistoryByGuild.set(guildId, hist);

            const items = player.queue.slice(0);
            player.queue.clear();
            
            // Put previous track first, then current (to not lose it), then the rest
            previousTrack.info.requester = previousTrack.info.requester || user;
            player.queue.add(previousTrack);
            
            if (player.current) {
                const cur = player.current;
                cur.info.requester = cur.info.requester || user;
                player.queue.add(cur);
            }
            
            items.forEach(t => player.queue.add(t));
            player.stop();
            
            return 'Playing previous track.';
        } catch (error) {
            console.error('Previous track error:', error);
            return 'Could not go to previous track.';
        }
    }

    // Ensure playlist JSON file exists
    async ensurePlaylistFile() {
        try {
            await fs.access(this.playlistFile);
        } catch {
            await fs.writeFile(this.playlistFile, JSON.stringify({}));
        }
    }

    // Ensure stats JSON file exists
    async ensureStatsFile() {
        try {
            await fs.access(this.statsFile);
        } catch {
            await fs.writeFile(this.statsFile, JSON.stringify({}));
        }
    }

    // Initialize user stats if they don't exist
    initializeUserStats(userId) {
        if (!this.userStats.has(userId)) {
            this.userStats.set(userId, {
                servers: new Map(),
                friends: new Map(),
                tracks: new Map(),
                totalTime: 0
            });
        }
        return this.userStats.get(userId);
    }

    // Load playlists from JSON
    async loadPlaylists() {
        const data = await fs.readFile(this.playlistFile, 'utf8');
        return JSON.parse(data);
    }

    // Save playlists to JSON
    async savePlaylists(playlists) {
        await fs.writeFile(this.playlistFile, JSON.stringify(playlists, null, 2));
    }

    // Load user stats from JSON
    async loadUserStats() {
        try {
            const data = await fs.readFile(this.statsFile, 'utf8');
            const stats = JSON.parse(data);
            
            // Convert back to Maps for efficient lookups
            for (const [userId, userData] of Object.entries(stats)) {
                if (userData.servers) {
                    userData.servers = new Map(Object.entries(userData.servers));
                }
                if (userData.friends) {
                    userData.friends = new Map(Object.entries(userData.friends));
                }
                if (userData.tracks) {
                    userData.tracks = new Map(Object.entries(userData.tracks));
                }
            }
            
            return stats;
        } catch {
            return {};
        }
    }

    // Save user stats to JSON
    async saveUserStats() {
        try {
            const statsToSave = {};
            
            for (const [userId, userData] of this.userStats.entries()) {
                statsToSave[userId] = {
                    servers: Object.fromEntries(userData.servers),
                    friends: Object.fromEntries(userData.friends),
                    tracks: Object.fromEntries(userData.tracks),
                    totalTime: userData.totalTime
                };
            }
            
            await fs.writeFile(this.statsFile, JSON.stringify(statsToSave, null, 2));
        } catch (error) {
            console.error('Error saving user stats:', error);
        }
    }

    // 🎵 SYSTÈME DE STATISTIQUES INDÉPENDANT ET ULTRA-PERFORMANT
    updateUserStats(userId, guildId, track, duration) {
        try {
            // Utiliser le cache intelligent au lieu de Lavalink
            const cacheKey = `stats_${userId}`;
            
            // Vérifier le cache d'abord
            if (!this.userStatsCache.has(cacheKey)) {
                // Créer de nouvelles stats si elles n'existent pas
                const newStats = {
                    userId: userId,
                    servers: new Map(),
                    friends: new Map(),
                    tracks: new Map(),
                    totalTime: 0,
                    lastSeen: Date.now(),
                    playCount: 0,
                    favoriteGenres: new Map(),
                    listeningSessions: [],
                    achievements: new Set()
                };
                
                this.userStatsCache.set(cacheKey, newStats);
                this.cacheExpiry.set(cacheKey, Date.now() + this.cacheTimeout);
            }

            const userData = this.userStatsCache.get(cacheKey);
            
            // Mise à jour des statistiques en temps réel
            this.updateServerStats(userData, guildId, duration);
            this.updateTrackStats(userData, track, duration);
            this.updateListeningSession(userData, guildId, track);
            this.updateAchievements(userData);
            
            // Mise à jour des métriques globales
            this.logMetric('tracksPlayed', 1);
            
            // Sauvegarde intelligente (seulement si nécessaire)
            this.smartStatsSave(userId, userData);
            
        } catch (error) {
            console.error('❌ Erreur lors de la mise à jour des stats:', error);
            // Utiliser le wrapper de sécurité
            this.safeOperation(() => this.fallbackStatsUpdate(userId, guildId, track, duration), null, 'updateUserStats');
        }
    }

    // 🏆 Mise à jour des statistiques serveur
    updateServerStats(userData, guildId, duration) {
        try {
            const serverTime = userData.servers.get(guildId) || 0;
            userData.servers.set(guildId, serverTime + duration);
            
            // Statistiques avancées par serveur
            if (!userData.serverStats) userData.serverStats = new Map();
            if (!userData.serverStats.has(guildId)) {
                userData.serverStats.set(guildId, {
                    totalTime: 0,
                    playCount: 0,
                    lastPlayed: Date.now(),
                    favoriteTracks: new Map(),
                    activeHours: new Map()
                });
            }
            
            const serverStats = userData.serverStats.get(guildId);
            serverStats.totalTime += duration;
            serverStats.playCount += 1;
            serverStats.lastPlayed = Date.now();
            
            // Suivi des heures actives
            const hour = new Date().getHours();
            const activeHours = serverStats.activeHours.get(hour) || 0;
            serverStats.activeHours.set(hour, activeHours + duration);
            
        } catch (error) {
            console.error('❌ Erreur mise à jour stats serveur:', error);
        }
    }

    // 🎵 Mise à jour des statistiques de tracks
    updateTrackStats(userData, track, duration) {
        try {
            const trackKey = `${track.info.title} - ${track.info.author}`;
            const trackTime = userData.tracks.get(trackKey) || 0;
            userData.tracks.set(trackKey, trackTime + duration);
            
            // Statistiques avancées par track
            if (!userData.trackStats) userData.trackStats = new Map();
            if (!userData.trackStats.has(trackKey)) {
                userData.trackStats.set(trackKey, {
                    title: track.info.title,
                    author: track.info.author,
                    totalTime: 0,
                    playCount: 0,
                    firstPlayed: Date.now(),
                    lastPlayed: Date.now(),
                    platforms: new Set(),
                    genres: new Set()
                });
            }
            
            const trackStats = userData.trackStats.get(trackKey);
            trackStats.totalTime += duration;
            trackStats.playCount += 1;
            trackStats.lastPlayed = Date.now();
            
            // Détection automatique de plateforme
            if (track.info.uri) {
                if (track.info.uri.includes('youtube.com') || track.info.uri.includes('youtu.be')) {
                    trackStats.platforms.add('YouTube');
                } else if (track.info.uri.includes('spotify.com')) {
                    trackStats.platforms.add('Spotify');
                } else if (track.info.uri.includes('soundcloud.com')) {
                    trackStats.platforms.add('SoundCloud');
                }
            }
            
            // Mise à jour du temps total
            userData.totalTime += duration;
            userData.playCount += 1;
            
        } catch (error) {
            console.error('❌ Erreur mise à jour stats track:', error);
        }
    }

    // 📊 Mise à jour des sessions d'écoute
    updateListeningSession(userData, guildId, track) {
        try {
            const session = {
                guildId: guildId,
                trackTitle: track.info.title,
                trackAuthor: track.info.author,
                duration: track.info.length,
                timestamp: Date.now(),
                platform: this.detectPlatform(track.info.uri)
            };
            
            userData.listeningSessions.push(session);
            
            // Garder seulement les 100 dernières sessions
            if (userData.listeningSessions.length > 100) {
                userData.listeningSessions = userData.listeningSessions.slice(-100);
            }
            
        } catch (error) {
            console.error('❌ Erreur mise à jour session écoute:', error);
        }
    }

    // 🏅 Mise à jour des achievements
    updateAchievements(userData) {
        try {
            const achievements = userData.achievements;
            
            // Achievement: Première écoute
            if (userData.playCount === 1) {
                achievements.add('FIRST_LISTEN');
            }
            
            // Achievement: 10 tracks écoutés
            if (userData.playCount === 10) {
                achievements.add('MUSIC_LOVER');
            }
            
            // Achievement: 1 heure d'écoute
            if (userData.totalTime >= 3600000) {
                achievements.add('HOUR_LISTENER');
            }
            
            // Achievement: 10 heures d'écoute
            if (userData.totalTime >= 36000000) {
                achievements.add('DEDICATED_LISTENER');
            }
            
            // Achievement: Écoute sur 3 serveurs différents
            if (userData.servers.size >= 3) {
                achievements.add('MULTI_SERVER');
            }
            
        } catch (error) {
            console.error('❌ Erreur mise à jour achievements:', error);
        }
    }

    // 🔍 Détection de plateforme
    detectPlatform(uri) {
        if (!uri) return 'Unknown';
        
        if (uri.includes('youtube.com') || uri.includes('youtu.be')) {
            return 'YouTube';
        } else if (uri.includes('spotify.com')) {
            return 'Spotify';
        } else if (uri.includes('soundcloud.com')) {
            return 'SoundCloud';
        } else if (uri.includes('deezer.com')) {
            return 'Deezer';
        } else if (uri.includes('apple.com') || uri.includes('itunes')) {
            return 'Apple Music';
        } else {
            return 'Other';
        }
    }

    // 💾 Sauvegarde intelligente des statistiques
    smartStatsSave(userId, userData) {
        try {
            // Sauvegarde par lots toutes les 10 minutes
            if (!this._statsSaveTimeout) {
                this._statsSaveTimeout = setTimeout(() => {
                    this.batchSaveStats();
                    this._statsSaveTimeout = null;
                }, this.statsSaveInterval);
            }
            
            // Sauvegarde immédiate si les stats sont importantes
            if (userData.playCount % 10 === 0) {
                this.immediateStatsSave(userId, userData);
            }
            
        } catch (error) {
            console.error('❌ Erreur sauvegarde intelligente:', error);
        }
    }

    // ⚡ Sauvegarde immédiate des stats importantes
    async immediateStatsSave(userId, userData) {
        try {
            const statsToSave = {
                ...userData,
                servers: Object.fromEntries(userData.servers),
                friends: Object.fromEntries(userData.friends),
                tracks: Object.fromEntries(userData.tracks),
                serverStats: Object.fromEntries(userData.serverStats || new Map()),
                trackStats: Object.fromEntries(userData.trackStats || new Map()),
                achievements: Array.from(userData.achievements || new Set()),
                listeningSessions: userData.listeningSessions || []
            };
            
            // Sauvegarde dans un fichier temporaire
            const tempFile = `${this.statsFile}.tmp`;
            await fs.writeFile(tempFile, JSON.stringify(statsToSave, null, 2));
            
            // Remplacer le fichier principal
            await fs.rename(tempFile, this.statsFile);
            
            console.log(`💾 Stats immédiates sauvegardées pour l'utilisateur ${userId}`);
            
        } catch (error) {
            console.error('❌ Erreur sauvegarde immédiate:', error);
        }
    }

    // 🔄 Méthode de fallback pour les stats
    fallbackStatsUpdate(userId, guildId, track, duration) {
        try {
            // Méthode simple de sauvegarde en cas d'erreur
            const fallbackData = {
                userId: userId,
                guildId: guildId,
                trackTitle: track.info.title,
                trackAuthor: track.info.author,
                duration: duration,
                timestamp: Date.now()
            };
            
            // Sauvegarder dans un fichier de fallback
            const fallbackFile = `${this.statsFile}.fallback`;
            fs.appendFileSync(fallbackFile, JSON.stringify(fallbackData) + '\n');
            
            console.log(`🔄 Fallback stats sauvegardées pour ${userId}`);
            
        } catch (error) {
            console.error('❌ Erreur fallback stats:', error);
        }
    }

    // Format time from milliseconds to human readable format
    formatTime(ms) {
        if (!ms || ms <= 0) return '0m 0s';
        
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // Show user profile for prefix commands
    async showUserProfile(message, userId) {
        try {
            // Load stats if not already loaded
            if (this.userStats.size === 0) {
                const loadedStats = await this.loadUserStats();
                for (const [uid, data] of Object.entries(loadedStats)) {
                    this.userStats.set(uid, data);
                }
            }

            const userData = this.userStats.get(userId);
            if (!userData || userData.totalTime == 0) {
                return message.reply({ embeds: [this.createEmbed('No Statistics', 'You haven\'t listened to any music yet. Start playing some tracks to build your profile!')] });
            }

            const result = await this.createProfileEmbed(userId, userData, message.guild);
            if (result.attachment) {
                await message.reply({ embeds: [result.embed], files: [result.attachment] });
            } else {
                await message.reply({ embeds: [result] });
            }
        } catch (error) {
            console.error('Error showing user profile:', error);
            await message.reply({ embeds: [this.createEmbed('Error', 'Failed to load your profile. Please try again later.')] });
        }
    }

    // Show user profile for slash commands
    async showUserProfileSlash(interaction, userId) {
        try {
            await interaction.deferReply();
            
            // Load stats if not already loaded
            if (this.userStats.size === 0) {
                const loadedStats = await this.loadUserStats();
                for (const [uid, data] of Object.entries(loadedStats)) {
                    this.userStats.set(uid, data);
                }
            }

            const userData = this.userStats.get(userId);
            if (!userData || userData.totalTime == 0) {
                return interaction.editReply({ embeds: [this.createEmbed('No Statistics', 'You haven\'t listened to any music yet. Start playing some tracks to build your profile!')] });
            }

            const result = await this.createProfileEmbed(userId, userData, interaction.guild);
            if (result.attachment) {
                await interaction.editReply({ embeds: [result.embed], files: [result.attachment] });
            } else {
                await interaction.editReply({ embeds: [result] });
            }
        } catch (error) {
            console.error('Error showing user profile:', error);
            await interaction.editReply({ embeds: [this.createEmbed('Error', 'Failed to load your profile. Please try again later.')] });
        }
    }

    // Create profile embed
    createProfileEmbed(userId, userData, guild) {
        const embed = new EmbedBuilder()
            .setColor(0xFF7A00)
            .setTitle('🎵 Music Profile')
            .setTimestamp();

        // Get user info
        const user = this.client.users.cache.get(userId);
        if (user) {
            embed.setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 128 }) });
            embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
        }

        // Top Servers
        const topServers = Array.from(userData.servers.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        
        let serversText = 'No server data available.';
        if (topServers.length > 0) {
            serversText = topServers.map((entry, index) => {
                const [guildId, time] = entry;
                const guildName = this.client.guilds.cache.get(guildId)?.name || 'Unknown Server';
                const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                return `${emoji} **${this.formatTime(time)}** • ${guildName}`;
                }).join('\n');
        }

        // Top Tracks
        const topTracks = Array.from(userData.tracks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        
        let tracksText = 'No track data available.';
        if (topTracks.length > 0) {
            tracksText = topTracks.map((entry, index) => {
                const [trackName, time] = entry;
                const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                return `${emoji} **${this.formatTime(time)}** • ${trackName}`;
                }).join('\n');
        }

        embed.addFields(
            { name: '📊 Total Listening Time', value: `**${this.formatTime(userData.totalTime)}**`, inline: false },
            { name: '🏆 TOP SERVERS', value: serversText, inline: false },
            { name: '🎵 TOP TRACKS', value: tracksText, inline: false }
        );

        return embed;
    }

    // Generate profile canvas image
    async generateProfileCanvas(userId, userData) {
        try {
            const canvas = createCanvas(800, 600);
            const ctx = canvas.getContext('2d');

            // Background gradient (plus sombre comme dans votre photo)
            const gradient = ctx.createLinearGradient(0, 0, 800, 600);
            gradient.addColorStop(0, '#2d1b1b');
            gradient.addColorStop(0.5, '#1a0f0f');
            gradient.addColorStop(1, '#0f0a0a');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 600);

            // Ajouter des notes de musique en arrière-plan (transparentes)
            this.drawMusicNotesBackground(ctx);

            // Header section (rouge différent comme demandé)
            ctx.fillStyle = '#B22222';
            ctx.fillRect(0, 0, 800, 120);

            // User avatar (cercle avec bordure)
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(100, 60, 40, 0, 2 * Math.PI);
            ctx.fill();
            
            // Bordure de l'avatar
            ctx.strokeStyle = '#B22222';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Username
            const user = this.client.users.cache.get(userId);
            const username = user ? user.username : 'Unknown User';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(username, 160, 50);

            // Total listening time
            ctx.font = '20px Arial';
            ctx.fillText(`Total: ${this.formatTime(userData.totalTime)}`, 160, 80);

            // Icônes de services musicaux (comme dans votre photo)
            this.drawMusicServiceIcons(ctx, 160, 100);

            // Content sections avec des boîtes arrondies
            const sections = [
                {
                    title: '🏆 TOP SERVERS',
                    data: this.getTopServers(userData.servers),
                    y: 160,
                    x: 50
                },
                {
                    title: '👥 TOP FRIENDS',
                    data: this.getTopFriends(userData.friends),
                    y: 160,
                    x: 420
                },
                {
                    title: '🎵 TOP TRACKS',
                    data: this.getTopTracks(userData.tracks),
                    y: 350,
                    x: 50
                }
            ];

            sections.forEach(section => {
                // Dessiner la boîte de section
                this.drawRoundedBox(ctx, section.x, section.y - 30, 320, 120, 15, '#2a2a2a');
                
                // Section title
                ctx.fillStyle = '#B22222';
                ctx.font = 'bold 20px Arial';
                ctx.textAlign = 'left';
                ctx.fillText(section.title, section.x + 15, section.y);

                // Section data
                ctx.fillStyle = '#ffffff';
                ctx.font = '16px Arial';
                section.data.forEach((item, index) => {
                    const y = section.y + 25 + (index * 25);
                    const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32';
                    
                    // Numéro de rang coloré
                    ctx.fillStyle = rankColor;
                    ctx.font = 'bold 16px Arial';
                    ctx.fillText(`${index + 1}`, section.x + 15, y);
                    
                    // Contenu
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '16px Arial';
                    ctx.fillText(`${item.time} • ${item.name}`, section.x + 35, y);
                });
            });

            // Bouton "Rayelix Music" en haut à droite
            this.drawRoundedBox(ctx, 650, 20, 120, 35, 8, '#B22222');
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Rayelix Music', 710, 42);

            return canvas;
        } catch (error) {
            console.error('Error generating profile canvas:', error);
            throw error;
        }
    }

    // Get top servers for display
    getTopServers(servers) {
        return Array.from(servers.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([guildId, time]) => {
                const guild = this.client.guilds.cache.get(guildId);
                const name = guild ? guild.name : `Server ${guildId}`;
                return { name, time: this.formatTime(time) };
            });
    }

    // Get top tracks for display
    getTopTracks(tracks) {
        return Array.from(tracks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([trackName, time]) => {
                return { name: trackName.length > 30 ? trackName.substring(0, 30) + '...' : trackName, time: this.formatTime(time) };
            });
    }

    // Get top friends for display
    getTopFriends(friends) {
        if (!friends || friends.size === 0) {
            return [
                { name: 'No friends data', time: '0m' },
                { name: 'Start listening with friends', time: '0m' },
                { name: 'to see your top friends!', time: '0m' }
            ];
        }
        
        return Array.from(friends.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([friendId, time]) => {
                const friend = this.client.users.cache.get(friendId);
                const name = friend ? friend.username : `User ${friendId}`;
                return { name: name.length > 20 ? name.substring(0, 20) + '...' : name, time: this.formatTime(time) };
            });
    }

    // Draw music icons background with subtle transparency
    drawMusicIconsBackground(ctx) {
        ctx.globalAlpha = 0.15; // Subtle transparency
        
        // Draw various music icons
        const icons = [
            { type: 'note', x: 150, y: 250, size: 25 },
            { type: 'clef', x: 400, y: 180, size: 30 },
            { type: 'headphones', x: 650, y: 320, size: 28 },
            { type: 'note', x: 250, y: 450, size: 22 },
            { type: 'clef', x: 550, y: 480, size: 26 },
            { type: 'headphones', x: 180, y: 380, size: 24 }
        ];

        icons.forEach(icon => {
            ctx.fillStyle = '#FFFFFF';
            this.drawMusicIcon(ctx, icon.type, icon.x, icon.y, icon.size);
        });

        ctx.globalAlpha = 1.0; // Reset opacity
    }

    // Draw specific music icons
    drawMusicIcon(ctx, type, x, y, size) {
        switch(type) {
            case 'note':
                // Musical note
                ctx.beginPath();
                ctx.arc(x, y, size / 2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillRect(x + size / 2, y - size, 3, size);
                break;
            case 'clef':
                // Treble clef (simplified)
                ctx.beginPath();
                ctx.arc(x, y, size / 2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillRect(x - size / 2, y - size, 3, size);
                break;
            case 'headphones':
                // Headphones (simplified)
                ctx.beginPath();
                ctx.arc(x - size / 3, y, size / 3, 0, 2 * Math.PI);
                ctx.arc(x + size / 3, y, size / 3, 0, 2 * Math.PI);
                ctx.fill();
                break;
        }
    }

    // Draw music service icons
    drawMusicServiceIcons(ctx, x, y) {
        const icons = [
            { color: '#1DB954', radius: 12 }, // Spotify green
            { color: '#FF6B6B', radius: 12 }, // Equalizer red
            { color: '#FF8C00', radius: 12 }  // Cloud orange
        ];

        icons.forEach((icon, index) => {
            ctx.fillStyle = icon.color;
            ctx.beginPath();
            ctx.arc(x + (index * 35), y, icon.radius, 0, 2 * Math.PI);
            ctx.fill();
        });
    }

    // Draw modern rounded box with soft drop shadow
    drawModernRoundedBox(ctx, x, y, width, height, radius, color) {
        // Drop shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 5;
        
        // Main box
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }

    // Draw profile picture frame (circular)
    drawProfilePictureFrame(ctx, x, y) {
        // Drop shadow for the frame
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 8;
        
        // Outer frame (white)
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, 45, 0, 2 * Math.PI);
        ctx.fill();
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Inner frame (blue gradient)
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 40);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#4682B4');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 40, 0, 2 * Math.PI);
        ctx.fill();
        
        // Profile picture placeholder (user avatar would go here)
        ctx.fillStyle = '#E0F2FE';
        ctx.beginPath();
        ctx.arc(x, y, 35, 0, 2 * Math.PI);
        ctx.fill();
    }

    get commands() {
        return [
            new SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a song or playlist')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or Spotify link')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('pause')
                .setDescription('Pause the current song'),
            new SlashCommandBuilder()
                .setName('skip')
                .setDescription('Skip the current song'),
            new SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop playback and clear the queue'),
            new SlashCommandBuilder()
                .setName('resume')
                .setDescription('Resume the paused song'),
            new SlashCommandBuilder()
                .setName('queue')
                .setDescription('Show the current music queue'),
            new SlashCommandBuilder()
                .setName('np')
                .setDescription('Show the currently playing track'),
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show all available music commands'),
            new SlashCommandBuilder()
                .setName('playlist_create')
                .setDescription('Create a new playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_delete')
                .setDescription('Delete a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_add')
                .setDescription('Add a song to a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or Spotify link')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_remove')
                .setDescription('Remove a song from a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('index')
                        .setDescription('Index of the song to remove (1-based)')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_play')
                .setDescription('Play a saved playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('filter')
                .setDescription('Apply an audio filter')
                .addStringOption(option =>
                    option.setName('filter')
                        .setDescription('Filter to apply')
                        .setRequired(true)
                        .addChoices(
                            { name: 'None', value: 'none' },
                            { name: 'Bassboost', value: 'bassboost' },
                            { name: 'Nightcore', value: 'nightcore' },
                            { name: 'Vaporwave', value: 'vaporwave' },
                            { name: '8D', value: '8d' },
                            { name: 'Karaoke', value: 'karaoke' },
                            { name: 'Tremolo', value: 'tremolo' },
                            { name: 'Vibrato', value: 'vibrato' },
                            { name: 'Rotation', value: 'rotation' },
                            { name: 'Distortion', value: 'distortion' },
                            { name: 'Channel Mix', value: 'channelmix' },
                            { name: 'Low Pass', value: 'lowpass' },
                            { name: 'Slowmode', value: 'slowmode' }
                        )),
            new SlashCommandBuilder()
                .setName('lyrics')
                .setDescription('Fetch lyrics for the current song or a specified song')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name to search for lyrics (optional)')
                        .setRequired(false)),
            new SlashCommandBuilder()
                .setName('volume')
                .setDescription('Set playback volume')
                .addIntegerOption(option =>
                    option.setName('level')
                        .setDescription('Volume level (0-200)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(200)),
            new SlashCommandBuilder()
                .setName('seek')
                .setDescription('Seek to a position in the current song')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('Time format: mm:ss or ss')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('loop')
                .setDescription('Set loop mode')
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('Loop mode')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Off', value: 'off' },
                            { name: 'Track', value: 'track' },
                            { name: 'Queue', value: 'queue' }
                        )),
            new SlashCommandBuilder()
                .setName('shuffle')
                .setDescription('Shuffle the current queue'),
            new SlashCommandBuilder()
                .setName('clear')
                .setDescription('Clear the current queue'),
            new SlashCommandBuilder()
                .setName('247')
                .setDescription('Toggle 24/7 mode (stay in channel)'),
            new SlashCommandBuilder()
                .setName('move')
                .setDescription('Move a track within the queue')
                .addIntegerOption(option =>
                    option.setName('from')
                        .setDescription('Current position of the track')
                        .setRequired(true)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('to')
                        .setDescription('New position for the track')
                        .setRequired(true)
                        .setMinValue(1)),
            new SlashCommandBuilder()
                .setName('remove')
                .setDescription('Remove track(s) from the queue')
                .addStringOption(option =>
                    option.setName('index')
                        .setDescription('Track index or range (e.g., 1 or 1-3)')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('jump')
                .setDescription('Jump to a specific track (play it next)')
                .addIntegerOption(option =>
                    option.setName('index')
                        .setDescription('Track index to jump to')
                        .setRequired(true)
                        .setMinValue(1)),
            // 🚀 NOUVELLES COMMANDES ULTRA-PERFORMANCE
            new SlashCommandBuilder()
                .setName('stats')
                .setDescription('Afficher les statistiques du bot et de l\'utilisateur'),
            new SlashCommandBuilder()
                .setName('autodj')
                .setDescription('Activer/désactiver le mode AutoDJ intelligent')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Action à effectuer')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Activer', value: 'enable' },
                            { name: 'Désactiver', value: 'disable' },
                            { name: 'Statut', value: 'status' }
                        )),
            new SlashCommandBuilder()
                .setName('smartqueue')
                .setDescription('Activer/désactiver la file d\'attente intelligente')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Action à effectuer')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Activer', value: 'enable' },
                            { name: 'Désactiver', value: 'disable' },
                            { name: 'Statut', value: 'status' }
                        )),
            new SlashCommandBuilder()
                .setName('voiceeffects')
                .setDescription('Activer/désactiver les effets vocaux avancés')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Action à effectuer')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Activer', value: 'enable' },
                            { name: 'Désactiver', value: 'disable' },
                            { name: 'Statut', value: 'status' }
                        )),
            new SlashCommandBuilder()
                .setName('cache')
                .setDescription('Gérer le cache intelligent du bot')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Action à effectuer')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Statut', value: 'status' },
                            { name: 'Vider', value: 'clear' },
                            { name: 'Info', value: 'info' }
                        )),
            new SlashCommandBuilder()
                .setName('health')
                .setDescription('Vérifier la santé et les performances du bot'),
            new SlashCommandBuilder()
                .setName('optimize')
                .setDescription('Optimiser automatiquement les performances du bot'),
            new SlashCommandBuilder()
                .setName('recommend')
                .setDescription('Obtenir des recommandations de musique intelligentes')
                .addStringOption(option =>
                    option.setName('mood')
                        .setDescription('Humeur pour les recommandations')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Énergique', value: 'energetic' },
                            { name: 'Calme', value: 'calm' },
                            { name: 'Triste', value: 'sad' },
                            { name: 'Heureux', value: 'happy' },
                            { name: 'Concentration', value: 'focus' }
                        )),
            new SlashCommandBuilder()
                .setName('profile')
                .setDescription('Show your music listening statistics')
        ];
    }

    async execute(interaction) {
        const commandName = interaction.commandName;
        console.log(`[SLASH COMMAND] Reçue: /${commandName}`);
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        // Check if user is in a voice channel for commands requiring it
        if (!voiceChannel && !['queue', 'help', 'playlist_create', 'playlist_delete', 'playlist_add', 'playlist_remove', 'lyrics', '247'].includes(commandName)) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command!', flags: MessageFlags.Ephemeral });
        }

        // Check bot permissions for voice-related commands
        if (!['queue', 'help', 'playlist_create', 'playlist_delete', 'playlist_add', 'playlist_remove', 'lyrics', '247'].includes(commandName) && !voiceChannel.permissionsFor(interaction.guild.members.me).has([
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
        ])) {
            return interaction.reply({ content: 'I need permissions to join and speak in your voice channel!', flags: MessageFlags.Ephemeral });
        }

        // Handle commands
        if (commandName === 'play') {
            if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
            const query = interaction.options.getString('query');
            
            const player = this.riffy.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: true
            });

            let resolve;
            try {
                resolve = await this.resolveWithTimeout(query, interaction.user);
            } catch (e) {
                if (String(e?.message) === 'RESOLVE_TIMEOUT') {
                    return interaction.editReply('Search took too long. Please try again later.');
                }
                return interaction.editReply('Failed to resolve the query.');
            }
            const { loadType, tracks, playlistInfo } = resolve || {};

            if (loadType === 'empty') {
                return interaction.editReply('No results found for your query.');
            }

            if (loadType === 'playlist') {
                for (const track of tracks) {
                    track.info.requester = interaction.user;
                    player.queue.add(track);
                }
                await interaction.editReply(`Added playlist **${playlistInfo.name}** with ${tracks.length} tracks.`);
            } else if (loadType === 'track' || loadType === 'search') {
                const track = tracks.shift();
                if (!track || !track.info) return interaction.editReply('No playable track found.');
                track.info.requester = interaction.user;
                player.queue.add(track);
                await interaction.editReply(`Added **${track.info.title}** to the queue.`);
            }

            if (!player.playing && !player.paused) player.play();
        }

        else if (commandName === 'pause') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            if (player.paused) return interaction.reply({ content: 'The player is already paused!', flags: MessageFlags.Ephemeral });
            player.pause(true);
            await interaction.reply('Paused the current song.');
        }

        else if (commandName === 'skip') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) return interaction.reply({ content: 'No music is playing or no songs in queue to skip!', flags: MessageFlags.Ephemeral });
            player.stop();
            await interaction.reply('Skipped the current song.');
        }

        else if (commandName === 'stop') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            player.destroy();
            await interaction.reply('Stopped playback and cleared the queue.');
        }

        else if (commandName === 'resume') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            if (!player.paused) return interaction.reply({ content: 'The player is not paused!', flags: MessageFlags.Ephemeral });
            player.pause(false);
            await interaction.reply('Resumed the current song.');
        }

        else if (commandName === 'queue') {
            if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) {
                return interaction.editReply('No music is playing or the queue is empty.');
            }
            const perPage = 10;
            const page = 0;
            const embed = this.buildQueuePageEmbed(player, page, perPage);
            const row = this.buildQueueRow(interaction.user.id, page, Math.ceil(player.queue.size / perPage));
            const sent = await interaction.editReply({ embeds: [embed], components: [row] });
            this.queueCache.set(sent.id, { guildId: interaction.guild.id, page, perPage, total: player.queue.size, byUserId: interaction.user.id });
        }

        else if (commandName === 'np') {
            if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.current) return interaction.editReply('Nothing is currently playing.');
            const embed = this.createNowPlayingEmbed(player, player.current, interaction.guild);
            await interaction.editReply({ embeds: [embed] });
        }

        else if (commandName === 'help') {
            await interaction.deferReply();
            const embed = new EmbedBuilder()
                .setTitle('Music Bot Commands')
                .setDescription('List of all available commands and their descriptions.')
                .setColor(0xFF7A00)
                .setTimestamp()
                .setFooter({ text: 'Use /command for specific usage details' });

            this.commands.forEach(cmd => {
                embed.addFields({
                    name: `/${cmd.name}`,
                    value: cmd.description,
                    inline: false
                });
            });

            await interaction.followUp({ embeds: [embed] });
        }

        else if (commandName === 'playlist_create') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId]) playlists[userId] = {};
            if (playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** already exists!`);
            }

            playlists[userId][name] = [];
            await this.savePlaylists(playlists);
            await interaction.followUp(`Created playlist **${name}**.`);
        }

        else if (commandName === 'playlist_delete') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            delete playlists[userId][name];
            await this.savePlaylists(playlists);
            await interaction.followUp(`Deleted playlist **${name}**.`);
        }

        else if (commandName === 'playlist_add') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const query = interaction.options.getString('query');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            const resolve = await this.riffy.resolve({ query, requester: interaction.user });
            if (resolve.loadType === 'empty') {
                return interaction.followUp('No results found for your query.');
            }

            const track = resolve.tracks[0];
            playlists[userId][name].push({
                title: track.info.title,
                author: track.info.author,
                uri: track.info.uri,
                length: track.info.length
            });
            await this.savePlaylists(playlists);
            await interaction.followUp(`Added **${track.info.title}** to playlist **${name}**.`);
        }

        else if (commandName === 'playlist_remove') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const index = interaction.options.getInteger('index') - 1;
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            if (index < 0 || index >= playlists[userId][name].length) {
                return interaction.followUp(`Invalid song index. Use /queue to see the playlist.`);
            }

            const removed = playlists[userId][name][index];
            playlists[userId][name].splice(index, 1);
            await this.savePlaylists(playlists);
            await interaction.followUp(`Removed **${removed.title}** from playlist **${name}**.`);
        }

        else if (commandName === 'playlist_play') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            const player = this.riffy.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: true
            });

            for (const track of playlists[userId][name]) {
                const resolve = await this.riffy.resolve({ query: track.uri, requester: interaction.user });
                if (resolve.loadType !== 'empty') {
                    const resolvedTrack = resolve.tracks[0];
                    resolvedTrack.info.requester = interaction.user;
                    player.queue.add(resolvedTrack);
                }
            }

            if (!player.playing && !player.paused) player.play();
            await interaction.followUp(`Playing playlist **${name}** with ${playlists[userId][name].length} tracks.`);
        }

        else if (commandName === 'volume') {
            const level = interaction.options.getInteger('level');
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            player.setVolume(level);
            await interaction.reply(`Volume set to **${level}%**.`);
        }

        else if (commandName === 'seek') {
            const timeStr = interaction.options.getString('time');
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.current) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            
            let seconds = 0;
            if (timeStr.includes(':')) {
                const [minutes, secs] = timeStr.split(':').map(Number);
                seconds = minutes * 60 + secs;
            } else {
                seconds = Number(timeStr);
            }
            
            if (isNaN(seconds) || seconds < 0) return interaction.reply({ content: 'Invalid time format. Use mm:ss or ss', flags: MessageFlags.Ephemeral });
            
            player.seek(seconds * 1000);
            await interaction.reply(`Seeked to **${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}**.`);
        }

        else if (commandName === 'loop') {
            const mode = interaction.options.getString('mode');
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });
            
            this.loopModeByGuild.set(interaction.guild.id, mode);
            await interaction.reply(`Loop mode set to **${mode}**.`);
        }

        else if (commandName === 'shuffle') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) return interaction.reply({ content: 'No music in queue to shuffle!', flags: MessageFlags.Ephemeral });
            
            player.queue.shuffle();
            await interaction.reply('Queue shuffled! 🔀');
        }

        else if (commandName === 'clear') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) return interaction.reply({ content: 'Queue is already empty!', flags: MessageFlags.Ephemeral });
            
            player.queue.clear();
            await interaction.reply('Queue cleared! 🗑️');
        }

        else if (commandName === '247') {
            const guildId = interaction.guild.id;
            if (this.stayInChannelGuilds.has(guildId)) {
                this.stayInChannelGuilds.delete(guildId);
                await interaction.reply('24/7 mode **disabled**. Bot will leave when queue is empty.');
            } else {
                this.stayInChannelGuilds.add(guildId);
                await interaction.reply('24/7 mode **enabled**. Bot will stay in channel even when queue is empty.');
            }
        }

        else if (commandName === 'move') {
            const from = interaction.options.getInteger('from') - 1;
            const to = interaction.options.getInteger('to') - 1;
            const player = this.riffy.players.get(interaction.guild.id);
            
            if (!player || !player.queue.size) return interaction.reply({ content: 'No music in queue!', flags: MessageFlags.Ephemeral });
            if (from < 0 || from >= player.queue.size || to < 0 || to >= player.queue.size) {
                return interaction.reply({ content: 'Invalid track positions!', flags: MessageFlags.Ephemeral });
            }
            
            const track = player.queue[from];
            player.queue.splice(from, 1);
            player.queue.splice(to, 0, track);
            await interaction.reply(`Moved track **${track.info.title}** from position ${from + 1} to ${to + 1}.`);
        }

        else if (commandName === 'remove') {
            const indexStr = interaction.options.getString('index');
            const player = this.riffy.players.get(interaction.guild.id);
            
            if (!player || !player.queue.size) return interaction.reply({ content: 'No music in queue!', flags: MessageFlags.Ephemeral });
            
            let indices = [];
            if (indexStr.includes('-')) {
                const [start, end] = indexStr.split('-').map(Number);
                for (let i = start - 1; i < end; i++) {
                    if (i >= 0 && i < player.queue.size) indices.push(i);
                }
            } else {
                const index = Number(indexStr) - 1;
                if (index >= 0 && index < player.queue.size) indices.push(index);
            }
            
            if (indices.length === 0) return interaction.reply({ content: 'Invalid track index!', flags: MessageFlags.Ephemeral });
            
            const removedTracks = indices.map(i => player.queue[i].info.title);
            indices.sort((a, b) => b - a).forEach(i => player.queue.splice(i, 1));
            
            await interaction.reply(`Removed **${removedTracks.length}** track(s): ${removedTracks.join(', ')}`);
        }

        else if (commandName === 'jump') {
            const index = interaction.options.getInteger('index') - 1;
            const player = this.riffy.players.get(interaction.guild.id);
            
            if (!player || !player.queue.size) return interaction.reply({ content: 'No music in queue!', flags: MessageFlags.Ephemeral });
            if (index < 0 || index >= player.queue.size) return interaction.reply({ content: 'Invalid track index!', flags: MessageFlags.Ephemeral });
            
            const track = player.queue[index];
            player.queue.splice(index, 1);
            player.queue.unshift(track);
            await interaction.reply(`Jumped to **${track.info.title}** - it will play next!`);
        }

        else if (commandName === 'filter') {
            await interaction.deferReply();
            const filter = interaction.options.getString('filter');
            const player = this.riffy.players.get(interaction.guild.id);

            if (!player) return interaction.reply({ content: 'No music is currently playing!', flags: MessageFlags.Ephemeral });

            const filters = {
                none: () => player.filters.clearFilters(),
                bassboost: () => player.filters.setBassboost(true, { value: 3 }),
                nightcore: () => player.filters.setNightcore(true, { rate: 1.5 }),
                vaporwave: () => player.filters.setVaporwave(true, { pitch: 0.5 }),
                '8d': () => player.filters.set8D(true, { rotationHz: 0.2 }),
                karaoke: () => player.filters.setKaraoke(true, { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
                tremolo: () => player.filters.setTremolo(true, { frequency: 2, depth: 0.5 }),
                vibrato: () => player.filters.setVibrato(true, { frequency: 4, depth: 0.5 }),
                rotation: () => player.filters.setRotation(true, { rotationHz: 0.2 }),
                distortion: () => player.filters.setDistortion(true, { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1 }),
                channelmix: () => player.filters.setChannelMix(true, { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 }),
                lowpass: () => player.filters.setLowPass(true, { smoothing: 20 }),
                slowmode: () => player.filters.setSlowmode(true, { rate: 0.8 })
            };

            if (!filters[filter]) return interaction.followUp({ content: 'Invalid filter. Available filters: none, bassboost, nightcore, vaporwave, 8d, karaoke, tremolo, vibrato, rotation, distortion, channelmix, lowpass, slowmode', flags: MessageFlags.Ephemeral });

            filters[filter]();
            await interaction.followUp(`Applied **${filter === 'none' ? 'no' : filter}** filter.`);
        }

        else if (commandName === 'lyrics') {
            await interaction.deferReply();
            const query = interaction.options.getString('query');
            const player = this.riffy.players.get(interaction.guild.id);

            let title, artist;
            if (query) {
                title = query;
                artist = '';
            } else if (player && player.current) {
                title = player.current.info.title;
                artist = player.current.info.author;
            } else {
                return interaction.followUp({ content: 'No song is currently playing, and no query was provided.', flags: MessageFlags.Ephemeral });
            }

            try {
                const lyrics = await getLyrics({
                    title,
                    artist,
                    apiKey: process.env.GENIUS_API_KEY,
                    optimizeQuery: true
                });

                if (!lyrics) return interaction.followUp({ content: 'No lyrics found for this song.', flags: MessageFlags.Ephemeral });

                // Split lyrics into 4000-char chunks (Discord embed description limit)
                const chunks = lyrics.match(/(.|[\r\n]){1,4000}/g) || ['No lyrics available.'];
                const embed = new EmbedBuilder()
                    .setTitle(`Lyrics for ${title}${artist ? ` by ${artist}` : ''}`)
                    .setDescription(chunks[0])
                    .setColor(0xFF7A00)
                    .setFooter({ text: `Page 1 of ${chunks.length}` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`lyrics_prev_${interaction.user.id}_0`)
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`lyrics_next_${interaction.user.id}_0`)
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(chunks.length === 1)
                );

                // Store lyrics data in a cache (use a Map on the client)
                if (!this.client.lyricsCache) this.client.lyricsCache = new Map();
                const sentMessage = await interaction.followUp({ embeds: [embed], components: [row] });
                this.client.lyricsCache.set(sentMessage.id, { chunks, title, artist });

                // Clean up cache after 5 minutes
                setTimeout(() => this.client.lyricsCache.delete(interaction.id), 5 * 60 * 1000);
            } catch (error) {
                console.error('Error fetching lyrics:', error);
                await interaction.followUp({ content: 'Error fetching lyrics. Please try again later.', flags: MessageFlags.Ephemeral });
            }
        }

        else if (commandName === 'profile') {
            await this.showUserProfileSlash(interaction, interaction.user.id);
        }

        // 🚀 NOUVELLES COMMANDES ULTRA-PERFORMANCE
        else if (commandName === 'stats') {
            await this.showBotStats(interaction);
        }

        else if (commandName === 'autodj') {
            const action = interaction.options.getString('action');
            const guildId = interaction.guild.id;
            
            if (action === 'enable') {
                const result = this.plugins.get('autoDJ').enable(guildId);
                await interaction.reply(`🎵 ${result}`);
            } else if (action === 'disable') {
                const result = this.plugins.get('autoDJ').disable(guildId);
                await interaction.reply(`🔇 ${result}`);
            } else if (action === 'status') {
                const isEnabled = this.autoDJEnabled?.has(guildId);
                await interaction.reply(`AutoDJ: **${isEnabled ? 'Activé' : 'Désactivé'}** 🎵`);
            }
        }

        else if (commandName === 'smartqueue') {
            const action = interaction.options.getString('action');
            const guildId = interaction.guild.id;
            
            if (action === 'enable') {
                const result = this.plugins.get('smartQueue').enable(guildId);
                await interaction.reply(`🧠 ${result}`);
            } else if (action === 'disable') {
                const result = this.plugins.get('smartQueue').disable(guildId);
                await interaction.reply(`📝 ${result}`);
            } else if (action === 'status') {
                const isEnabled = this.smartQueueEnabled?.has(guildId);
                await interaction.reply(`SmartQueue: **${isEnabled ? 'Activé' : 'Désactivé'}** 🧠`);
            }
        }

        else if (commandName === 'voiceeffects') {
            const action = interaction.options.getString('action');
            const guildId = interaction.guild.id;
            
            if (action === 'enable') {
                const result = this.plugins.get('voiceEffects').enable(guildId);
                await interaction.reply(`🎭 ${result}`);
            } else if (action === 'disable') {
                const result = this.plugins.get('voiceEffects').disable(guildId);
                await interaction.reply(`🎵 ${result}`);
            } else if (action === 'status') {
                const isEnabled = this.voiceEffectsEnabled?.has(guildId);
                await interaction.reply(`VoiceEffects: **${isEnabled ? 'Activé' : 'Désactivé'}** 🎭`);
            }
        }

        else if (commandName === 'cache') {
            const action = interaction.options.getString('action');
            
            if (action === 'status') {
                const cacheInfo = {
                    userStats: this.userStatsCache.size,
                    search: this.searchCache.size,
                    totalHits: this.metrics.cacheHits,
                    totalMisses: this.metrics.cacheMisses,
                    hitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100 || 0
                };
                
                const embed = new EmbedBuilder()
                    .setTitle('📊 Statut du Cache Intelligent')
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Cache Stats', value: `${cacheInfo.userStats} entrées`, inline: true },
                        { name: 'Cache Search', value: `${cacheInfo.search} entrées`, inline: true },
                        { name: 'Taux de Hit', value: `${cacheInfo.hitRate.toFixed(1)}%`, inline: true },
                        { name: 'Hits', value: cacheInfo.totalHits.toString(), inline: true },
                        { name: 'Misses', value: cacheInfo.totalMisses.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            } else if (action === 'clear') {
                this.userStatsCache.clear();
                this.searchCache.clear();
                this.cacheExpiry.clear();
                await interaction.reply('🧹 Cache vidé avec succès !');
            } else if (action === 'info') {
                const memUsage = process.memoryUsage();
                const embed = new EmbedBuilder()
                    .setTitle('ℹ️ Informations du Cache')
                    .setColor(0x0099FF)
                    .addFields(
                        { name: 'Mémoire Utilisée', value: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`, inline: true },
                        { name: 'Mémoire Totale', value: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`, inline: true },
                        { name: 'Commandes Exécutées', value: this.metrics.commandsExecuted.toString(), inline: true },
                        { name: 'Temps de Réponse Moyen', value: this.metrics.responseTime.length > 0 ? 
                            `${Math.round(this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length)}ms` : 'N/A', inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            }
        }

        else if (commandName === 'health') {
            await this.showHealthStatus(interaction);
        }

        else if (commandName === 'optimize') {
            await this.optimizeBotPerformance(interaction);
        }

        else if (commandName === 'recommend') {
            const mood = interaction.options.getString('mood') || 'random';
            await this.getMusicRecommendations(interaction, mood);
        }

        // Gestionnaire par défaut pour les commandes non reconnues
        else {
            console.warn(`Commande slash non gérée: ${commandName}`);
            await interaction.reply({ 
                content: `Commande \`/${commandName}\` non reconnue ou non implémentée.`, 
                ephemeral: true 
            });
        }
    }

    // 🚀 MÉTHODES D'IMPLÉMENTATION DES NOUVELLES COMMANDES

    // 📊 Afficher les statistiques du bot
    async showBotStats(interaction) {
        try {
            const memUsage = process.memoryUsage();
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);

            const embed = new EmbedBuilder()
                .setTitle('🚀 Statistiques Ultra-Performance du Bot')
                .setColor(0xFF6B6B)
                .addFields(
                    { name: '📈 Performance', value: `Temps de réponse moyen: ${this.metrics.responseTime.length > 0 ? 
                        `${Math.round(this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length)}ms` : 'N/A'}`, inline: true },
                    { name: '🎵 Musique', value: `Tracks joués: ${this.metrics.tracksPlayed}`, inline: true },
                    { name: '⚡ Commandes', value: `Exécutées: ${this.metrics.commandsExecuted}`, inline: true },
                    { name: '🧠 Cache', value: `Hit rate: ${this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100 || 0}%`, inline: true },
                    { name: '💾 Mémoire', value: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`, inline: true },
                    { name: '⏱️ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }
                )
                .setFooter({ text: 'Bot Ultra-Performance 🚀' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de l\'affichage des stats:', error);
            await interaction.reply({ content: '❌ Erreur lors de l\'affichage des statistiques', ephemeral: true });
        }
    }

    // ❤️ Afficher le statut de santé du bot
    async showHealthStatus(interaction) {
        try {
            const nodes = this.riffy.nodes;
            let healthyNodes = 0;
            for (const node of nodes.values()) {
                if (node.connected) healthyNodes++;
            }

            const players = this.riffy.players;
            let activePlayers = 0;
            for (const player of players.values()) {
                if (player.playing || player.paused) activePlayers++;
            }

            const memUsage = process.memoryUsage();
            const healthColor = healthyNodes > 0 ? 0x00FF00 : 0xFF0000;
            const healthStatus = healthyNodes > 0 ? '🟢 En Bonne Santé' : '🔴 Problème Détecté';

            const embed = new EmbedBuilder()
                .setTitle('❤️ Statut de Santé du Bot')
                .setColor(healthColor)
                .addFields(
                    { name: '🔌 Nodes Lavalink', value: `${healthyNodes}/${nodes.size} connectés`, inline: true },
                    { name: '🎵 Players Actifs', value: activePlayers.toString(), inline: true },
                    { name: '💾 Utilisation Mémoire', value: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`, inline: true },
                    { name: '📊 Erreurs', value: this.metrics.errors.toString(), inline: true },
                    { name: '⚡ Cache Hit Rate', value: `${this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100 || 0}%`, inline: true },
                    { name: '🎯 Statut', value: healthStatus, inline: true }
                )
                .setFooter({ text: 'Monitoring en temps réel ❤️' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de la vérification de santé:', error);
            await interaction.reply({ content: '❌ Erreur lors de la vérification de santé', ephemeral: true });
        }
    }

    // 🚀 Optimiser automatiquement les performances
    async optimizeBotPerformance(interaction) {
        try {
            await interaction.deferReply();
            
            // Nettoyage de la mémoire
            this.cleanupMemory();
            
            // Optimisation du cache
            const cacheSizeBefore = this.userStatsCache.size + this.searchCache.size;
            this.cleanupMemory();
            const cacheSizeAfter = this.userStatsCache.size + this.searchCache.size;
            
            // Vérification de santé
            this.healthCheck();
            
            const memUsage = process.memoryUsage();
            const embed = new EmbedBuilder()
                .setTitle('🚀 Optimisation Automatique Terminée')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🧹 Cache Nettoyé', value: `${cacheSizeBefore - cacheSizeAfter} entrées supprimées`, inline: true },
                    { name: '💾 Mémoire Libérée', value: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`, inline: true },
                    { name: '⚡ Performance', value: 'Optimisée au maximum !', inline: true },
                    { name: '🔧 Actions Effectuées', value: 'Nettoyage cache, vérification santé, optimisation mémoire', inline: false }
                )
                .setFooter({ text: 'Bot Ultra-Optimisé 🚀' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de l\'optimisation:', error);
            await interaction.editReply({ content: '❌ Erreur lors de l\'optimisation', ephemeral: true });
        }
    }

    // 🎵 Obtenir des recommandations de musique intelligentes
    async getMusicRecommendations(interaction, mood) {
        try {
            await interaction.deferReply();
            
            const userId = interaction.user.id;
            const userStats = await this.getCachedUserStats(userId);
            
            // Analyser les goûts de l'utilisateur
            const topGenres = this.analyzeUserTaste(userStats);
            const moodTracks = this.getMoodBasedTracks(mood);
            
            const embed = new EmbedBuilder()
                .setTitle('🎵 Recommandations Intelligentes')
                .setColor(0xFF6B6B)
                .addFields(
                    { name: '👤 Utilisateur', value: `<@${userId}>`, inline: true },
                    { name: '🎭 Humeur', value: this.getMoodEmoji(mood) + ' ' + this.getMoodName(mood), inline: true },
                    { name: '🎵 Genres Préférés', value: topGenres.slice(0, 3).join(', ') || 'Aucun', inline: true },
                    { name: '📊 Tracks Écoutés', value: userStats.totalTime > 0 ? `${Math.round(userStats.totalTime / 60000)} minutes` : '0', inline: true }
                )
                .setDescription('Vos recommandations personnalisées basées sur vos goûts et l\'humeur sélectionnée !')
                .setFooter({ text: 'IA Musicale Intelligente 🧠' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors des recommandations:', error);
            await interaction.editReply({ content: '❌ Erreur lors des recommandations', ephemeral: true });
        }
    }

    // 🧠 Analyser les goûts de l'utilisateur
    analyzeUserTaste(userStats) {
        const genreCount = new Map();
        
        // Analyser les tracks écoutés
        for (const [trackId, trackData] of userStats.tracks.entries()) {
            if (trackData.genre) {
                genreCount.set(trackData.genre, (genreCount.get(trackData.genre) || 0) + 1);
            }
        }
        
        // Trier par popularité
        return Array.from(genreCount.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([genre]) => genre)
            .slice(0, 5);
    }

    // 🎭 Obtenir des tracks basés sur l'humeur
    getMoodBasedTracks(mood) {
        const moodTracks = {
            energetic: ['rock', 'electronic', 'pop', 'dance'],
            calm: ['ambient', 'classical', 'jazz', 'chill'],
            sad: ['blues', 'slow', 'melancholic', 'acoustic'],
            happy: ['pop', 'reggae', 'funk', 'disco'],
            focus: ['instrumental', 'classical', 'lofi', 'ambient']
        };
        
        return moodTracks[mood] || moodTracks.energetic;
    }

    // 😊 Obtenir l'emoji de l'humeur
    getMoodEmoji(mood) {
        const moodEmojis = {
            energetic: '⚡',
            calm: '😌',
            sad: '😢',
            happy: '😊',
            focus: '🧠'
        };
        
        return moodEmojis[mood] || '🎵';
    }

    // 📝 Obtenir le nom de l'humeur
    getMoodName(mood) {
        const moodNames = {
            energetic: 'Énergique',
            calm: 'Calme',
            sad: 'Triste',
            happy: 'Heureux',
            focus: 'Concentration'
        };
        
        return moodNames[mood] || 'Aléatoire';
    }
}

module.exports = MusicCog;
