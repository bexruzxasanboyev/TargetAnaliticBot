module.exports = {
  apps: [
    {
      name: 'target-analytic-bot',
      script: './dist/index.js',
      cwd: '/root/asosIT/target-analytic-bot',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Tashkent',
      },
      error_file: '/root/.pm2/logs/target-analytic-bot-error.log',
      out_file: '/root/.pm2/logs/target-analytic-bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      kill_timeout: 10000,
      listen_timeout: 10000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s',
    },
  ],
};
