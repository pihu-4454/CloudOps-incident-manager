import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Copy .env.example to .env and set your PostgreSQL credentials."
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

Severity = Literal["CRITICAL", "HIGH", "WARNING"]
IncidentStatus = Literal["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"]


class IncidentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    severity: Severity
    service: str = Field(min_length=1, max_length=80)
    status: IncidentStatus = "INVESTIGATING"


class IncidentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, min_length=1, max_length=500)
    severity: Severity | None = None
    service: str | None = Field(default=None, min_length=1, max_length=80)
    status: IncidentStatus | None = None
    resolved_at: datetime | None = None


class Incident(IncidentCreate):
    id: int
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs once on startup (before `yield`) and once on shutdown (after it)."""
    # creates the incidents table if it does not exist yet
    schema = (PROJECT_ROOT / "backend" / "schema.sql").read_text(encoding="utf-8")
    try:
        with engine.begin() as connection:
            connection.execute(text(schema))
    except SQLAlchemyError as exc:
        raise RuntimeError(
            "Could not connect to PostgreSQL or initialize the schema."
        ) from exc
    yield

    # closes all database connections
    engine.dispose()


app = FastAPI(
    title="CloudOps Incident Manager API",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/api/live")
def liveness_check() -> dict[str, str]:
    """Is the process up? Deliberately does not touch the database."""
    return {"status": "ok"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "connected"}


@app.get("/api/incidents", response_model=list[Incident])
def list_incidents() -> list[dict]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT * FROM incidents ORDER BY id DESC")
        ).mappings().all()
    return [dict(row) for row in rows]


@app.post(
    "/api/incidents",
    response_model=Incident,
    status_code=status.HTTP_201_CREATED,
)
def create_incident(incident: IncidentCreate) -> dict:
    values = incident.model_dump()
    now = datetime.now(timezone.utc)

    with engine.begin() as connection:
        row = connection.execute(
            text("""
                INSERT INTO incidents (
                    title, description, severity, service, status,
                    updated_at, resolved_at
                )
                VALUES (
                    :title, :description, :severity, :service, :status,
                    :updated_at, :resolved_at
                )
                RETURNING *
            """),
            {
                **values,
                "updated_at": now,
                "resolved_at": now if values["status"] == "RESOLVED" else None,
            },
        ).mappings().one()

    return dict(row)


@app.get("/api/incidents/{incident_id}", response_model=Incident)
def get_incident(incident_id: int) -> dict:
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT * FROM incidents WHERE id = :incident_id"),
            {"incident_id": incident_id},
        ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    return dict(row)


@app.put("/api/incidents/{incident_id}", response_model=Incident)
def update_incident(incident_id: int, changes: IncidentUpdate) -> dict:
    values = {
        key: value
        for key, value in changes.model_dump(exclude_unset=True).items()
        if value is not None
    }
    if not values:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update",
        )
    allowed_columns = {"title", "description", "severity", "service", "status"}
    assignments = [
        f"{column} = :{column}"
        for column in values
        if column in allowed_columns
    ]

    values["incident_id"] = incident_id
    values["updated_at"] = datetime.now(timezone.utc)
    assignments.append("updated_at = :updated_at")

    # The server decides resolved_at whenever the status is part of the update
    if "status" in values:
        assignments.append(
            "resolved_at = CASE WHEN :status = 'RESOLVED' "
            "THEN COALESCE(resolved_at, :updated_at) ELSE NULL END"
        )
    with engine.begin() as connection:
        row = connection.execute(
            text(
                f"UPDATE incidents SET {', '.join(assignments)} "
                "WHERE id = :incident_id RETURNING *"
            ),
            values,
        ).mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return dict(row)


@app.delete(
    "/api/incidents/{incident_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_incident(incident_id: int) -> Response:
    with engine.begin() as connection:
        result = connection.execute(
            text("DELETE FROM incidents WHERE id = :incident_id"),
            {"incident_id": incident_id},
        )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Incident not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Serve the existing frontend and API from one origin.
# Keep this LAST: it catches every path that has no matching route above.
app.mount(
    "/",
    StaticFiles(directory=PROJECT_ROOT / "frontend", html=True),
    name="frontend",
)