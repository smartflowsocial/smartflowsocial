# Quick Start Guide

**Estimated time:** 30–60 minutes for a useful local scheduler  
**Difficulty:** Beginner  
**Last updated:** 2026-11-14

This is the local development setup. It is not a five-minute production install. A useful local
scheduler needs Node.js, pnpm, PostgreSQL, and Redis. Publishing and Nostr reads run in this
process. An HTTP publisher and an HTTP cache proxy are optional legacy adapters. Uploads need
S3-compatible storage. Production self-hosting is covered in the
[deployment guide](../guides/deployment.md).

---

## Prerequisites

Before you begin, ensure you have:

- ✅ **Node.js 26.13.1+** installed ([Download](https://nodejs.org/)). `.nvmrc` is `26.13.1`.
- ✅ **pnpm 12.21.0**. Node 26 does not ship Corepack
  (`npm install --global corepack@0.36.0 && corepack enable && corepack prepare pnpm@12.21.0 --activate`)
- ✅ **PostgreSQL** running (local or remote)
- ✅ **Redis** running (for background jobs)
- ✅ **S3-compatible storage** when you exercise uploads
- ✅ **Nostr browser extension** (Alby, nos2x, or Amber) or a NIP-46 remote signer

Terms used in these guides are collected in the [glossary](../meta/glossary.md).

---

## Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/smartflowsocial/smartflowsocial.git
cd smartflowsocial

# Install dependencies
pnpm install
```

---

## Step 2: Configure Environment

```bash
# Copy the example environment file
cp example.env .env

# Edit .env with your configuration
# At minimum, set:
# - DATABASE_URL
# - SESSION_SECRET
# - REDIS_URL
# - SFS_DEPLOYMENT_MODE=self_hosted on an install you operate
# - Storage credentials (S3, R2, etc.)
```

**Quick setup with Docker:**

```bash
# Start PostgreSQL and Redis
pnpm docker

# Use these defaults:
# DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
# REDIS_URL=redis://127.0.0.1:6379
```

See [Environment Setup](./installation.md#environment-configuration) for detailed configuration.

---

## Step 3: Set Up Database

```bash
# Generate Prisma client
pnpm exec prisma generate

# Apply migrations
pnpm exec prisma migrate deploy

# Seed initial data (optional)
pnpm db:seed
```

---

## Step 4: Start the Application

```bash
pnpm dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

`pnpm dev` starts the web server and the worker, and restarts the worker when its files change.
Worker metrics are on port 3011. `pnpm worker:local` runs the worker without the web server. Do not
run it next to `pnpm dev`, or you get a second worker.

The default install publishes from this process. It does not need a publisher URL, a publisher
token, or a Cloudflare account. `pnpm docker` starts Postgres and Redis only. Real loopback delivery
is `pnpm test:relay-publish`. The checked procedure is the [self-host smoke](./self-host-smoke.md).

Before you call this healthy:

```bash
curl -fsS http://localhost:3000/healthcheck
```

A 200 from `/healthcheck` means the app can reach Postgres. It does not mean the publisher, object
storage, or Lightning wallet is configured.

---

## Step 5: Log In

1. Open [http://localhost:3000](http://localhost:3000)
2. Click **"Log in with Nostr"**
3. Approve the login request in your Nostr extension
4. You're in! 🎉

---

## What's Next?

### For End Users

- **[First Steps Guide](./first-steps.md)** - Learn the basics (30 minutes)
- **[Posting Guide](../guides/user-guides/posting.md)** - Create your first post
- **[Calendar Guide](../guides/user-guides/calendar.md)** - Schedule posts visually

### For Developers

- **[Installation Guide](./installation.md)** - Complete development setup
- **[Architecture Overview](./architecture.md)** - Understand the system
- **[Developer Guide](../guides/developer-guide.md)** - Development workflow

### For DevOps

- **[Deployment Guide](../guides/deployment.md)** - Production deployment
- **[Operations Guide](../guides/operations.md)** - Monitoring and maintenance

---

## Troubleshooting

### Database Connection Error

```bash
# Check PostgreSQL is running
pg_isready -h localhost

# Or with Docker
docker ps | grep postgres
```

### Redis Connection Error

```bash
# Check Redis is running
redis-cli ping

# Or with Docker
docker ps | grep redis
```

### Port Already in Use

```bash
# Change port in .env
PORT=3001
```

See [Troubleshooting Guide](../troubleshooting/common-issues.md) for more solutions.

---

## Quick Reference

| Task             | Command                                                 |
| ---------------- | ------------------------------------------------------- |
| Start dev server | `pnpm dev` (web server and worker)                      |
| Worker only      | `pnpm worker:local` (not beside `pnpm dev`)             |
| Production       | `pnpm build`, then `pnpm start` (web server and worker) |
| Publish smoke    | `pnpm smoke:publish`                                    |
| Run tests        | `pnpm test`                                             |
| Check types      | `pnpm exec tsc --noEmit`                                |
| Format code      | `pnpm format`                                           |
| Lint code        | `pnpm lint`                                             |

---

## Related Documentation

- [Installation Guide](./installation.md) - Detailed setup instructions
- [Environment Configuration](../reference/configuration.md) - All environment variables
- [Architecture Overview](./architecture.md) - System design
- [Troubleshooting](../troubleshooting/common-issues.md) - Common issues and solutions

---

**Next:** [First Steps Guide](./first-steps.md) → Learn the basics in 30 minutes
