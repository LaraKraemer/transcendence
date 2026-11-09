#!/bin/sh
# Validate monitoring configs offline, using disposable containers and fake credentials.
set -eu
cd "$(dirname "$0")/.."

alertmanager_image=prom/alertmanager:v0.34.2
prometheus_image=prom/prometheus:v3.15.1
check_directory=$(mktemp -d)
trap 'rm -rf "$check_directory"' EXIT HUP INT TERM
# The images run as an unprivileged user; these are dummy credentials only.
chmod 755 "$check_directory"
printf '%s\n' '123456:test-only-token' > "$check_directory/telegram_bot_token"
printf '%s\n' '123456' > "$check_directory/telegram_chat_id"
chmod 644 "$check_directory/telegram_bot_token" "$check_directory/telegram_chat_id"

docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.telegram.yml config --quiet

docker run --rm --network none --entrypoint /bin/promtool \
  -v "$PWD/monitoring:/etc/prometheus:ro" \
  "$prometheus_image" check config /etc/prometheus/prometheus.yml

for configuration in alertmanager.yml alertmanager.telegram.yml; do
  docker run --rm --network none --entrypoint /bin/amtool \
    -v "$PWD/monitoring:/etc/alertmanager:ro" \
    -v "$check_directory:/run/secrets:ro" \
    "$alertmanager_image" check-config "/etc/alertmanager/$configuration"
done
