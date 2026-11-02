# Shared Compose command; override with make COMPOSE="docker compose ..." if needed.
COMPOSE=docker compose

# These targets are commands, even if a file with the same name exists.
.PHONY: build up rebuild down stop restart logs clean prune backup restore

# Build service images without starting containers.
build:
	$(COMPOSE) build

# Start services in the background, creating containers when needed.
up:
	$(COMPOSE) up -d

# Rebuild images and renew dependency volumes; keep database and avatar volumes.
rebuild: 
	$(COMPOSE) up --build --renew-anon-volumes -d

# Stop and remove project containers and networks; preserve volumes and backups.
down:
	$(COMPOSE) down

# Stop containers without removing them, their networks or their volumes.
stop:
	$(COMPOSE) stop

# Recreate project containers while preserving stored data.
restart:
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
	sh scripts/restore.sh "$(BACKUP)" "$(CONFIRM)"
