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
    // We can't assert on this because the db might be empty
    console.log("rows count before", results.rows.length);

    // Test that we can POST and enter something and also get a notification
    const {newLogResult, streamResult} = await new Promise(async (resolve, reject) => {
        const es = new EventSource(`http://localhost:${port}/db/stream`);
        const resultObj = {};
        const pushIt = function (pair) {
            Object.assign(resultObj, pair);
            if (Object.keys(resultObj).length == 2) {
                 es.close();
                resolve(resultObj);
            }
        };

        es.addEventListener("log", esEvt => {
            const {type, data:rawData, lastEventId, origin} = esEvt;
            try {
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

    function jparse(source) {
        try {
            return [undefined, JSON.parse(source)];
        }
        catch (e) {
            return [e];
        }
    }

    const [newLogError, [{log_insert:logInsertedId}]] = jparse(newLogResult);
    console.log("streamResult", streamResult);
    const {id:streamResultId} = streamResult;
    assert(newLogError === undefined, `error parsing newLogResult: ${newLogError}`);
    assert.deepStrictEqual(logInsertedId, streamResultId);

    // Test that we can get the top of the log
    const getLogResult = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: "/db/log"
        }).end();
    });

    const [logTopError, logTop] = jparse(getLogResult);
    assert(logTopError === undefined, `error parsing logTop: ${logTopError}`);
    assert.deepStrictEqual(logInsertedId, logTop[0].id);

    const tableListRes = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: "/db/part"
        }).end();
    });

    const [tableListError, tableList] = jparse(tableListRes);
    assert(tableListError === undefined, `error parsing tableList: ${tableListError}`);
    const mostRecentTable = Object.keys(tableList).slice().sort()[0];
    const tableDataRes = await new Promise((resolve, reject) => {
        testUtils.resolvingRequest(resolve, {
            port: port,
            path: `/db/part/${mostRecentTable}`
        }).end();
    });
    const [tableDataError, tableData] = jparse(tableDataRes);
    assert(tableDataError === undefined, `error parsing tableData: ${tableDataError}`);
    const lastRow = tableData[tableData.length - 1];
    assert.deepStrictEqual(logInsertedId, lastRow.id);
    assert.deepStrictEqual(streamResult.timestamp, lastRow.data.timestamp);
    assert.deepStrictEqual(streamResult.status, lastRow.data.status);
    assert.deepStrictEqual(streamResult.user, lastRow.data.user);

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

