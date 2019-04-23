const assert = require("assert");

function err() { throw new Error("bad"); }

Promise.trygo = function (f) {
    return new Promise((resolve, reject) => {
        resolve(f());
    });
}

async function test () {
    const {id} = await new Promise(r_ => r(JSON.parse("bad"))).catch(e => {
        return {id:0 };
    });
    console.log(id);
    assert.deepStrictEqual(id, 0);

    const {id:nextId} = await new Promise(r => r(JSON.parse(`{"id":1}`))).catch(e => {
        console.log(e);
        return {id:0 };
    });

    console.log(nextId);
}

test().then();

// End
