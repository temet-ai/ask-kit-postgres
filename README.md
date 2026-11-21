# ask-kit-postgres

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about a PostgreSQL database. A cheap model with `psql` and six ready-made scripts
works outside your agent's context and answers with the SQL it ran.

Kinds of question it is built for, which agents otherwise answer by hand with `psql`:

- Which tables have a column called session_id?
- How big is the orders table on disk, including its indexes?
- Which applications are connected to this database right now, and how many connections does each
  hold?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and `psql` (the PostgreSQL
client) on the PATH.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-postgres
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-postgres        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-postgres --yes  # installs and enables it
```

Then tell it which database, and restart your agents so `ask` lists `postgres`. Until
`DATABASE_URL` is set the kit is not offered, and `ask-kit kit list` says so.

## Settings

| Setting | Default | What it is |
|---|---|---|
| `DATABASE_URL` | none, required | `postgres://user:password@host:5432/dbname` |

Set it in the environment or in ask-kit's config as `domains.postgres.settings.DATABASE_URL`.
libpq's own `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `~/.pgpass` also apply.

The password reaches `psql` in its `PGPASSWORD` environment, never in its arguments. The
investigator's model sees only `user@host:port/database`, and the URL and password are scrubbed
from errors. The setting leaves the investigator's environment once the connection holds it.

## What it can change

Everything the connection's role can do. Asked to, it inserts, updates and deletes rows, creates
indexes, runs `VACUUM` and `ANALYZE`, or terminates a backend, and reports the command tag. It
writes only when the request asks it to. Give it a role whose privileges you are happy to hand to
an agent.

## How well it works

The bench, `bench/questions.json`, holds questions of those kinds that use only PostgreSQL's own
catalogs, so they run against any database, with patterns that check the shape of an answer. It has
not been run against a model. Add questions about your own tables.

## What is in it

`pg.mjs` gives the investigator `psql`. Its scripts:

| Script | Answers |
|---|---|
| `tables` | schemas and tables with row estimates and sizes, filtered by words |
| `describe` | one table: columns, keys, foreign keys both ways, indexes and their use |
| `find-column` | which tables have a column (or name) matching words |
| `activity` | running queries, waits, locks, idle transactions, connections |
| `slow` | `pg_stat_statements` top by total, mean or max time; says so when it is absent |
| `size` | database, schemas, largest tables and indexes, unused indexes |

[RECIPE.md](RECIPE.md) says what it reads and runs, and how to rebuild it.

MIT licence.
