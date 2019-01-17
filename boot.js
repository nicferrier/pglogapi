// Copyright (C) 2018 by Nic Ferrier, ferrier.nic@gmail.com

const pgBoot = require('keepie').pgBoot;
const path = require("path");
const multer = require("multer");
const bodyParser = require('body-parser');
const fs = require("fs");
const SSE = require("sse-node");
const remoteAddr = require("./remoteaddr.js");
const express = require("express");
const basicAuth = require("express-basic-auth");
const keepieSend = require("./keepie-send.js");
const crypto = require("crypto"); // for gen password

// Config
const options = {
    webApp: true,
};

const dbConfig = {};
const dbEventNotificationLogging = false;
const dbSQLLogging = false;

const readOnlyUsers = { users: {
    "readonly": "secret",
    "log": "reallysecret"
} };
const writeUsers = { users: {"log": "reallysecret"} };

// Stores keepie requests for our API
const keepieRequests = {
    "readonly": [],
    "write": []
};

process.on("SIGINT", exitCode => {
    console.log("pglogapi has SIGINT, exiting");
    dbConfig.pgProcess.kill("SIGINT"); // fixme? could we promise.resolve this to catch errors?
    process.exit();
});


// Listen for the dbUp event to receive the connection pool
pgBoot.events.on("dbUp", async dbDetails => {
    const { pgPool, psql, pgProcess } = dbDetails;

    // when we get the pool make a query method available
    dbConfig.query = async function (sql, parameters) {
        const client = await pgPool.connect();
        try {
            if (dbSQLLogging) {
                console.log("SQL", sql, "parameters?", parameters);
            }
            const result = await client.query(sql, parameters);
            return result;
        }
        catch (e) {
            return {
                dberror: e
            };
        }
        finally {
            client.release();
            if (dbSQLLogging) {
                console.log(`client for '${sql}' released`);
            }
        }
    };

    dbConfig.fileQuery = async function (filename, parameters) {
        const sqlPath = path.join(__dirname, "sqls", filename);
        const sql = await fs.promises.readFile(sqlPath);
        if (dbSQLLogging) {
            console.log(filename, "SQL", sql, "parameters?", parameters);
        }
        return dbConfig.query(sql, parameters);
    };

    dbConfig.psqlSpawn = psql;
    dbConfig.pgProcess = pgProcess;

    dbConfig.pgPool = pgPool;
    dbConfig.on = async function (event, handler, query) {
        const eventClient
              = dbConfig._eventClient === undefined
              ? await pgPool.connect()
              : dbConfig._eventClient;
        eventClient.on(event, handler);
        if (dbEventNotificationLogging) {
            console.log("event handling", event, query);
        }
        if (query !== undefined) {
            const rs = await eventClient.query(query);
            if (dbEventNotificationLogging) {
                console.log("event query results", rs);
            }
        }
        eventClient.release();
    };
});




// Store the listener for passing on to other things - eg: tests
let listener = undefined;

async function getKeepieROData() {
    try {
        const roFile = dbConfig.keepieAuthorizedForReadOnlyFile;
        const [readError, roData] = await fs.promises.readFile(roFile)
              .catch(err => [err])
                  .then(roData => [undefined, roData]);
        return [undefined, JSON.parse(roData)];
    }
    catch (e) {
        return [e];
    }
}

async function getKeepieWData() {
    try {
        const wFile = dbConfig.keepieAuthorizedForWriteFile;
        const [readError, wData] = await fs.promises.readFile(wFile)
              .catch(err => [err])
                  .then(wData => [undefined, wData]);
        return [undefined, JSON.parse(wData)];
    }
    catch (e) {
        return [e];
    }
}

pgBoot.events.on("dbPostInit", async () => {
    const addr = listener.address();
    const host = addr.address == "::" && addr.family == "IPv6" ? "localhost" : addr.address;
    console.log(`pgboot webapp: http://${host}:${addr.port}/status`);

    // Now setup the db object EVEN more - to have the schema data on it and the keepie interval
    dbConfig.schemaStruct = {tables: ["1"]};
    async function schemaCollector(timerEvt) {
        const tablesRs = await dbConfig.fileQuery("schema-query.sql");
        // console.log("tablesRS", tablesRs);
        dbConfig.schemaStruct.tables = tablesRs.rows;
    }
    await schemaCollector();
    dbConfig.schemaCollectorInterval = setInterval(schemaCollector, 60 * 1000);

    // API Keepie processor
    dbConfig.keepieInterval = setInterval(async timerEvt => {
        // console.log("running keepie interval", keepieRequests);
        try {
            const roUsername = Object.keys(readOnlyUsers.users)[0];
            const roPassword = readOnlyUsers.users[roUsername];
            // todo - switch this to getKeepieROData()
            const roFile = dbConfig.keepieAuthorizedForReadOnlyFile;
            await keepieSend.process(roUsername, roPassword, roFile, keepieRequests.readonly);
        }
        catch (e) {
            console.log("API keepie interval readonly process failed", e);
        }
        
        try {
            const wUsername = Object.keys(writeUsers.users)[0];
            const wPassword = writeUsers.users[wUsername];
            const wFile = dbConfig.keepieAuthorizedForWriteFile;
            await keepieSend.process(wUsername, wPassword, wFile, keepieRequests.write);
        }
        catch (e) {
            console.log("API keepie interval write process failed", e);
        }
    }, dbConfig.keepieTime);

    dbConfig.close = async function () {
        clearInterval(dbConfig.schemaCollectorInterval);
        clearInterval(dbConfig.keepieInterval);
        await dbConfig.pgPool.end();
        const exitCode = await new Promise((resolve, reject) => {
            dbConfig.pgProcess.on("exit", resolve);
            dbConfig.pgProcess.kill(process.SIGTERM);
        });
        return exitCode;
    }
    
    pgBoot.events.emit("up", [listener, dbConfig]);
});

pgBoot.events.on("sqlFile", file => {
    console.log("initializing with", file);
});

async function listOfSqlDirs(sqlDir) {
    const sqlPath = path.normalize(sqlDir);
    const localSqlPath = path.normalize(path.join(process.cwd(), "/sql-scripts"));
    if (localSqlPath == sqlPath) {
        return sqlDir;
    }
    else {
        const isLocalDir = await fs.promises.access(localSqlPath, fs.constants.R_OK);
        if (isLocalDir) {
            const list = [sqlDir, localSqlPath];
            console.log(`initializing sql from: ${list}`);
            return list;
        }
        else {
            return sqlDir;
        }
    }
};


// Main
exports.main = async function (listenPort=0, options={}) {
    if (typeof(listenPort) == "object") {
        options = Object.assign(options, listenPort);
        listenPort = 0;
    }

    const {
        prefix = "db",
        dbDir = path.join(process.cwd(), "dbfiles"),
        keepieAuthorizedForReadOnlyEnvVar = "PGLOGAPI_KEEPIE_READONLY",
        keepieAuthorizedForReadOnlyFile = path.resolve(
            process.env[keepieAuthorizedForReadOnlyEnvVar] === undefined
                ? path.join(process.cwd(), "authorized-urls-readonly.json")
                : process.env[keepieAuthorizedForReadOnlyEnvVar]),
        keepieAuthorizedForWriteEnvVar = "PGLOGAPI_KEEPIE_WRITE",
        keepieAuthorizedForWriteFile = path.resolve(
            process.env[keepieAuthorizedForWriteEnvVar] === undefined
                ? path.join(process.cwd(), "authorized-urls-write.json")
                : process.env[keepieAuthorizedForWriteEnvVar]),
        keepieTime = 10 * 1000
    } = options != undefined ? options : {};

    const sqlDirs = await listOfSqlDirs(path.join(__dirname, "sql-scripts"));
    const [app, listenerObject] = await pgBoot.boot(listenPort, {
        dbDir: dbDir,
        sqlScriptsDir: sqlDirs,
        pgPoolConfig: {
            max: 3,
            idleTimeoutMillis: 10 * 1000,
            connectionTimeoutMillis: 5 * 1000
        },

        listenerCallback: function (listenerAddress, listenerService) {
            // set the global listener
            listener = listenerService;
        },

        appCallback: function (app) {
            app.set('json spaces', 4);

            // Dummy query function until we have a db up
            app.db = {
                query: async function (sql, parameters) {
                    if (dbConfig.query !== undefined) {
                        return dbConfig.query(sql, parameters);
                    }
                    throw new Error("no db connection yet");
                },

                fileQuery: async function (filename, parameters) {
                    if (dbConfig.query !== undefined) {
                        return dbConfig.fileQuery(filename, parameters);
                    }
                    throw new Error("no db connection yet");
                },

                on: async function (event, handler, query) {
                    if (dbConfig.query !== undefined) {
                        return dbConfig.on(event, handler, query);
                    }
                    throw new Error("no db connection yet");
                }
            };

            // The read only auth middleware
            dbConfig.keepieAuthorizedForReadOnlyFile = keepieAuthorizedForReadOnlyFile;
            dbConfig.keepieAuthorizedForWriteFile = keepieAuthorizedForWriteFile;
            dbConfig.keepieTime = keepieTime;

            const readOnlyAuth = basicAuth(readOnlyUsers);
            const writeAuth = basicAuth(writeUsers);

            // Keepie advertising middleware
            const address = listener.address();
            const listenerHost = address.address;
            const hostName = listenerHost == "::" ? "localhost" : listenerHost;
            const keepieUrl = `http://${hostName}:${address.port}/keepie/write/request`;
            console.log("keepieUrl", keepieUrl);
            const writeKeepieHeaderMiddleware = function (req, res, next) {
                console.log("setting keepie location", keepieUrl, req.method, req.path, req.headers);
                res.set("x-keepie-location", keepieUrl);
                next();
            };
            dbConfig.keepieAdvertMiddleware = writeKeepieHeaderMiddleware; 

            app.get("/status", async function (req, res) {
                console.log(new Date(), "status called");
                const [roJsonError, roJson] = await getKeepieROData();
                const [wJsonError, wJson] = await getKeepieWData();
                res.json({
                    up: true,
                    keepieUrl: `http://${hostName}:${address.port}/keepie/write/request`,
                    keepieReadOnlyAuthorizedUrls: roJson,
                    keepieWriteAuthorizedUrls: wJson,
                    schema: dbConfig.schemaStruct,
                    meta: {
                        up: "whether this server is considered up or not.",
                        keepieUrl: "the url the server listens to keepie-protocol requests for the current authentication token.",
                        keepieReadOnlyAuthorizedUrls: "the current list of authorized keepie endpoints for the readonly token.",
                        keepieWriteAuthorizedUrls: "the current list of authorized keepie endpoints for the write access token.",
                        //keepieAuthorizedUrlsFileReadErrors: "errors that may have occurred reading the authorized token files",
                        schema: "a description of the tables in the log database."
                    }
                });
            });

            // Keepie for the internal secrets

            app.post("/keepie/:service(readonly|write)/request", function (req, res) {
                let { service } = req.params;
                let receiptUrl = req.get("x-receipt-url");
                if (service !== undefined && receiptUrl !== undefined) {
                    console.log("received request to send", service, "to", receiptUrl);
                    try {
                        keepieRequests[service].push(service, receiptUrl);
                    }
                    catch (e) {
                        console.log("keepie request for non-existant service:", service);
                    }
                    res.sendStatus(204);
                    return;
                }
                console.log(`keepie ${service} was bad`, receiptUrl, req.headers);
                res.sendStatus(400);
            });


            // Stream handling
            
            const connections = {};

            app.db.on("notification", eventData => {
                // console.log("notitication recieved", eventData);
                const { processId, channel, payload } = eventData;
                Object.keys(connections).forEach(connectionKey => {
                    const connection = connections[connectionKey];
                    connection.send(payload, channel);
                });
            }, "LISTEN log;");


            app.get(`/${prefix}/stream`, writeKeepieHeaderMiddleware, readOnlyAuth, function (req, response) {
                const remoteIp = remoteAddr.get(req);
                console.log("wiring up comms from", remoteIp);
                const connection = SSE(req, response, {ping: 10*1000});
                connection.onClose(closeEvt => {
                    console.log("sse closed");
                    delete connections[remoteIp];
                });
                connections[remoteIp] = connection;
                connection.send({remote: remoteIp}, "meta");
            });

            app.get(`/${prefix}/part`, writeKeepieHeaderMiddleware, readOnlyAuth, async function (req, res) {
                const tables = await app.db.query(
                    "SELECT tablename FROM pg_tables where schemaname = 'parts';"
                );
                const tableMaxPromises = tables.rows.map(async tablename => {
                    const tableRs = await app.db.query(
                        `SELECT max(d) FROM parts.${tablename.tablename};`
                    );
                    return {[tablename.tablename]: tableRs.rows[0].max};
                });
                const tableMaxs = await Promise.all(tableMaxPromises);
                const result = tableMaxs.reduce((a, o) => Object.assign(a, o), {});
                res.json(result);
            });

            app.get(`/${prefix}/part/:part`, writeKeepieHeaderMiddleware, readOnlyAuth, async function (req,res) {
                const tableName = req.params["part"];
                const tableRs = await app.db.query(`SELECT * FROM parts.${tableName};`);
                res.json(tableRs.rows);
            });

            app.get(`/${prefix}/log/`, writeKeepieHeaderMiddleware, readOnlyAuth, async function (req, res) {
                const tables = await app.db.fileQuery("top-log.sql")
                res.json(tables.rows);
            });

            app.post(`/${prefix}/log`, writeKeepieHeaderMiddleware, writeAuth, function (req, res, next) {
                console.log("after auth, before bodyparser");
                next();
            }, bodyParser.json(), async function (req, res) {
                console.log("pglogapi write");
                try {
                    const jsonToSave = req.body;
                    if (jsonToSave !== undefined) {
                        const rs = await app.db.fileQuery(
                            "insert-status.sql",
                            [JSON.stringify(jsonToSave)]
                        );

                        res.json(rs.rows);
                    }
                }
                catch (e) {
                    console.log("exception", e);
                    res.sendStatus(400);
                    return;
                }
            });

            app.post(`/${prefix}/log/query`, writeKeepieHeaderMiddleware, readOnlyAuth, bodyParser.json(), async function (req, res) {
                try {
                    const {sql} = req.body;
                    console.log("Query SQL", sql);
                    const query = sql !== undefined ?
                          sql
                          : "SELECT * from log WHERE d > now() - interval '20 days'";
                    const rs = await app.db.query(query);
                    res.json(rs.rows);
                }
                catch (e) {
                    console.log("exception", e);
                    res.sendStatus(400);
                    return;
                }
            });
        }
    });
    console.log("after waiting for pgBoot to boot");
    return [app, listenerObject, new Promise((resolve, reject) => {
        pgBoot.events.on("up", ([listener, dbConfig]) => {
            resolve(dbConfig);
        });
    })];
}

exports.events = pgBoot.events;



// Allow the generation of new passwords for actual running
async function genPass() {
    const password = await new Promise((resolve, reject) => {
        crypto.pseudoRandomBytes(128, function(err, raw) {
            if (err) reject(err);
            else resolve(raw.toString("base64"));
        });
    });
    return password;
}

async function genPasswords() {
    readOnlyUsers.users.readonly = await genPass();
    writeUsers.users.log = await genPass();
}

if (require.main === module) {
    const port = process.argv[2];
    genPasswords().then(_ => {
        exports.main(port);
    });
}

// Ends here
