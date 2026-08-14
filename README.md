# Transcendence

Final group project as part of the 42 curriculum, building a full-stack expense tracker application.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
	- [Docker](#docker)
	- [Node.js](#nodejs)
- [Clone the Repository](#clone-the-repository)
- [Node Version Setup](#node-version-setup)
- [Project Structure](#project-structure)
- [Environment Setup](#environment-setup)
- [Start the Application](#start-the-application)
- [Docker Commands](#docker-commands)
- [Development Workflow](#development-workflow)
- [Running Without Docker](#running-without-docker)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [Troubleshooting](#troubleshooting)
- [Git Workflow](#git-workflow)
- [Current Project Status](#current-project-status)
- [Team Notes](#team-notes)

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | TypeScript, Next.js |
| Backend | TypeScript, Node.js, Express |
| Database | PostgreSQL (planned) |
| Development Tools | Docker, Docker Compose, Makefile, GitHub Repository, GitHub Projects 

<br>

# Prerequisites

Before starting, make sure you have the following tools installed.

### Docker

Check installation:
```bash
docker --version
docker compose version
```

Install:
https://www.docker.com/products/docker-desktop/


### Node.js

Required version:
```
Node.js 22 LTS
```

Check your version:
```bash
node --version
npm --version
```


<br>

# Clone the Repository

```bash
git clone https://github.com/LaraKraemer/transcendence.git

cd transcendence
```

<br>

# Node Version Setup

This project uses Node.js 22.
Install and use the correct version with `nvm`.

https://github.com/nvm-sh/nvm

Then:
```bash
nvm install
nvm use 
```

The repository contains an `.nvmrc` file specifying the required Node version.


<br>

# Project Structure

```
transcendence/

├── frontend/              # Next.js frontend application
│
├── backend/               # TypeScript backend service
│
├── docker-compose.yml     # Container orchestration
├── Makefile               # Development commands
└── README.md
```

<br>

# Environment Setup

Create your local environment file:

```bash
touch .env
```

The project does not require database configuration yet.

<br>

# Start the Application

### Build Docker Containers

```bash
make build
```

### Start Development Environment

```bash
make up
```

### Or Two Commands combined in One: 
```bash
make rebuild
```

The application will start:

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:3001 |


<br>

# Docker Commands
### Docker Commands

| Command | Description |
|---|---|
| `make up` | Start containers |
| `make down` | Stop containers |
| `make build` | Rebuild containers |
| `make rebuild` | After changing Dockerfile or dependencies |
| `make restart` | Restart containers |
| `make logs` | View container logs |
| `make clean` | Remove containers and volumes |
| `make prune` | Remove unused images to free storage |
<br>

# Development Workflow

The Docker setup uses volume mounting.

This means source code changes are automatically reflected without rebuilding containers.

### Frontend Changes

Edit:

```
frontend/app/
```

Next.js automatically reloads changes.


### Backend Changes

Edit:

```
backend/srcs/
```

The backend automatically restarts.

<br>

# Running Without Docker

Docker is the recommended development method.
However, both applications can run independently.


### Backend

| Step | Command / Information |
|---|---|
| Navigate | `cd backend` |
| Install dependencies | `npm install` |
| Start development server | `npm run dev` |
| Backend URL | `http://localhost:3001` |


### Frontend

| Step | Command / Information |
|---|---|
| Navigate | `cd frontend` |
| Install dependencies | `npm install` |
| Start development server | `npm run dev` |
| Frontend URL | `http://localhost:3000` |


<br>

# Troubleshooting

### Port Already In Use

Check running containers:

```bash
docker ps
```

Stop containers:

```bash
make down
```

### Dependency Changes

If `package.json` changes:

Rebuild containers:

```bash
make rebuild
```

Uninstall dependencies:
```bash
cd backend 
rm -rf node_modules package-lock.json
npm install
```

---

### Complete Docker Reset

If Docker behaves unexpectedly:

```bash
make clean
make rebuild
```

---

# Git Workflow

Update your branch:

```bash
git fetch origin
git pull
```

Create a feature branch:

```bash
git checkout -b feature/<feature-name>
```

Commit changes:

```bash
git add .

git commit -m "Describe your change"
```

Push:

```bash
git push origin feature/<feature-name>
```

Create Pull Request on GitHub.

---

# Current Project Status

### Completed

- [x] Simple Next.js frontend setup
- [x] Simple TypeScript backend setup
- [x] Docker development environment
- [x] Makefile development commands

### Planned (List is work in progress)

- [ ] PostgreSQL integration
- [ ] Database schema
- [ ] Authentication
- [ ] Expense management
- [ ] File upload management
- [ ] Advanced search and filtering
- [ ] Custom design system
- [ ] Prometheus monitoring
- [ ] Grafana dashboards

---

# Team Notes

The goal of this setup is to provide a simple and consistent development environment.

New team members should be able to:

1. Clone the repository
2. Run `nvm use`
3. Run `make build`
4. Run `make up`
5. Start developing