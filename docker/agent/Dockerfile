# Image for Bazinga's "run agents in a container" option.  Build it once:
#   docker build -t bazinga-agent:latest docker/agent
# It has git, a JDK + Maven (for Java projects) and Claude Code.  Add the tools your projects need.
FROM node:20-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git openjdk-17-jdk-headless maven ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code
# a home that works for any uid (Bazinga passes --user on Linux); the named volume copies these permissions on first use
RUN mkdir -p /home/agent && chmod 1777 /home/agent
COPY bazinga-run /usr/local/bin/bazinga-run
RUN chmod 755 /usr/local/bin/bazinga-run
ENV HOME=/home/agent
WORKDIR /work
ENTRYPOINT ["bazinga-run"]
