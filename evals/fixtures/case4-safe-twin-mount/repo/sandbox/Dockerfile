# TINA's hands: a small Linux box with the usual developer tools.
# It runs with no network, a read-only root, and only the project folder mounted at /workspace.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git jq curl tidy ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/tmp
WORKDIR /workspace
# A sandbox that somehow outlives TINA shuts itself down after 6 hours (and --rm removes it).
CMD ["sleep", "21600"]
