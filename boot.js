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

const readOnlyUsers = { users: {"readonly": "secret"} };
const writeUsers = { users: {"log": "reallysecret"} };

// Stores keepie requests for our API
const keepieRequests = [];

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

    dbConfig.schemaStruct = {tables: ["1"]};
    async function schemaCollector(timerEvt) {
        const tablesRs = await dbConfig.fileQuery("schema-query.sql");
        // console.log("tablesRS", tablesRs);
        dbConfig.schemaStruct.tables = tablesRs.rows;
    }
    await schemaCollector();
    dbConfig.schemaCollectorInterval = setInterval(schemaCollector, 60 * 1000);

    // API Keepie processor
    dbConfig.keepieInterval = setInterval(timerEvt => {
        try {
            const roUsername = Object.keys(readOnlyUsers.users)[0];
            const roPassword = readOnlyUsers.users[roUsername];
            const roAuthorizedUrlsFilename = path.join(__dirname, "authorized-urls-readonly.json");
            keepieSend.process(roUsername, roPassword,
                               roAuthorizedUrlsFilename,
                               keepieRequests);
        }
        catch (e) {
            console.log("API keepie interval readonly process failed", e);
        }
        
        try {
            const wUsername = Object.keys(writeUsers.users)[0];
            const wPassword = writeUsers.users[wUsername];
            const wAuthorizedUrlsFilename = path.join(__dirname, "authorized-urls-write.json");
            keepieSend.process(wUsername, wPassword,
                               wAuthorizedUrlsFilename,
                               keepieRequests);
        }
        catch (e) {
            console.log("API keepie interval write process failed", e);
        }
    }, 10 * 1000);

    // I think this should fire before the one in dbPostInit... but it doesn't.
    pgBoot.events.emit("up", [listener, dbConfig]);
});


// Store the listener for passing on to other things - eg: tests
let listener = undefined;

pgBoot.events.on("dbPostInit", () => {
    // this seems to fire after the one at the end of dbUp - just because that takes a while?
    //   pgBoot.events.emit("up", [listener, dbConfig]);
    console.log("pgboot webapp listening on ", listener.address().port);
});

// Main
exports.main = function (listenPort) {
    return pgBoot.boot(listenPort, {
        dbDir: path.join(__dirname, "dbfiles"),
        sqlScriptsDir: path.join(__dirname, "sql-scripts"),
        pgPoolConfig: {
            max: 3,
            idleTimeoutMillis: 10 * 1000,
            connectionTimeoutMillis: 5 * 1000
        },

        listenerCallback: function (listenerAddress, listenerService) {
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

            // psqlweb if we want it
            if (options.webApp) {
                try {
                    const auth = require("simple-auth-4-express");
                    const psqlWebApp = require("psql-web-app");
                    psqlWebApp.init(app, {
                        middleware: auth.middleware(function (username, password) {
                            return true;
                        })
                    });
                }
                catch (e) {
                    console.error("pgboot webapp problem? just requires?", e.message);
                }
            }
            // end psqlweb

            // The read only auth middleware
            const readOnlyAuth = basicAuth(readOnlyUsers);
            const writeAuth = basicAuth(writeUsers);

            app.get("/status", readOnlyAuth, async function (req, res) {
                res.json({
                    up: true,
                    schema: dbConfig.schemaStruct
                });
            });

            // Keepie for the internal secrets

            app.post("/keepie/:service([A-Za-z0-9_-]+)/request", function (req, res) {
                let { service } = req.params;
                let receiptUrl = req.get("x-receipt-url");
                if (service !== undefined && receiptUrl !== undefined) {
                    console.log("received request to send", service, "to", receiptUrl);
                    keepieRequests.push(service, receiptUrl);
                    response.sendStatus(204);
                    return;
                }
                response.sendStatus(400);
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
    
            app.get("/db/stream", readOnlyAuth, function (req, response) {
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

            app.get("/db/part", readOnlyAuth, async function (req, res) {
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

            app.get("/db/part/:part", readOnlyAuth, async function (req,res) {
                const tableName = req.params["part"];
                const tableRs = await app.db.query(`SELECT * FROM parts.${tableName};`);
                res.json(tableRs.rows);
            });

            app.get("/db/log/", readOnlyAuth, async function (req, res) {
                const tables = await app.db.fileQuery("top-log.sql")
                res.json(tables.rows);
            });

            app.post("/db/log", writeAuth, bodyParser.json(), async function (req, res) {
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

            app.post("/db/log/query", readOnlyAuth, bodyParser.json(), async function (req, res) {
                try {
                    const jsonQuery = req.body;
                    if (jsonQuery !== undefined) {
                        const rs = await app.db.query(
                            "SELECT * from log WHERE d > now() - interval '20 days'",
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
        }
    });
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
