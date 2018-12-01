// Demo of using pgBoot - a keepie client - to start a server and initialize it
// The sql scripts use to initialze are kept in sql-scripts in this repository
// Copyright (C) 2018 by Nic Ferrier, ferrier.nic@gmail.com

const pgBoot = require('keepie').pgBoot;
const path = require("path");
const multer = require("multer");
const bodyParser = require('body-parser');
const fs = require("fs");
const SSE = require("sse-node");
const remoteAddr = require("./remoteaddr.js");
const express = require("express");

// Config
const options = {
    webApp: true,
    cli: false
};

const dbConfig = {};
const dbEventNotificationLogging = false;

// Listen for the dbUp event to receive the connection pool
pgBoot.events.on("dbUp", async dbDetails => {
    const { pgPool, psql, pgProcess } = dbDetails;

    // when we get the pool make a query method available
    dbConfig.query = async function (sql, parameters) {
        const client = await pgPool.connect();
        try {
            console.log("SQL", sql, parameters);
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
            console.log("client released");
        }
    };

    dbConfig.fileQuery = async function (filename, parameters) {
        const sqlPath = path.join(__dirname, "sqls", filename);
        const sql = await fs.promises.readFile(sqlPath);
        console.log(filename, "SQL", sql, parameters);
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

pgBoot.events.on("dbPostInit", () => {
    pgBoot.events.emit("up", [listener, dbConfig]);
    console.log("pgboot webapp listening on ", listener.address().port);
    if (options.cli) {
        devCli(dbConfig);
    }
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

            app.get("/status", async function (req, res) {
                res.json({
                    up: true
                });
            });

            // Static
            const rootDir = path.join(__dirname, "www");
            app.use("/ric/www", express.static(rootDir));


            // Stream handling
            
            const connections = {};

            app.db.on("notification", eventData => {
                const { processId, channel, payload } = eventData;
                Object.keys(connections).forEach(connectionKey => {
                    const connection = connections[connectionKey];
                    connection.send(payload, channel);
                });
            }, "LISTEN log;");
    
            app.get("/db/stream", function (req, response) {
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

            app.get("/db/", function (req, res) {
                res.sendFile(path.join(__dirname, "www", "index.html"));
            });

            app.post("/db/log", bodyParser.json(), async function (req, res) {
                // Sanity check
                try {
                    const jsonToSave = req.body;
                    if (jsonToSave !== undefined) {
                    }
                    const rs = await app.db.fileQuery("insert-status.sql", [JSON.stringify(filtered)]);
                    console.log(rs);
                }
                catch (e) {
                    console.log("exception", e);
                    res.sendStatus(400);
                    return;
                }
                res.sendStatus(204);
            });
        }
    });
}

exports.events = pgBoot.events;

if (require.main === module) {
    const port = process.argv[2];
    exports.main(port);
}

// Ends here
