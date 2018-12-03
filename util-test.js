const stream = require("stream");
const http = require("http");

class BufferWritable extends stream.Writable {
    constructor(resolve) {
        super();
        this.buffer = "";
        this.resolve = resolve;
    }

    _write(chunk, encoding, next) {
        this.buffer = this.buffer + chunk;
        next();
    }
            
    _final(callback) {
        this.resolve(this.buffer);
    }
};

exports.resolvingRequest = function(resolve, options) {
    const requestOpts = Object.assign({
        method: "GET",
        host: "localhost"
    }, options === undefined ? {} : options);
    const h = http.request(requestOpts, response => {
        const writer = new BufferWritable(resolve);
        response.pipe(writer);
    });
    return h;
};

// End
