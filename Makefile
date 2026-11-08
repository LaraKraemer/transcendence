# Shared Compose command; override with make COMPOSE="docker compose ..." if needed.
COMPOSE=docker compose
CERT_DIR=nginx/certs
CERT=$(CERT_DIR)/localhost.pem

# These targets are commands, even if a file with the same name exists.
.PHONY: build certs up rebuild down stop restart logs clean prune backup restore

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

# Start services in the background, creating containers when needed.
up: $(CERT)
	$(COMPOSE) up -d

# Rebuild images and renew dependency volumes; keep database and avatar volumes.
rebuild: $(CERT)
	$(COMPOSE) up --build --renew-anon-volumes -d

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

# Delete project containers and volumes, including database and avatar data.
# Host backups in ./backups survive this command.
clean:
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
