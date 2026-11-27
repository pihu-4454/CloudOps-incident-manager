# CloudOps Incident Manager

[![CI](https://github.com/pihu-4454/CloudOps-incident-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/pihu-4454/CloudOps-incident-manager/actions/workflows/ci.yml)

A full-stack incident management platform for creating, updating and tracking incidents from one central interface. It has an interactive web frontend, a FastAPI backend with a PostgreSQL database, and runs as a Docker Compose stack. Every push is tested automatically in a GitHub Actions pipeline.

## Features

- Create, view, update and delete incidents through a web interface
- Incident severity (`CRITICAL`, `HIGH`, `WARNING`) and lifecycle status (`INVESTIGATING`, `IDENTIFIED`, `MITIGATING`, `RESOLVED`)
- Server-side `resolved_at` timestamp, set automatically when an incident is resolved
- Input validation with clear error responses (422 for bad input, 404 for unknown incidents)
- Liveness and health endpoints, where the health check verifies database connectivity
- Containerized with Docker Compose, with a PostgreSQL healthcheck gating app startup
- Automated API tests (Postman collection run by Newman) executed in CI

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (served by FastAPI) |
| Backend | Python, FastAPI, SQLAlchemy |
| Database | PostgreSQL 16 |
| Containers | Docker, Docker Compose |
| Testing | Postman collection, Newman |
| CI | GitHub Actions |

## Getting started

### Prerequisites

- Docker Desktop (or Docker Engine with the Compose plugin)

### Run the application

1. Clone the repository:

   ```bash
   git clone https://github.com/pihu-4454/CloudOps-incident-manager.git
   cd CloudOps-incident-manager
   ```

2. Create your environment file from the template:

   ```bash
   cp .env.example .env
   ```

   Then set the PostgreSQL values in `.env`:

   ```dotenv
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=change-me
   POSTGRES_DB=cloudops_incidents
   ```

3. Build and start the stack:

   ```bash
   docker compose up -d --build
   ```

4. Open the app:

   - Web interface: http://localhost:8000
   - Interactive API docs (Swagger): http://localhost:8000/docs

To stop the stack, run `docker compose down`. Add `-v` to also delete the database volume.

## API reference

All routes are under the `/api` prefix.

| Method | Path | Description | Success |
|---|---|---|---|
| GET | `/api/live` | Liveness check (does not touch the database) | 200 |
| GET | `/api/health` | Health check, verifies the database connection | 200 (503 if the database is down) |
| GET | `/api/incidents` | List all incidents, newest first | 200 |
| POST | `/api/incidents` | Create an incident | 201 |
| GET | `/api/incidents/{id}` | Get one incident | 200 (404 if not found) |
| PUT | `/api/incidents/{id}` | Update one or more fields of an incident | 200 (404 if not found) |
| DELETE | `/api/incidents/{id}` | Delete an incident | 204 (404 if not found) |

Example request:

```bash
curl -X POST http://localhost:8000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database connection timeout",
    "description": "API unable to reach PostgreSQL",
    "severity": "HIGH",
    "service": "payments-api",
    "status": "INVESTIGATING"
  }'
```

## Monitoring and troubleshooting

Check container status and health:

```bash
docker compose ps
```

Follow application and database logs:

```bash
docker compose logs -f app
docker compose logs -f db
```

Check the API directly:

```bash
curl http://localhost:8000/api/live
curl http://localhost:8000/api/health
```

## Testing

The API test suite lives in `tests/postman/`. It has 10 requests and 20 assertions covering the health check, the full create/read/update/delete lifecycle, and negative cases (missing fields, invalid severity, unknown incident IDs).

With the stack running, execute it with [Newman](https://github.com/postmanlabs/newman):

```bash
npm install -g newman
newman run tests/postman/incident-api.postman_collection.json \
  -e tests/postman/local.postman_environment.json
```

Newman exits with a non-zero code if any assertion fails.

## CI pipeline

The workflow in `.github/workflows/ci.yml` runs on every push and pull request to `main`:

1. Checks out the code and creates a CI-only `.env`
2. Builds and starts the Docker Compose stack
3. Waits for the `/api/health` endpoint to respond
4. Runs the Newman collection and fails the build on any failed assertion
5. Uploads the JUnit test report, prints container logs on failure, and tears the stack down

## Project structure

```
.
├── backend/
│   ├── main.py            # FastAPI application and routes
│   └── schema.sql         # Database schema, applied on startup
├── frontend/              # Web interface (index.html, app.js, style.css)
├── tests/postman/         # Postman collection and environment for Newman
├── .github/workflows/     # CI pipeline
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## Roadmap

- [ ] Docker healthcheck for the application container
- [ ] Publish the Docker image to GitHub Container Registry from CI
- [ ] Deploy to AWS (EC2 with Docker Compose, then ECS/Fargate with RDS)
- [ ] Ship logs to CloudWatch
