module.exports = {
  apps: [{
    name: 'claudeclaw-os',
    script: 'dist/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    min_uptime: '30s',
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 2000,
    kill_timeout: 10000,
    wait_ready: true,
    listen_timeout: 15000,
    env: { NODE_ENV: 'production' },
    error_file: 'store/logs/err.log',
    out_file:   'store/logs/out.log',
    merge_logs: true,
    time: true
  }]
};
