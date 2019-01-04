const fs = require("fs");
const assert = require("assert");
const FormData = require("form-data");
const http = require("http");
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");

const DEBUG=false;

async function keepieRequestProcessor(keepieRequests, authorizedFile) {
    if (DEBUG) {
        console.log("keepie processing", keepieRequests, authorizedFile);
    }
    const keepieAuthorizedContent = await fs.promises.readFile(authorizedFile);
    const keepieAuthorized = JSON.parse(keepieAuthorizedContent);
    if (DEBUG) {
        console.log("keepie processing", keepieRequests, keepieAuthorized);
    }

    function consume(requests, toRespond) {
        const requestUrl = requests.pop();
        if (requestUrl !== undefined) {
            const matches = keepieAuthorized.filter(url => url == requestUrl);
            if (matches.length > 0) {
                Object.assign(toRespond, matches);
            }
        }
        if (requests.length > 0) {
            consume(requests, toRespond);
        }
        return toRespond;
    }
    const consumeOutput = consume(keepieRequests, []);
    if (DEBUG) {
        console.log("keepie processing output>", consumeOutput);
    }
    return consumeOutput;
}

async function keepieHttpSend(httpSender, name, password, authorizedFile, requests) {
    const toSend = await keepieRequestProcessor(requests, authorizedFile);
    return toSend.map(async authorizedUrl => {
        const form = new FormData();
        form.append("password", password);
        form.append("name", name);
        const request = {
            method: "POST",
            url: authorizedUrl,
            body: form
        };
        const response = await httpSender(request);
        return response;
    });
}

async function httpSend (request) {
    return fetch(request.url, request);
}

const httpSender = {
    send: httpSend
};

async function keepieSend(name, password, authorizedFile, requests) {
    return keepieHttpSend(httpSender.send, name, password, authorizedFile, requests);
}

async function test() {
    const authFile = "authorized-urls.json";
    const noRequests = await keepieRequestProcessor([], authFile);
    assert(noRequests.length < 1, `error: ${noRequests} <<<`);

    const authUrl = "http://localhost:5001/secret";
    const oneRequest = await keepieRequestProcessor([authUrl], authFile);
    assert(oneRequest[0] == authUrl, `error matching? ${oneRequest}`);

    let recievedRequest;
    httpSender.send = function (request) {
        return new Promise((resolve, reject) => {
            recievedRequest = request;
            resolve(true);
        });
    };
    await keepieSend("readonly", "secret", authFile, [authUrl]);
    assert(recievedRequest.method == "POST");
    assert(recievedRequest.url == authUrl);

    const [listener, results] = await new Promise((resolve, reject) => {
        const upload = multer();
        const app = express();
        const listener = app.listen(0, async function () {
            app.post("/secret", upload.array(), (req,res) => {
                res.sendStatus(204);
                resolve([listener, req.body]);
            });

            const testAuthFile = "test-http-authorized-urls.json";
            const port = listener.address().port;
            const url = `http://localhost:${port}/secret`
            console.log("url", url);
            await fs.promises.writeFile(testAuthFile, JSON.stringify([url]), "utf-8");
            const sendPromises = await keepieHttpSend(httpSend, "readonly", "secret", testAuthFile, [url]);
            const results = await Promise.all(sendPromises);
        });
    });

    const {name, password} = results;
    console.log("name", name, "password", password);
    listener.close();

    return 0;
}

exports.process = keepieSend;

if (require.main === module) {
    test().then(out => console.log(out));
}

// End
