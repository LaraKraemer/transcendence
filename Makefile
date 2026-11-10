# Shared Compose command; override with make COMPOSE="docker compose ..." if needed.
COMPOSE=docker compose
CERT_DIR=nginx/certs
CERT=$(CERT_DIR)/localhost.pem

# These targets are commands, even if a file with the same name exists.
.PHONY: build certs up dev rebuild down stop restart logs clean prune backup restore

# Build service images without starting containers.
build:
	$(COMPOSE) build

# Create the local HTTPS certificate once and trust its CA on this machine.
certs: $(CERT)

# "nginx" is the name the frontend container uses to reach the proxy.
$(CERT):
	mkdir -p $(CERT_DIR)/ca
	mkcert -install
	mkcert -cert-file $(CERT) -key-file $(CERT_DIR)/localhost-key.pem localhost 127.0.0.1 ::1 nginx
	cp "$$(mkcert -CAROOT)/rootCA.pem" $(CERT_DIR)/ca/rootCA.pem

# Start the full evaluation stack, including backups and monitoring.
up: $(CERT)
	$(COMPOSE) up -d

# Start the app, HTTPS proxy and backups without monitoring.
dev: $(CERT)
	$(COMPOSE) up -d db backend frontend nginx backup

# Rebuild images and renew dependency volumes; keep database and avatar volumes.
# Nginx resolves its upstreams only at startup, so restart it to pick up new container IPs.
rebuild: $(CERT)
	$(COMPOSE) up --build --renew-anon-volumes -d
	$(COMPOSE) restart nginx

# Stop and remove project containers and networks; preserve volumes and backups.
down:
	$(COMPOSE) down

# Stop containers without removing them, their networks or their volumes.
stop:
	$(COMPOSE) stop

# Recreate project containers while preserving stored data.
restart: $(CERT)
	$(COMPOSE) down
	$(COMPOSE) up -d

# Follow logs from all services until interrupted with Ctrl+C.
logs:
	$(COMPOSE) logs -f

# Confirm before deleting project containers and database/avatar/monitoring volumes.
# Host backups in ./backups survive this command.
clean:
	@printf 'Delete database, avatar and monitoring volumes? Host backups survive. Type yes to continue: '; \
	IFS= read -r confirmation && [ "$$confirmation" = "yes" ] || { printf 'Cancelled.\n'; exit 1; }
	$(COMPOSE) down --volumes --remove-orphans

# Remove unused Docker resources across all projects, including unused images.
# Docker asks for confirmation before pruning.
prune:
	docker system prune -a

# Create an additional database/avatar backup now; the database must be running.
backup:
	$(COMPOSE) run --rm --no-deps backup once

# Replace current data: make restore BACKUP=backups/<snapshot> CONFIRM=--confirm
restore:
	COMPOSE="$(COMPOSE)" sh scripts/restore.sh "$(BACKUP)" "$(CONFIRM)"
