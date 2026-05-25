// Configuration du bot Discord
module.exports = {
    // Token du bot (à remplacer par votre vrai token)
    DISCORD_TOKEN: process.env.DISCORD_TOKEN || 'MTQwOTI4NzA3OTk5MjYyMzIyNw.Gh_jww.yEMXXTmfrfS3f9pFzXSTOYP1CBe-QUOYGrsBp8',
    
    // ID du client Discord (à remplacer par votre vrai client ID)
    CLIENT_ID: process.env.CLIENT_ID || '1409287079992623227',
    
    // Préfixe pour les commandes par message
    PREFIX: process.env.PREFIX || '+',
    
    // Activer les slash commands (/) - IMPORTANT pour /playstr
    REGISTER_SLASH: process.env.REGISTER_SLASH || 'true',
    
    // Configuration Lavalink
    LAVALINK_HOST: process.env.LAVALINK_HOST || 'lavalink.devxcode.in',
    LAVALINK_PORT: process.env.LAVALINK_PORT || 443,
    LAVALINK_PASSWORD: process.env.LAVALINK_PASSWORD || 'DevamOP',
    LAVALINK_SECURE: process.env.LAVALINK_SECURE || 'true',
    
    // Configuration Spotify (optionnel)
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || 'your_spotify_client_id_here',
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || 'your_spotify_client_secret_here',
    
    // Configuration DJ
    DJ_ROLE_NAME: process.env.DJ_ROLE_NAME || 'DJ',
    
    // Cooldown pour les commandes
    PADD_COOLDOWN_SECONDS: process.env.PADD_COOLDOWN_SECONDS || 5
};
