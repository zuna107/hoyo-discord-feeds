module.exports = {
  apps: [
    {
      name: "feed-engine-api",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        ROLE: "api",
        PORT: 8080,
      },
      max_memory_restart: "300M",
      instances: 1,
      autorestart: true,
    },
    {
      name: "feed-engine-worker",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        ROLE: "worker",
      },
      max_memory_restart: "400M",
      instances: 1,
      autorestart: true,
    },
    {
      name: "feed-engine-dashboard",
      script: "npm",
      args: "--prefix dashboard run preview -- --host 0.0.0.0 --port 3000",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "200M",
      instances: 1,
      autorestart: true,
    },
  ],
};
