FROM gitpod/workspace-full

# Node 25 and later do not ship Corepack. Pin the same pnpm as packageManager.
RUN npm install --global corepack@0.36.0 \
  && corepack enable \
  && corepack prepare pnpm@12.21.0 --activate

# Install Fly
RUN curl -L https://fly.io/install.sh | sh
ENV FLYCTL_INSTALL="/home/gitpod/.fly"
ENV PATH="$FLYCTL_INSTALL/bin:$PATH"

# Install GitHub CLI
RUN brew install gh
