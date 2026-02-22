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
  ],
};
