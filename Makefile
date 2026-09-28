COMPOSE=docker compose

.PHONY: build up rebuild down restart logs clean prune

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

rebuild: 
	$(COMPOSE) up --build --renew-anon-volumes -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) down
	$(COMPOSE) up -d

logs:
	$(COMPOSE) logs -f

clean:
	$(COMPOSE) down --volumes --remove-orphans

prune:
	docker system prune -a