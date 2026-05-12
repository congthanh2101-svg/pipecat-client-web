module.exports = {
  apps: [{
    name: 'pipecat-bridge',
    script: 'server.js',
    cwd: __dirname,
    env: {
      PORT: 3099,
      BACKEND_WS: 'wss://aeon-pipecat.securityzone.vn/ws',
      NODE_ENV: 'production',
    },
    // For production behind nginx, set these:
    // HOST: 'web.securityzone.vn',
    // PROTOCOL: 'wss',
  }],
};
