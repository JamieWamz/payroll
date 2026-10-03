# Run ZamPayroll locally

## First time only

```sh
nvm use
npm ci
cp .env.example .env
```

## Start the system

Open two terminals in the repository root.

**Terminal 1 — start the database and application**

```sh
npm run db:up
npm run db:migrate
npm run dev
```

Open <http://127.0.0.1:5173> in your browser.

## Check that it is ready

In Terminal 2:

```sh
curl --fail http://127.0.0.1:5173/api/health/ready
```

It is ready when the response includes `"status":"ready"`.

## If port 3000 is already in use

Stop the previous `npm run dev` command, then run this instead:

```sh
PORT=3100 API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev
```

The browser address remains <http://127.0.0.1:5173>.

## Stop the system

Press `Ctrl+C` in the terminal running `npm run dev`, then run:

```sh
npm run db:down
```

This stops PostgreSQL but keeps your local database data.
