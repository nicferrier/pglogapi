const boot = require("./boot.js");
const http = require("http");
const EventSource = require("eventsource");
const testUtils = require("./util-test.js");
const assert = require("assert");

async function test() {
    const [listener, dbConfig] = await new Promise((resolve, reject) => {
        boot.events.on("up", resolve);
        boot.main();
    });

    const port = listener.address().port;
    const results = await dbConfig.query("select * from log;");
    console.log("rows count before", results.rows.length);

    // Test that we can POST and enter something and also get a notification
    const {newLogResult, streamResult} = await new Promise(async (resolve, reject) => {
        const es = new EventSource(`http://localhost:${port}/db/stream`);

        const resultObj = {};
        const pushIt = function (pair) {
            Object.assign(resultObj, pair);
            console.log("pushIt", resultObj, Object.keys(resultObj).length);
            if (Object.keys(resultObj).length == 2) {
                 es.close();
                resolve(resultObj);
            }
        };

        es.addEventListener("log", esEvt => {
            const {type, data:rawData, lastEventId, origin} = esEvt;
            try {
                console.log("stream promise", rawData);
                const data = JSON.parse(rawData);
                pushIt({streamResult: data});
            }
            catch (e) {
                console.log("test.js - error parsing JSON from log event:", e);
            }
        });
            
        const newLogResult = await new Promise((postResolve, reject) => {
            const h = testUtils.resolvingRequest(postResolve, {
                method: "POST",
                port: port,
                path: "/db/log",
                headers: {
                    "content-type": "application/json"
                }
            });
            h.end(JSON.stringify({
                user: "nicferrier",
                timestamp: new Date().valueOf(),
                status: "hello, my first status update",
                otherStuff: "blah" // will be filtered out in the POST
            }));
        });
        pushIt({newLogResult: newLogResult});
    });

    try {
        const {log_insert:insertedId} = JSON.parse(newLogResult);
        const {id} = streamResult;
        assert.deepStrictEquals(logInsertedId, id);
    }
    catch (e) {
        console.log("error parsing new log result");
    }

    const getLogResult = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: "/db/log"
        }).end();
    });

    console.log("GET log", getLogResult);
    
    const tablesGetRes = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: "/db/part"
        }).end();
    });

    try {
        console.log("GET tables", JSON.parse(tablesGetRes));
    }
    catch (e) {
        console.log("error parsing table list");
    }

    const tableDataGetRes = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: "/db/part/log_201812"
        }).end();
    });

    try {
        console.log("GET part table", JSON.parse(tableDataGetRes));
    }
    catch (e) {
        console.log("error parsing table list");
    }

    listener.close();
    await dbConfig.pgPool.end();
    const exitCode = await new Promise((resolve, reject) => {
        dbConfig.pgProcess.on("exit", resolve);
        dbConfig.pgProcess.kill(process.SIGTERM);
    });
    return exitCode;
}

test().then(exitCode => console.log("postgres done, exit:", exitCode));

// End

