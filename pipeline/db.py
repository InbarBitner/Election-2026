"""Database access for the pipeline.

The Prisma schema in web/prisma/schema.prisma is the single source of truth for
the data model, so nothing here re-declares it: the tables are reflected at
runtime. Adding a column to the Prisma schema and running `prisma db push` is
enough for the pipeline to see it.

One compatibility detail matters: Prisma's SQLite connector stores DateTime
values as integer milliseconds since the epoch, not as ISO strings. Every write
of a date column therefore goes through `to_db_datetime`.
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import BigInteger, MetaData, Table, create_engine, delete, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.types import DateTime

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "data" / "election.db"


def database_url() -> str:
    """Resolve DATABASE_URL the same way Prisma does, for a shared database."""
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        return f"sqlite:///{DEFAULT_DB_PATH}"
    if raw.startswith("file:"):
        # Prisma resolves relative file: URLs against the schema directory.
        path = raw[len("file:") :]
        if not os.path.isabs(path):
            path = os.path.normpath(REPO_ROOT / "web" / "prisma" / path)
        return f"sqlite:///{path}"
    if raw.startswith("sqlite:"):
        return raw
    # postgres:// etc. are passed through untouched, for the cloud warehouse.
    return raw.replace("postgres://", "postgresql://", 1)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    engine = create_engine(database_url(), future=True)

    if engine.dialect.name == "sqlite":
        # SQLite ignores foreign keys unless asked not to, which would leave
        # orphaned child rows behind every delete. Prisma enables this on its
        # own connections; the pipeline has to do the same or the two halves of
        # the application disagree about what a cascade means.
        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def is_sqlite() -> bool:
    return get_engine().dialect.name == "sqlite"


@lru_cache(maxsize=1)
def get_metadata() -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=get_engine())
    if not metadata.tables:
        raise RuntimeError(
            "The database has no tables. Run `cd web && npx prisma db push` first."
        )

    if is_sqlite():
        # Prisma declares these columns DATETIME but stores integer
        # milliseconds in them. Reflection sees the declared type and would
        # reject ints, so the columns are retyped to match what is actually
        # stored. On Postgres, Prisma uses real timestamps and this is skipped.
        for reflected in metadata.tables.values():
            for column in reflected.columns:
                if isinstance(column.type, DateTime):
                    column.type = BigInteger()

    return metadata


def table(name: str) -> Table:
    metadata = get_metadata()
    if name not in metadata.tables:
        raise KeyError(
            f"Table {name!r} is missing. Run `cd web && npx prisma db push` "
            f"after changing the Prisma schema."
        )
    return metadata.tables[name]


def to_db_datetime(value: datetime | date | str) -> int | datetime:
    """Convert a date to whatever form the Prisma client reads back.

    SQLite: integer milliseconds since the epoch. Postgres: a real timestamp.
    """
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    else:
        moment = datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000) if is_sqlite() else moment


def from_db_datetime(value) -> datetime | None:
    """Inverse of `to_db_datetime`, for reading rows back."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)


def now_ms() -> int | datetime:
    return to_db_datetime(datetime.now(timezone.utc))


def upsert(connection, table_name: str, rows: list[dict], key: list[str]) -> int:
    """Insert or update rows, keyed on a natural key.

    Written with plain select/insert/update rather than a dialect-specific
    ``ON CONFLICT`` so the same code runs against SQLite and Postgres. Volumes
    here are in the thousands, so the extra round-trips are not a concern.

    Returns the number of rows written.
    """
    target = table(table_name)
    written = 0
    for row in rows:
        conditions = [target.c[column] == row[column] for column in key]
        existing = connection.execute(select(target).where(*conditions)).first()
        if existing is None:
            connection.execute(target.insert().values(**row))
        else:
            changes = {k: v for k, v in row.items() if k not in key}
            if changes:
                connection.execute(target.update().where(*conditions).values(**changes))
        written += 1
    return written


def delete_where(connection, table_name: str, **conditions) -> None:
    target = table(table_name)
    clauses = [target.c[column] == value for column, value in conditions.items()]
    connection.execute(delete(target).where(*clauses))


_SLUG_STRIP = re.compile(r"[^\w֐-׿-]+")


def slugify(value: str) -> str:
    """Slug that keeps Hebrew letters — used for deterministic generated ids."""
    return _SLUG_STRIP.sub("-", value.strip()).strip("-").lower()
