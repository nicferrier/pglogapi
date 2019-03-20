const boot = require("./boot.js");
const http = require("http");
const EventSource = require("eventsource");
const testUtils = require("./util-test.js");
const assert = require("assert");
const path = require("path");
const fetch = require("node-fetch");

async function test() {
    const dbDir = path.join(__dirname, "db-test-dir");
    const [app, listener, dbConfigPromise] = await boot.main({dbDir: dbDir});
    const dbConfig = await dbConfigPromise;

    const port = listener.address().port;

    // Test that we can access the dbConfig object
    const results = await dbConfig.query("select * from log;");
    // We can't assert on this because the db might be empty
    console.log("rows count before", results.rows.length);

    // Now a suite of actual tests with assertions
    try {
        const auth = `Basic ${Buffer.from("readonly:secret").toString("base64")}`;
        const writeAuth = `Basic ${Buffer.from("log:reallysecret").toString("base64")}`;
        
        // Test the db schema is being reported in the status
        const statusResult = await fetch(`http://localhost:${port}/db/status`, {
            headers: { "authorization": auth }
        });

        const statusData = await statusResult.json();
        const logTable = statusData.schema.tables
              .filter(tableObject =>
                      tableObject.schemaname == "public"
                      && tableObject.tablename == "log");
        assert(logTable[0].tableowner == "postgres", JSON.stringify(logTable));
        console.log("status response", statusData);

        const streamPromise = new Promise((resolve, reject) => {
            // We have to do our own auth for eventsource
            const authDetails = Buffer.from("readonly:secret").toString("base64");
            const authHeader =  { "Authorization": "Basic " + authDetails };
            const es = new EventSource(`http://localhost:${port}/db/stream`, {
                headers: authHeader
            });
            es.addEventListener("log", async esEvt => {
                const {type, data:rawData, lastEventId, origin} = esEvt;
                const [error, data] = await Promise.resolve([
                    undefined, JSON.parse(rawData)
                ]).catch(e => [e]);
                console.log("event data (error):", data, error);
                es.close();
                resolve([error, data]);
            });
        });

        // Now make a new log entry
        const newLogResult = await fetch(`http://localhost:${port}/db/log`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "authorization": writeAuth
            },
            body: JSON.stringify({
                user: "nicferrier",
                timestamp: new Date().valueOf(),
                status: "hello, my first status update",
                otherStuff: "blah" // will be filtered out in the POST
            })
        });
        
        const [{log_insert:logInsertedId}] = await newLogResult.json();
        
        const [streamError, streamResult] = await streamPromise;
        assert(streamError === undefined, `error parsing streamResult: ${streamError}`);

        const {id:streamResultId} = streamResult;
        assert.deepStrictEqual(logInsertedId, streamResultId);

        // Test that we can get the top of the log
        const getLogResult = await fetch(`http://localhost:${port}/db/log`, {
            headers: { "authorization": auth }
        });

        const logTop = await getLogResult.json();
        assert.deepStrictEqual(logInsertedId, logTop[0].id);

        const tableListRes = await fetch(`http://localhost:${port}/db/part`, {
            headers: { "authorization": auth }
        });

        const tableList = await tableListRes.json();
        const mostRecentTable = Object.keys(tableList).slice().sort()[0];

        const tableUrl = `http://localhost:${port}/db/part/${mostRecentTable}`;
        const tableDataRes = await fetch(tableUrl, {
            headers: { "authorization": auth }
        });
        
        const tableData = await tableDataRes.json();
        const lastRow = tableData[tableData.length - 1];
        assert.deepStrictEqual(logInsertedId, lastRow.id);

        // Get the data that the stream pointed to
        const streamRefDataResponse = await fetch(
            `http://localhost:${port}/db/stream/${streamResultId}`, {
                headers: {
                    "content-type": "application/json",
                    'authorization': auth
                }
            });

        const [{data:streamRefData}] = await streamRefDataResponse.json();
        console.log("streamRefData", streamRefData);

        assert.deepStrictEqual(streamRefData.timestamp, lastRow.data.timestamp);
        assert.deepStrictEqual(streamRefData.status, lastRow.data.status);
        assert.deepStrictEqual(streamRefData.user, lastRow.data.user);

        // In development
        const queryRes = await fetch(`http://localhost:${port}/db/log/query`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                'authorization': auth
            },
            body: JSON.stringify({
                sql: "select data from log order by d desc limit 2;"
            })
        });

        const queryData = await queryRes.json();
        assert(queryData.length, 2, `length of general query results wrong: ${queryData}`);

        return 0;
    }
    catch (e) {
        console.log("exception while running the test", e);
        return 1;
    }
    finally {
        listener.close();
        const pgExitCode = await dbConfig.close();
        console.log("pgExitCode", pgExitCode);
    }
}

test().then(exitCode => console.log("postgres done, exit:", exitCode));

// End
