# Easy Start PG Backend for Making Mistakes

This is a simple API on top of PG.

The API allows you to:

* post JSON in to a partitioned log
* stream data out of the log (as it's POSTed in) as SSE


## Why is it for Making Mistakes?

Databases should belong to only one microservice. But that's a rule
everyone wants to break. This will make it even easier to do that.

Hey ho.

Maybe we should just play with things more.

But dangerous weapons can also be super tools.


### Can I avoid mistakes?

Probably not. But if you:

* ensure that all data modification goes via inserts in the log
* build trigger based scripts to normalize the data in the log
* build API query views on the normalized data

you might be getting there.


## What about resilience?

Yeah. It's all coming.


## How does someone authenticate to the API?

There is a builtin keepie for the API.

So a service wishing to access this DB should register in the keepie.

The builtin keepie expects:

`authorized-urls-readonly.json` 

and

`authorized-urls-write.json` 

to be in the current directory.


## Querying

You can POST a SQL query to the server and the results will be
returned.

The query is sent in a JSON structure:

```javascript
http.request({
    method: "POST",
    port: port,
    path: "/db/log/query",
    auth: "readonly:secret",
    headers: {
        "content-type": "application/json"
    }
}).end(JSON.stringify({
    sql: "select data from log order by d desc limit 2;"
}));
```

## Extending

This is built as a kind of template to be heavily extended in one way
or another.

### SQL init

pglogapi requires some SQL init... but if you want to add more in your
project using pglogapi you can simply add a `sql-scripts` directory
with number prefixed sql files.

Like this:

```
20-create-tables.sql
```

the contents of which would be a Postgres create table presumably.

All "user" SQL init will be done *after* pglogapi's core sql init
because this includes the log table and all it's partitions.

### SQL Hooks

Triggers are a useful feature of PostgreSQL but pglogapi also provides
"hooks" which are just like triggers except it's not possible to halt
the execution of other hooks by the return value of a hook.

Hooks work pretty much exactly the same as triggers but are explicitly
passed the row they're operating on.

Here's an example of a hook function and of how the hook is created
and applied to the `log` table:

```sql
CREATE OR REPLACE FUNCTION log_notify_hook(log_record log) RETURNS log AS $log_hook$
begin
   -- notify the user
   PERFORM pg_notify('log', jsonb_set(rec.data::jsonb, '{id}', (rec.id::text)::jsonb, true)::TEXT);
   RETURN log_record;
end;
$log_hook$ LANGUAGE plpgsql;

SELECT create_or_replace_hook('public', 'log', 'log_notify_hook', 'log_notify_hook');
```

### Extending via JS

Of course, more code can be added to the log api service:

```javascript
const mainReturn = pgLogApi.main(8027);
[app, listener, dbConfigPromise] = await mainReturn;

// Now wait for the db to become available
const dbConfig = await dbConfigPromise;

// Now do what you like...
app.post("/myhandler/", async function (req,res) {
  res.sendStatus(204);
});
```

This is one of the best ways to make mistakes, more code please!

### Closing everything from JS

If you're extending the service or testing it you might want to shut
everything down. That looks like this:

```javascript
const mainReturn = pgLogApi.main(8027);
[app, listener, dbConfigPromise] = await mainReturn;
const dbConfig = await dbConfigPromise;

listener.close();
const pgServerReturnCode = await dbConfig.close();
```

`dbConfig.close` is a function that shuts down quite a few things. The
return code is from the operating system process running the
PostgreSQL server though.

### The `main` function

You can pass the frontend port to `main` as well as a list of options:

```javascript
pgLogApi.main(8027, {dbDir: "./postgres-install"});
```

or you can just pass the port:

```javascript
pgLogApi.main(8027);
```

the `dbDir` will be defaulted; you might want multiple dbDirs if you
were running multiple instances for some reason, or perhaps for
testing...

or you can just pass the options:

```javascript
pgLogApi.main({dbDir: "./postgres-install"});
```

in which case the port will be defaulted to 0; when that happens a
default port is allocated by the operating system. That port can be
retrieved from the listener which is returned:

```javascript
const [app, listener,...rest] = await pgLogApi.main({dbDir: "./postgres-install"});
const port = listener.address().port;
```

### What options can I pass to `main`?

The options that you can pass to `main` are:

* `dbDir` 
  * is the location where the postgres files will be stored
* `keepieAuthorizedForReadOnlyEnvVar` 
  * is the name of an environment variable that will specify the keepie read only authorized file
  * by default this is: `PGLOGAPI_KEEPIE_READONLY`
* `keepieAuthorizedForReadOnlyFile` 
  * is the filename of the keepie authorized file for readonly users
  * by default this is either `$PGLOGAPI_KEEPIE_READONLY` or `authorized-urls-readonly.json`
* `keepieAuthorizedForReadOnlyEnvVar` 
  * is the name of an environment variable that will specify the keepie read only authorized file
  * by default this is: `PGLOGAPI_KEEPIE_READONLY`
* `keepieAuthorizedForWriteFile` 
  * is the filename of the keepie authorized file for write users
  * by default this is either `$PGLOGAPI_KEEPIE_WRITE` or `authorized-urls-write.json`

### Keepie customization

The internal keepie allows authorizations to be requested by clients securely.

Keepie authorizes endpoints where it might send a password. These
authorized endpoints need to be specified in files that pglogapi can
read.

You can specify the filename that pglogapi will read for the
authorizations by setting an environment variable (which is itself
configurable) or by passing the actual filename to use in the `main`.

For example:

```javascript
pgLogApi.main({
  dbDir: "./postgres-install",
  keepieAuthorizedForReadOnlyFile: "my-readonly-endpoints.json"
});
```

will cause the internal Keepie to read the authorized endpoints from
`my-readonly-endpoints.json` which is expected to be in the current directory.

Or you could do set the environment variable:

```bash
PGLOGAPI_KEEPIE_READONLY=my-readonly-endpoints.json
```

or, perhaps if you were using multiple pglogapi instances and wanted
different environment variables, you could specify the environment
variable name to use:

```javascript
pgLogApi.main({
  dbDir: "./postgres-install",
  keepieAuthorizedForReadOnlyEnvVar: "MY_ENDPOINTS"
});
```


## Testing

The tests here assert the following:

* the PostgreSQL works 
* the schema contains at least the log table
* the log can be inserted into
* inserts cause an event stream output that can be consumed
* the event stream can be consumed with Basic authentication
* the event streamed output is the same as the one inserted
* the top of the log is what has been inserted
* the necessary partitions are constructed on demand
* the log represents all partitions
* the partitions are date ordered most significant part first
* the last item of data in the most recent partition is the inserted row
* the API keepie sends correctly to a remote
* a generic query can be sent and the results received
* the PostgreSQL can be safely shut down

