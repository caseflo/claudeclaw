# Service Setup — ClaudeClaw OS on Windows 11

This guide covers setting up ClaudeClaw OS as a persistent background service on Windows 11 using PM2.

---

## Prerequisites

- Node.js 24 installed
- ClaudeClaw OS installed at this machine (this repo)
- `npm install` already run

---

## Step 1 — Install PM2 globally

Open an **elevated PowerShell** prompt (right-click → Run as Administrator) and run:

```powershell
npm install -g pm2
```

---

## Step 2 — Register PM2 as a Windows service

Use `pm2-installer` to register PM2 itself as a Windows NSSM-backed service so it survives reboots.

In an **elevated PowerShell** prompt:

```powershell
# Download and run the installer
irm https://raw.githubusercontent.com/jessety/pm2-installer/master/install.ps1 | iex
```

This registers `PM2 Service` in Windows and configures it to run `pm2 resurrect` on boot.

---

## Step 3 — Build the project

In a normal (non-elevated) PowerShell prompt, from the repo root:

```powershell
npm run build
```

This compiles `src/` → `dist/`.

---

## Step 4 — Create the store/logs directory

PM2's ecosystem config references `store/logs/err.log` and `store/logs/out.log`. Create the directory if it does not exist:

```powershell
mkdir store/logs
```

---

## Step 5 — Start the application

```powershell
pm2 start ecosystem.config.cjs
```

---

## Step 6 — Save the PM2 process list

```powershell
pm2 save
```

This writes the current process list to `%USERPROFILE%\.pm2\dump` so the service can resurrect it on reboot.

---

## Step 7 — Verify the service is running

```powershell
pm2 status
```

You should see `claudeclaw-os` with status `online`.

Check the logs:

```powershell
pm2 logs claudeclaw-os --lines 20
```

Verify the bot has connected to Telegram (look for `Bot started` in the output).

---

## Step 8 — Verify the dashboard health endpoint

Once the bot is online, test the health endpoint:

```powershell
curl http://localhost:3141/api/health
```

You should receive JSON with `ok: true`.

**Note:** Add `?token=YOUR_DASHBOARD_TOKEN` if you have token authentication enabled.

---

## Step 9 — Verify PM2 resurrect on reboot

After a reboot, PM2 Service should automatically resurrect all saved processes. Confirm by checking after a restart:

```powershell
pm2 status
```

---

## PM2 Log Rotation

PM2's log rotation module prevents log files from growing indefinitely. Install and configure it once:

```powershell
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

- `max_size 10M` — rotate when log exceeds 10 MB
- `retain 14` — keep 14 rotated files (14 days of logs)
- `compress true` — gzip rotated files
- `rotateInterval '0 0 * * *'` — rotate at midnight every day

---

## Useful PM2 Commands

| Command | Description |
|---------|-------------|
| `pm2 status` | List all processes |
| `pm2 logs claudeclaw-os` | Stream live logs |
| `pm2 restart claudeclaw-os` | Restart the bot |
| `pm2 stop claudeclaw-os` | Stop the bot |
| `pm2 delete claudeclaw-os` | Remove from PM2 |
| `pm2 save` | Save current process list |
| `pm2 resurrect` | Restore saved processes (after reboot) |

---

## Troubleshooting

### Bot does not start after reboot

```powershell
pm2 resurrect
pm2 logs claudeclaw-os
```

### PM2 Service not running

```powershell
# Check service status (requires admin PowerShell)
Get-Service -Name 'PM2 Service'
```

### Port 3141 already in use

Check if another process is using the dashboard port and stop it, or change `DASHBOARD_PORT` in your `.env`.

---

## Uninstalling the service

```powershell
# Stop all processes
pm2 delete all

# Remove the Windows service (requires admin PowerShell)
irm https://raw.githubusercontent.com/jessety/pm2-installer/master/uninstall.ps1 | iex
```
