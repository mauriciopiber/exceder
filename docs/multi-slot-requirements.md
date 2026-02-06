# Multi-Slot Project Requirements

Requirements for a project to support parallel development slots with isolated databases and ports.

## Required Files

### 1. `.env` (gitignored)

Contains runtime configuration with these variables:

```bash
COMPOSE_PROJECT_NAME=project-name    # Used for container naming
DATABASE_URL="postgresql://user:pass@localhost:PORT/db"
PORT=4200                            # App port
POSTGRES_PORT=4232                   # Database port
```

### 2. `.env.example` (committed)

Template showing required variables (without real values):

```bash
COMPOSE_PROJECT_NAME=project-name
DATABASE_URL="postgresql://user:pass@localhost:PORT/db"
PORT=4200
POSTGRES_PORT=4232
```

### 3. `docker-compose.yml` (committed)

Must use dynamic container names:

```yaml
services:
  postgres:
    image: postgres:17
    container_name: ${COMPOSE_PROJECT_NAME:-project-name}-db  # Dynamic!
    environment:
      POSTGRES_USER: myuser
      POSTGRES_PASSWORD: mypassword
      POSTGRES_DB: mydb
    ports:
      - "${POSTGRES_PORT:-5432}:5432"  # Use env var for port
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 4. `.gitignore`

Must include:

```
.env
.env.local
```

## How slot-cli Works

When you run `slot-cli new 1`:

1. **Creates worktree**: `git worktree add ../project-1 -b slot-1`

2. **Copies gitignored files**: Copies `.env`, `.env.local`, etc from main

3. **Scans ports**: Reads all `.env*` files to find PORT-related variables

4. **Allocates slot ports**: Adds slot number to each port
   - PORT: 4200 → 4201
   - POSTGRES_PORT: 4232 → 4233

5. **Checks availability**: Uses `net.Listen` to verify port is free

6. **Updates slot files**:
   - Adds/updates `COMPOSE_PROJECT_NAME` in `.env` files
   - Replaces all port references
   - Updates `container_name` in `docker-compose.yml`

7. **Starts docker**: `docker compose --env-file .env up -d`

8. **Clones database**: `pg_dump | psql` from main to slot

## Port Allocation Strategy

```
Slot N gets: base_port + N

Main:    PORT=4200, POSTGRES_PORT=4232
Slot 1:  PORT=4201, POSTGRES_PORT=4233
Slot 2:  PORT=4202, POSTGRES_PORT=4234
```

If a port is in use, slot-cli increments until it finds an available one.

## Container Naming

```
Main:    tracker-db
Slot 1:  tracker-1-db
Slot 2:  tracker-2-db
```

Uses `${COMPOSE_PROJECT_NAME}-db` pattern.

## Volume Isolation

Docker Compose prefixes volumes with COMPOSE_PROJECT_NAME:

```
Main:    tracker_postgres_data
Slot 1:  tracker-1_postgres_data
Slot 2:  tracker-2_postgres_data
```

Each slot has its own isolated database volume.

## Checklist for New Projects

- [ ] `.env` is gitignored
- [ ] `.env` has `COMPOSE_PROJECT_NAME`, `PORT`, `POSTGRES_PORT`
- [ ] `docker-compose.yml` uses `${COMPOSE_PROJECT_NAME:-name}-db` for container_name
- [ ] `docker-compose.yml` uses `${POSTGRES_PORT:-5432}:5432` for ports
- [ ] All `localhost:PORT` references in `.env` files use variables

## Usage

```bash
# From main project directory
slot-cli new 1        # Create slot 1
slot-cli new          # Auto-increment (creates slot 2 if 1 exists)
slot-cli delete 1     # Delete slot 1
slot-cli list         # Show running Claude instances
```

From inside a slot:
```bash
slot-cli start        # Start Claude
slot-cli continue     # Continue Claude session
```
