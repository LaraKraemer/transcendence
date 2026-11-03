FROM postgres:17-alpine
RUN apk add --no-cache flock
ENTRYPOINT ["sh", "/scripts/backup-entrypoint.sh"]
