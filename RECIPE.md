# Recipe: the postgres kit

## What it answers

Questions about one PostgreSQL database: where something is stored (tables, columns), what a table
looks like, row counts, what a row says, how big tables and indexes are, why a query is slow
(EXPLAIN, pg_stat_statements, missing index) and what is running or locked now. It also acts: any SQL
the connection's role may run (writes, DDL, CREATE INDEX, VACUUM, ANALYZE, pg_terminate_backend).

## Needs

- `psql` on the PATH (any version 12 or later; `--csv` is used).
- `DATABASE_URL` (`postgres://user:password@host:port/db`) in the environment or in ask-kit's config
  at `domains.postgres.settings.DATABASE_URL`; else libpq's `PG*` variables and `~/.pgpass`.
- ask-kit with kit support (`min_ask_kit = "0.2.0"`).

## Reads and runs

Runs `psql` as a child process with `PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD` set from the URL
(password never in argv), `-X` (no psqlrc) and `-v ON_ERROR_STOP=1`. Reads the system catalogs
(`pg_class`, `pg_attribute`, `pg_index`, `pg_stat_activity`, `pg_locks`, `pg_stat_statements`).
Writes whatever the model's SQL says. No read-only transaction is imposed. Nothing is written to disk.

## Brief to rebuild it from an empty folder

Make a kit folder with `ask-kit.toml` (id `temet.postgres`, name `postgres`, `says` listing what it
answers and that it acts, `keywords`, `route_hint`, `cite`, `acts`, a `[[settings]]` for
`DATABASE_URL` with `secret = true`, one `[[sources]]` of kind `module`, name `pg`, module `pg.mjs`,
api `api.d.ts`), and `instructions.md`, `scripts/`, `bench/questions.json`.

1. `pg.mjs` exports `make({settings, push})` returning the `pg` global. Split the URL with `new URL`
   into PG* env vars for `execFile("psql", ["-X","-v","ON_ERROR_STOP=1", ...])`; remove
   `DATABASE_URL` from the child env; scrub the password and URL from every error; expose only
   `pg.target = "user@host:port/db"`.
   - `sql(query, {max=200, timeoutMs})`: `--csv -P null=<sentinel> -c query`, parse RFC 4180 CSV
     (quotes, embedded newlines, doubled quotes), map to objects (integers up to 15 digits to
     numbers, sentinel to null), return `{columns, rows, total, complete}`; a bare command tag
     (`UPDATE 3`) comes back as `{tag}`. Set `PGOPTIONS=-c statement_timeout=...`.
   - `exec(statements)`: feed the string to `psql -f -` so each statement runs on its own (VACUUM and
     CREATE INDEX CONCURRENTLY work); return psql's command tags.
   - `explain(query, {analyze})`: `EXPLAIN (ANALYZE, BUFFERS) ...` as text.
   - `info()`, `lit()` (string literal escape), `ident()` (identifier quote).
2. `api.d.ts` declares `pg` and `scripts`, saying it is not read-only, that rows are capped, and that
   values go through `pg.lit`.
3. Scripts (`export const meta = {purpose, params, returns, example}` and
   `export default async function ({ pg }, params)`), all through `pg.sql` over the catalogs:
   `tables` (pg_class + pg_stat_all_tables, filter by words, size and row estimate), `describe`
   (pg_attribute, pg_constraint, pg_index + pg_stat_all_indexes, optional sample),
   `find-column` (pg_attribute names matching words, exact first), `activity` (pg_stat_activity,
   pg_blocking_pids, ungranted pg_locks, connections vs max_connections), `slow` (pg_stat_statements
   with 13+ / older column names, a clear message when absent), `size` (database, schema, table and
   index sizes, unused indexes).
4. `instructions.md`: prefer scripts; never guess `schema.table`; estimates versus exact counts and
   no unfiltered count(*) on huge tables; aggregate in SQL; `pg.lit` for values; EXPLAIN reading
   guide; act only when asked and report the command tag; never reveal the URL; cite SQL and ids.
5. `bench/questions.json`: questions of the kinds agents answer by hand with psql, written against
   PostgreSQL's catalogs so they hold on any database, with patterns that check the shape of an
   answer. Add questions about your own tables and run `ask-kit kit test postgres` once, on the
   backend the kit will use.

## Results

The bench has not been run on a model since it was made generic.
