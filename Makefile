COMPOSE=docker compose

.PHONY: build up down restart logs clean

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

rebuild: 
	$(COMPOSE) up --build -d

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