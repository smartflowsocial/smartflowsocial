# Deployment Guide

**Estimated time:** 45 minutes  
**Difficulty:** Intermediate  
**Last updated:** 2026-11-14

Guide for deploying SmartFlowSocial to production environments, including platform-specific
instructions.

**What was checked for `0.1.0-alpha.0`:** the start commands in
[Worker Process Setup](#worker-process-setup) were run locally against a production build. The
platform recipes (Fly.io, Railway, Vercel, AWS, Docker Compose, PM2, systemd) were not run end to
end as part of that check. Treat them as starting points and test them before you rely on them.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Platform-Specific Guides](#platform-specific-guides)
- [Docker Deployment](#docker-deployment)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Worker Process Setup](#worker-process-setup)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Process Management](#process-management)
- [Health Checks](#health-checks)
- [Post-Deployment Verification](#post-deployment-verification)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

- ✅ Node.js 26.13.1 or higher (`.nvmrc` is `26.13.1`)
- ✅ PostgreSQL database (managed or self-hosted)
- ✅ Redis instance (for BullMQ queues and the internal Nostr read cache)
- ✅ S3-compatible storage when the install accepts uploads
- ✅ `SFS_DEPLOYMENT_MODE=self_hosted` for an operator install, or `hosted` for managed
  SmartFlowSocial
- ✅ Domain name (for production)
- ✅ SSL certificate (or use Let's Encrypt)

---

## Pre-Deployment Checklist

- [ ] All environment variables configured
- [ ] Database migrations tested
- [ ] Production database backed up
- [ ] Redis configured and accessible
- [ ] Storage bucket created and configured
- [ ] Nostr Publisher service deployed
- [ ] Domain DNS configured
- [ ] SSL certificate obtained
- [ ] Worker process configured
- [ ] Monitoring and logging setup
- [ ] Error tracking configured
- [ ] Backup strategy in place

---

## Platform-Specific Guides

### Fly.io

Fly.io is well-suited for this React Router app, with built-in PostgreSQL and Redis support.

#### 1. Install Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
```

#### 2. Login to Fly.io

```bash
fly auth login
```

#### 3. Initialize Fly.io App

```bash
fly launch
```

This will create a `fly.toml` configuration file.

#### 4. Configure Secrets

```bash
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set SESSION_SECRET="your-secret"
fly secrets set SFS_DEPLOYMENT_MODE="self_hosted"
# Managed SmartFlowSocial uses hosted.
# fly secrets set SFS_DEPLOYMENT_MODE="hosted"
fly secrets set NOSTR_NSEC="nsec1..."
# Optional. Unset uses the public Primal sockets.
# fly secrets set PRIMAL_UPSTREAM_URLS="wss://cache.example.com/v1"
fly secrets set REDIS_URL="redis://..."
fly secrets set STORAGE_ACCESS_KEY="..."
fly secrets set STORAGE_SECRET="..."
fly secrets set STORAGE_REGION="..."
fly secrets set STORAGE_BUCKET="..."
fly secrets set OWNER_NWC="nostr+walletconnect://..."
```

#### 5. Create PostgreSQL Database

```bash
fly postgres create --name smartflow-db
fly postgres attach smartflow-db
```

#### 6. Create Redis Instance

```bash
fly redis create
```

#### 7. Deploy Application

```bash
fly deploy
```

#### 8. Deploy Worker Process

The image's default command (`pnpm start` in the `Dockerfile`) already runs the web server and one
worker in the same machine. Skip this step unless you changed the web app to run only
`node ./build/server.js`. In that case, create a separate `fly.worker.toml` for the worker and give
it the command `node ./build/worker.js`:

```toml
app = "smartflow-worker"
primary_region = "iad"

[build]

[env]
  NODE_ENV = "production"

[[services]]
  internal_port = 3000
  protocol = "tcp"
```

Deploy worker:

```bash
fly deploy --config fly.worker.toml
```

#### 9. Scale Workers

```bash
fly scale count worker=2
```

---

### Railway

Railway provides simple deployment with automatic PostgreSQL and Redis provisioning.

#### 1. Install Railway CLI

```bash
pnpm add -g @railway/cli
```

#### 2. Login

```bash
railway login
```

#### 3. Initialize Project

```bash
railway init
```

#### 4. Add PostgreSQL Service

In Railway dashboard:

- Click "New" → "Database" → "PostgreSQL"
- Railway automatically sets `DATABASE_URL`

#### 5. Add Redis Service

- Click "New" → "Database" → "Redis"
- Railway automatically sets `REDIS_URL`

#### 6. Configure Environment Variables

In Railway dashboard, add all required environment variables.

#### 7. Deploy

```bash
railway up
```

#### 8. Deploy Worker

`railpack.json` starts `pnpm run start`, which already runs the web server and one worker. Skip this
step unless you set the web service's start command to `pnpm start:server`. In that case, create a
separate service for the worker:

```bash
railway add
# Select "Empty Service"
# Set start command: pnpm start:worker
```

---

### Vercel

Vercel is optimized for frontend deployments but can run this React Router app.

**Note**: Vercel has limitations for long-running processes. Consider using Vercel for the main app
and a separate service for the worker.

#### 1. Install Vercel CLI

```bash
pnpm add -g vercel
```

#### 2. Deploy

```bash
vercel --prod
```

#### 3. Configure Environment Variables

In Vercel dashboard → Settings → Environment Variables

#### 4. Worker Process

Deploy worker separately to Railway, Fly.io, or a VPS.

---

### AWS (EC2/ECS)

#### 1. EC2 Deployment

**Setup:**

```bash
# SSH into EC2 instance
ssh ubuntu@your-ec2-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo pnpm install -g pm2

# Clone repository
git clone https://github.com/smartflowsocial/smartflowsocial.git
cd smartflowsocial

# Install dependencies
pnpm install

# Build application
pnpm build

# Values already in the environment win. A `.env` in the working directory fills in the rest.
# Export the production file in the shell that starts PM2.
set -a; . ./.env.production; set +a

# Start with PM2. `pnpm start` runs the web server and the worker together.
pm2 start pnpm --name "smartflow" -- start

# Save PM2 configuration
pm2 save
pm2 startup
```

#### 2. ECS Deployment

Use Docker images with ECS. See [Docker Deployment](#docker-deployment) section.

---

### Docker Deployment

The hosted app is this `Dockerfile`. Coolify uses the Dockerfile build pack, exposes port 3000, and
leaves the start command empty so the image runs `pnpm start`. The base image is
`node:26.13.1-bookworm-slim`, the same patch as `.nvmrc`. Node 26 does not ship Corepack; the image
installs Corepack itself. Nixpacks cannot select Node 26, so do not build production with it.

#### 1. Build Docker Image

```bash
docker build -t smartflow:latest .
```

#### 2. Run with Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: "3.8"

services:
  app:
    image: smartflow:latest
    restart: always
    # Web server only. Without this line the image runs the web server and a worker together,
    # and the `worker` service below would be a second worker.
    command: node ./build/server.js
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - SESSION_SECRET=${SESSION_SECRET}
      - CRON_SECRET=${CRON_SECRET}
      - SFS_DEPLOYMENT_MODE=${SFS_DEPLOYMENT_MODE:-self_hosted}
      - NOSTR_NSEC=${NOSTR_NSEC}
      - REDIS_URL=${REDIS_URL}
      - STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY}
      - STORAGE_SECRET=${STORAGE_SECRET}
      - STORAGE_REGION=${STORAGE_REGION}
      - STORAGE_BUCKET=${STORAGE_BUCKET}
      - OWNER_NWC=${OWNER_NWC}
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthcheck"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: smartflow:latest
    restart: always
    command: node ./build/worker.js
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      # ... the same variables as the app service. The worker runs the same boot validation.
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    restart: always
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
```

#### 3. Deploy

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Environment Configuration

### Production Environment Variables

The production processes load `.env` from the working directory when that file exists. Variables
already set in the environment are kept. A missing file is not an error. Keep secrets out of git and
out of the image. Pass them with your platform's secret settings, `docker run --env-file`, a systemd
`EnvironmentFile`, or `set -a; . ./.env.production; set +a` in the shell that starts the app. The
example below is that file. Never commit it.

With `NODE_ENV=production` the app refuses to boot unless `CRON_SECRET` is at least 32 characters.
An empty `SFS_DEPLOYMENT_MODE` is self-hosted. Managed SmartFlowSocial sets `hosted`. Publishing and
reads run in this process. The full list is in [Configuration](../reference/configuration.md).

```env
# Application
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@host:5432/smartflow

# Session
SESSION_SECRET=your-super-secret-session-key-min-32-chars

# Cron endpoints (required in production, at least 32 characters)
CRON_SECRET=generate-with-openssl-rand-base64-32

# Commercial mode. self_hosted is the default. Managed hosting uses hosted.
SFS_DEPLOYMENT_MODE=self_hosted
NOSTR_NSEC=nsec1...
# Optional. Unset uses NostrMash and the public Primal sockets inside this process.
# PRIMAL_UPSTREAM_URLS=wss://cache.example.com/v1

# Redis
REDIS_URL=redis://host:6379

# Storage
STORAGE_ACCESS_KEY=your-access-key
STORAGE_SECRET=your-secret-key
STORAGE_REGION=us-east-1
STORAGE_BUCKET=smartflow-uploads

# Payments
OWNER_NWC=nostr+walletconnect://...

# Metrics (optional)
METRICS_PORT=3010
WORKER_METRICS_PORT=3011
```

### Security Best Practices

1. **Never commit `.env` files**
2. **Use strong secrets**: Generate with `openssl rand -base64 32`
3. **Rotate secrets regularly**
4. **Use secret management services**: AWS Secrets Manager, HashiCorp Vault, etc.
5. **Restrict access**: Only necessary services should access secrets

### Operator admin dashboard

Signed-in users whose **npub** appears in `ADMIN_NPUBS` (comma-separated) can open:

- **`/dashboard/admin`** - Overview (KPIs, alerts, publishing health, referrals snapshot, system
  probes).
- **`/dashboard/admin/analytics`**, **`/users`**, **`/operations`** - Charts, user directory,
  failures / queues / outbox.
- **`/dashboard/admin/referrals`** - Referral tables, CSV export, payout ledger
  (`referral_payout_audit_log`), batch + manual Lightning payouts, retry failed earnings.
- **`/dashboard/admin/earnings`** - Redirects to Referrals (legacy path).

**Payouts from the UI** use the same logic as the cron job:

- **`REFERRAL_PAYOUTS_ENABLED`** must be `true`, `1`, or `yes`. A configured wallet does not enable
  payouts by itself.
- **`OWNER_NWC`** must be set; otherwise payout buttons stay disabled.
- **Batch payout** processes referrers with **≥ 1000 sats** pending commission, **https/http LNURL**
  payout destination, and valid invoice fetch - see `runReferralPayoutBatch` in the codebase
  (mirrors `cron.referral-payout`).
- **Manual payout** accepts a BOLT11 invoice. The invoice amount has to match the requested amount,
  and that amount has to match a prefix of the oldest pending earnings. A smaller declared amount
  does not authorize a larger invoice.

For scripted manual pay without a browser session, **`REFERRAL_MANUAL_PAYOUT_SECRET`** is required.
`POST /api/referral/manual-payout` returns 401 when the secret is missing or wrong.

---

## Database Setup

### 1. Run Migrations

```bash
# Generate Prisma client
pnpm exec prisma generate

# Run migrations
pnpm exec prisma migrate deploy
```

### 2. Seed Initial Data (Optional)

```bash
pnpm db:seed
```

### 3. Verify Database Connection

```bash
pnpm exec prisma studio
```

### 4. Backup Strategy

Set up automated backups:

```bash
# PostgreSQL backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup-20240101.sql
```

For managed databases (AWS RDS, Railway, Fly.io), use their built-in backup features.

---

## Worker Process Setup

The worker publishes scheduled posts and runs the background timers (subscription renewal, runway
notifications, post analytics, the outbox). The web server does none of that. If no worker is
running, scheduled posts stay queued.

| Command             | What it runs                                                   |
| ------------------- | -------------------------------------------------------------- |
| `pnpm start`        | Web server and one worker, supervised together                 |
| `pnpm start:server` | Web server only                                                |
| `pnpm start:worker` | Worker only                                                    |
| `pnpm dev`          | Web server and worker, for local development                   |
| `pnpm worker:local` | Worker only, in development. Do not run it next to `pnpm dev`. |

The `pnpm start` commands need `pnpm build` first. `pnpm dev` and `pnpm worker:local` do not.

- `pnpm start` is the default in the `Dockerfile` and in `railpack.json`. If either process exits,
  the supervisor stops the other one and exits non-zero, so a process manager or container runtime
  restarts both.
- Use `pnpm start:server` and `pnpm start:worker` when you want the two in separate containers or
  services. The `Procfile` does this with `node ./build/server.js` and `node ./build/worker.js`.
- Do not run `pnpm start:worker` next to `pnpm start`. That adds a second worker.
- `pnpm dev` runs the web server and one worker, and restarts the worker when its files change. Do
  not add `pnpm worker:local` or `pnpm start:worker` next to it.
- The worker serves Prometheus metrics on `WORKER_METRICS_PORT` (default `3011`). The web server
  uses `METRICS_PORT` (default `3010`).

### One process manager entry

```bash
set -a; . ./.env.production; set +a
pm2 start pnpm --name "smartflow" -- start
pm2 save
```

### With Docker

```bash
# Default command: web server and worker together
docker run -d \
  --name smartflow \
  --env-file .env.production \
  -p 3000:3000 \
  smartflow:latest

# Worker only, when the web server runs in its own container with `node ./build/server.js`
docker run -d \
  --name smartflow-worker \
  --env-file .env.production \
  smartflow:latest \
  node ./build/worker.js
```

### Scaling Workers

Running more than one worker has not been tested for this release. BullMQ hands each queued job to
one worker, but every worker process also runs its own timers for subscription renewal, runway
notifications, and post analytics, and binds its own metrics port. Run one worker until you have
tested more than one in staging.

---

## SSL/TLS Configuration

### Let's Encrypt (Recommended)

#### With Caddy

Caddy automatically handles Let's Encrypt certificates:

```caddy
smartflow.example.com {
    reverse_proxy localhost:3000
}
```

#### With Certbot

```bash
# Install Certbot
sudo apt-get install certbot

# Obtain certificate
sudo certbot certonly --standalone -d smartflow.example.com

# Auto-renewal
sudo certbot renew --dry-run
```

### Manual Certificate

If you have your own certificate:

```nginx
ssl_certificate /path/to/cert.pem;
ssl_certificate_key /path/to/key.pem;
```

---

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 80;
    server_name smartflow.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name smartflow.example.com;

    ssl_certificate /etc/ssl/certs/smartflow.crt;
    ssl_certificate_key /etc/ssl/private/smartflow.key;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check
    location /healthcheck {
        proxy_pass http://localhost:3000/healthcheck;
        access_log off;
    }
}
```

### Caddy

```caddy
smartflow.example.com {
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

---

## Process Management

### PM2 (Recommended)

```bash
# Install PM2
pnpm install -g pm2

# Values already in the environment win. A `.env` in the working directory fills in the rest.
set -a; . ./.env.production; set +a

# Start the web server and the worker together
pm2 start pnpm --name "smartflow" -- start

# Save configuration
pm2 save

# Setup startup script
pm2 startup
pm2 save

# Monitor
pm2 monit

# Logs
pm2 logs
```

### systemd

Create `/etc/systemd/system/smartflow.service`:

```ini
[Unit]
Description=SmartFlowSocial Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/smartflow
Environment=NODE_ENV=production
EnvironmentFile=/var/www/smartflow/.env.production
ExecStart=/usr/bin/pnpm start
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable smartflow
sudo systemctl start smartflow
```

---

## Health Checks

The application provides a health check endpoint at `/healthcheck`.

### Manual Check

```bash
curl https://your-domain.com/healthcheck
```

### Monitoring Integration

Configure your monitoring service to check:

- **Endpoint**: `https://your-domain.com/healthcheck`
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Expected Response**: `200 OK` with body `OK`

`curl -H 'accept: application/json'` returns `publisherBackend: "internal"` and
`nostrReadBackend: "internal"` with the deployment identity. Relay outcomes are
`nostr_publisher_relay_total{backend,result,failure_category}` and
`nostr_publisher_relay_latency_ms` on the metrics endpoint. Open sockets are
`nostr_publisher_open_sockets`.

### Metrics Endpoint

Prometheus metrics are available at `/metrics`, on port 3010 for the web server and port 3011 for
the worker by default:

```bash
curl http://localhost:3010/metrics
curl http://localhost:3011/metrics
```

Worker Prometheus metrics (if enabled via `WORKER_METRICS_PORT`):

```bash
curl "http://localhost:${WORKER_METRICS_PORT}/metrics"
```

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://your-domain.com/healthcheck
```

Should return `OK`.

### 2. Database Connection

```bash
pnpm exec prisma studio
```

### 3. Worker Process

Check worker logs:

```bash
pm2 logs smartflow-worker
# or
docker logs smartflow-worker
```

### 4. Queue System

Verify Redis connection and queues:

```bash
redis-cli -u $REDIS_URL ping
```

### 5. Storage

Test image upload functionality.

### 6. Nostr Integration

Test posting to Nostr.

---

## Scaling

### Horizontal Scaling

1. **Application Servers**: Deploy multiple instances behind a load balancer
2. **Worker Processes**: Scale workers independently based on queue load
3. **Database**: Use read replicas for read-heavy workloads
4. **Redis**: Use Redis Cluster for high availability

### Vertical Scaling

Increase resources (CPU, RAM) for:

- Database server
- Redis instance
- Application servers

### Load Balancing

Use a load balancer (nginx, HAProxy, AWS ALB) to distribute traffic:

```nginx
upstream smartflow {
    least_conn;
    server app1:3000;
    server app2:3000;
    server app3:3000;
}
```

---

## Troubleshooting

### Application Won't Start

1. Check environment variables
2. Verify database connection
3. Check logs: `pm2 logs` or `docker logs`
4. Verify port availability

### Worker Not Processing Jobs

1. Check Redis connection
2. Verify worker is running: `pm2 list`
3. Check worker logs
4. Verify queue configuration

### Database Connection Issues

1. Verify `DATABASE_URL` is correct
2. Check firewall rules
3. Verify database is accessible
4. Check connection pool settings

### High Memory Usage

1. Monitor with `pm2 monit`
2. Check for memory leaks
3. Increase server resources
4. Optimize database queries

---

## Additional Resources

- [Environment setup](../getting-started/installation.md#environment-configuration)
- [Operations Guide](./operations.md)
- [Troubleshooting Guide](../troubleshooting/common-issues.md)
- [Architecture](../getting-started/architecture.md)
