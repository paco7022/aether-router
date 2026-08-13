module.exports = {
  apps: [
    {
      name: "aether-router",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      time: true,
    },
    {
      // Puente entre el router y ComfyUI (generación de imagen/video).
      // El secreto NO va en el repo: se lee del entorno al hacer pm2 start.
      //   $env:BRIDGE_SECRET="..."; pm2 start ecosystem.config.cjs --only comfy-bridge
      name: "comfy-bridge",
      script: "comfy-bridge/src/server.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        BRIDGE_PORT: "8189",
        BRIDGE_HOST: "127.0.0.1",
        COMFY_URL: "http://127.0.0.1:8188",
        BRIDGE_SECRET: process.env.BRIDGE_SECRET,
      },
      error_file: "./logs/comfy-bridge-error.log",
      out_file: "./logs/comfy-bridge-out.log",
      time: true,
    },
    {
      // Túnel dedicado del bridge (comfy-gpu.aether-ai.dev). Separado del
      // servicio de Windows del túnel principal, que necesita admin para
      // recargar su configuración.
      name: "comfy-tunnel",
      script: process.env.CLOUDFLARED_BIN || "C:\\Users\\erick\\.cloudflared\\cloudflared-2026.6.1.exe",
      args: `--config ${process.env.USERPROFILE || "C:\\Users\\erick"}\\.cloudflared\\comfy-config.yml tunnel run aether-comfy`,
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "30s",
      time: true,
    },
    {
      // ComfyUI portable. Ruta fuera del repo; override con COMFYUI_DIR.
      name: "comfyui",
      script: "python_embeded/python.exe",
      args: "-s ComfyUI/main.py --windows-standalone-build --port 8188 --listen 127.0.0.1",
      cwd:
        process.env.COMFYUI_DIR ||
        "C:\\AetherAI\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "60s",
      time: true,
    },
  ],
};
