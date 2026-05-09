# VPS Capacity Checklist

Last updated: 2026-05-09

Scope: early Global LMG launch on a single VPS running Nginx, PM2, the client
API, the admin API, static frontend assets, ClamAV, system cron jobs, and Aiven
MySQL.

This is a lean launch plan, not a 1M-user architecture. Keep the VPS simple,
measure it, and upgrade before sustained saturation.

## Server Size

Minimum launch VPS:

- 2 vCPU
- 4 GB RAM
- 60 GB SSD
- 2 GB swap
- Single PM2 instance for `global-lmg-client-api`
- Single PM2 instance for `global-lmg-admin-api`

Recommended launch VPS:

- 2-4 vCPU
- 8 GB RAM
- 100 GB SSD
- 4 GB swap
- Two PM2 instances each for client/admin APIs if CPU and memory stay healthy

Avoid 1 vCPU / 2 GB RAM when ClamAV runs on the same host. ClamAV plus Node,
Nginx, cron, logs, and OS cache leave too little headroom.

## RAM Budget

Typical early-launch planning numbers:

| Component | Minimum estimate | Notes |
| --- | ---: | --- |
| Client API, 1 PM2 instance | 250-450 MB | `max_memory_restart` should be 384-512 MB |
| Admin API, 1 PM2 instance | 250-450 MB | Heavier admin list endpoints can use more memory |
| Second API instances | +500-900 MB | Only enable on the recommended 8 GB host |
| ClamAV daemon | 600-1,200 MB | Depends on signature database and scan activity |
| Nginx | 30-80 MB | Static frontends and reverse proxy |
| PM2 daemon and log buffers | 80-150 MB | Higher if logs are not rotated |
| Cron jobs | 50-250 MB transient | FX/reminders/sweepers should be short-lived |
| OS, filesystem cache, security agents | 700-1,200 MB | Leave room for kernel cache and updates |

On a 4 GB VPS, run one PM2 instance per API and keep ClamAV local only if swap,
log rotation, and alerts are configured. On an 8 GB VPS, the sample two-instance
PM2 layout is reasonable for early traffic.

## Swap

Configure swap to absorb short spikes, not to mask chronic RAM shortage:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-global-lmg-swap.conf
sudo sysctl --system
```

Use 2 GB swap on the minimum VPS and 4 GB on the recommended VPS. If swap is
used continuously, upgrade RAM or move ClamAV/object storage work off-host.

## PM2 Limits

The sample PM2 file uses:

```js
max_memory_restart: '512M'
```

Recommended settings:

- Minimum 4 GB VPS: one instance per API, `max_memory_restart` `384M` to `512M`.
- Recommended 8 GB VPS: two instances per API, `max_memory_restart` `512M`.
- If PM2 restarts from memory more than once per day, inspect for leaks or
  upgrade RAM before increasing the limit.

Commands:

```bash
pm2 status
pm2 describe global-lmg-client-api
pm2 describe global-lmg-admin-api
pm2 monit
```

## Log Rotation

Install PM2 log rotation:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 save
```

Add system logrotate for Nginx and cron logs if the distro does not already
cover them. Cron job logs live under `/var/log/global-lmg/*.log`.

Disk alerting matters because local uploads, PM2 logs, Nginx logs, cron logs,
and backup archives can all grow on the same VPS.

## Monitoring Checklist

Host alerts:

| Signal | Threshold | Action |
| --- | ---: | --- |
| CPU sustained | > 80% for 10 minutes | Inspect PM2, ClamAV, cron overlap, slow queries |
| RAM sustained | > 80% for 10 minutes | Check PM2 RSS, ClamAV RSS, swap use |
| Swap use | > 25% for 10 minutes | Treat as RAM pressure warning |
| Disk used | > 75% | Clean logs/backups, expand disk, or move uploads to S3 |
| Disk used critical | > 85% | Open incident; uploads/logging may fail soon |
| Load average | > vCPU count for 10 minutes | Inspect CPU and I/O wait |

Application alerts:

| Signal | Threshold | Action |
| --- | ---: | --- |
| Client API live/ready | failing 2 consecutive checks | Page primary owner |
| Admin API live/ready | failing 2 consecutive checks | Page primary owner |
| Frontend HTML shell | failing 2 consecutive checks | Check Nginx/static release |
| PM2 restarts | any unexpected restart | Inspect logs and memory |
| Reminder cron | no run for 5 minutes | Check cron, lock file, admin env |
| Reminder failures | failed count > 0 for 3 runs | Triage provider/data issue |
| ClamAV readiness | unreachable for 5 minutes | Downloads stay safe but scans backlog |
| Aiven MySQL connections | approaching plan limit | Tune pool, inspect slow endpoints |

Minimum external monitors:

- `https://api.globallmg.org/api/v1/health/live`
- `https://api.globallmg.org/api/v1/health/ready`
- `https://admin-api.globallmg.org/api/v1/admin/health/live`
- `https://admin-api.globallmg.org/api/v1/admin/health/ready`
- public frontend home
- admin frontend login

## Upgrade Triggers

Upgrade the VPS or move work off-host when any of these are true:

- CPU stays above 80% during normal business hours.
- RAM stays above 80% or swap is used continuously.
- PM2 memory restarts happen more than once per day.
- Disk exceeds 75% after log rotation and backup pruning.
- Billing/messages/admin list p95 stays above 1.5 seconds under expected load.
- ClamAV scans create upload backlogs or make the host memory-constrained.
- Local upload backups become too large or slow for the restore objective.
- You need more than one API host. At that point, local document storage must
  move to S3-compatible storage first.

## Early Launch Checklist

- [ ] VPS meets at least the minimum spec.
- [ ] Swap is configured and enabled.
- [ ] PM2 `max_memory_restart` limits are set.
- [ ] PM2 log rotation is installed.
- [ ] `/var/log/global-lmg` exists and cron logs rotate.
- [ ] Uptime/API health monitors are green.
- [ ] CPU/RAM/disk alerts are configured.
- [ ] Reminder cron failure alert is configured.
- [ ] Aiven MySQL connection and storage alerts are configured.
- [ ] ClamAV memory and readiness are checked after boot.
- [ ] If local uploads are used, backup/restore from `docs/object-storage.md`
  has been tested.
