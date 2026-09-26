FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g gitnexus@latest

ENV GITNEXUS_HOME=/data/gitnexus
ENV KORAZERO_REPO_ROOT=/repos

WORKDIR /app

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh \
  && mkdir -p /data/gitnexus /repos

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/app/start.sh"]
