# Connect a database

Davis reads Postgres and MySQL tables live, so Pages and answers always show what's in the database now. It only reads.

## Make a read-only user

Davis refuses to write, but a user that can only read keeps the database safe whatever happens. Ask whoever runs the database to create one, or run this as an admin, with your own password and names.

For Postgres:

```sql
CREATE ROLE davis_reader LOGIN PASSWORD '<A_STRONG_PASSWORD>';
GRANT CONNECT ON DATABASE <DATABASE> TO davis_reader;
GRANT USAGE ON SCHEMA public TO davis_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO davis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO davis_reader;
```

The last line lets the user read tables created later too.

For MySQL, which also covers tables created later:

```sql
CREATE USER 'davis_reader'@'%' IDENTIFIED BY '<A_STRONG_PASSWORD>';
GRANT SELECT ON <DATABASE>.* TO 'davis_reader'@'%';
```

## Connect

1. In the sidebar, click **+** next to **Data**, then **Connect a database**.
2. Pick **Postgres** or **MySQL**, enter the host, port, database, user, and password, then click **Test connection**.
3. The first time for each type, Davis asks to download its support, about 45 MB. Click **Download**.
4. Tick the tables you want and click **Add**.

Each table appears under **Data** as `database.table`, and works like a file in charts, Pages, filters, and questions. The password is kept in your system keychain, not in the project folder.

## When something goes wrong

| Davis says | Try |
|---|---|
| The user name or password is wrong | Check them with whoever runs the database |
| The server didn't answer | Check the host and port, that you're online, and that the server accepts connections from your network |
| The server and Davis couldn't agree on SSL | Set **Encryption (SSL)** to **Always** for hosted databases, or **Never** for one on your own computer |
| This database needs its password again | Enter it when Davis asks. This happens on a new computer, or if the keychain entry was removed |

If a database can't be reached when a Page opens, the Page says so at the top with **Try again**, or **Reconnect** if it needs the password. Blocks that use its tables explain why they're empty, and the rest of the Page still works. The AI is told which tables are missing.

Big tables over a slow connection make charts slower, because each one runs on the database.
