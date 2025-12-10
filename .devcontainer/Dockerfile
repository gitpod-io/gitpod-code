FROM mcr.microsoft.com/devcontainers/typescript-node:latest

# Disable npm/yarn lifecycle scripts for security
RUN npm config set ignore-scripts true --location=user && \
    echo 'ignore-scripts true' >> ~/.yarnrc
