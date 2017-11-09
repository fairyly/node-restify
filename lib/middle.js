'use strict';

/**
 * Module dependencies.
 * @private
 */

var EventEmitter = require('events').EventEmitter;
var finalhandler = require('finalhandler');
var merge = require('utils-merge');
var parseUrl = require('parseurl');

/**
 * Module exports.
 * @public
 */

module.exports = createServer;

/**
 * Module variables.
 * @private
 */

var env = process.env.NODE_ENV || 'development';
var proto = {};

/* istanbul ignore next */
var defer =
    typeof setImmediate === 'function'
        ? setImmediate
        : function setImmediate(fn) {
              process.nextTick(fn.bind.apply(fn, arguments));
          };

/**
 * Create a new connect server.
 *
 * @return {function}
 * @public
 */

function createServer() {
    function app(req, res, next) {
        app.handle(req, res, next);
    }
    merge(app, proto);
    merge(app, EventEmitter.prototype);
    app.route = '/';
    app.stack = [];
    return app;
}

/**
 * Utilize the given middleware `handle` to the given `route`,
 * defaulting to _/_. This "route" is the mount-point for the
 * middleware, when given a value other than _/_ the middleware
 * is only effective when that segment is present in the request's
 * pathname.
 *
 * For example if we were to mount a function at _/admin_, it would
 * be invoked on _/admin_, and _/admin/settings_, however it would
 * not be invoked for _/_, or _/posts_.
 *
 * @param {String|Function|Server} route, callback or server
 * @param {Function|Server} callback or server
 * @return {Server} for chaining
 * @public
 */

proto.use = function use(route, fn) {
    var handle = fn;
    var path = route;

    // default route to '/'
    if (typeof route !== 'string') {
        handle = route;
        path = '/';
    }

    // wrap sub-apps
    if (typeof handle.handle === 'function') {
        var server = handle;
        server.route = path;
        handle = function handleFn(req, res, next) {
            server.handle(req, res, next);
        };
    }

    // strip trailing slash
    if (path[path.length - 1] === '/') {
        path = path.slice(0, -1);
    }

    // add the middleware
    this.stack.push({ route: path, handle: handle });

    return this;
};

/**
 * Handle server requests, punting them down
 * the middleware stack.
 *
 * @private
 */

proto.handle = function handle(req, res, out) {
    var index = 0;
    var protohost = getProtohost(req.url) || '';
    var removed = '';
    var slashAdded = false;
    var stack = this.stack;

    // final function handler
    var done =
        out ||
        finalhandler(req, res, {
            env: env,
            onerror: logerror
        });

    // store the original URL
    req.originalUrl = req.originalUrl || req.url;

    function next(err) {
        if (slashAdded) {
            req.url = req.url.substr(1);
            slashAdded = false;
        }

        if (removed.length !== 0) {
            req.url = protohost + removed + req.url.substr(protohost.length);
            removed = '';
        }

        // next callback
        var layer = stack[index++];

        // all done
        if (!layer) {
            defer(done, err);
            return;
        }

        // route data
        var path = parseUrl(req).pathname || '/';
        var route = layer.route;

        // skip this layer if the route doesn't match
        if (
            path.toLowerCase().substr(0, route.length) !== route.toLowerCase()
        ) {
            next(err);
            return;
        }

        // skip if route match does not border "/", ".", or end
        var c = path.length > route.length && path[route.length];
        if (c && c !== '/' && c !== '.') {
            next(err);
            return;
        }

        // trim off the part of the url that matches the route
        if (route.length !== 0 && route !== '/') {
            removed = route;
            req.url =
                protohost + req.url.substr(protohost.length + removed.length);

            // ensure leading slash
            if (!protohost && req.url[0] !== '/') {
                req.url = '/' + req.url;
                slashAdded = true;
            }
        }

        // call the layer handle
        call(layer.handle, route, err, req, res, next);
    }

    next();
};

/**
 * Invoke a route handle.
 * @private
 */

function call(handle, route, err, req, res, next) {
    var arity = handle.length;
    var error = err;
    var hasError = err === false || Boolean(err);

    try {
        if (hasError && arity === 4) {
            // error-handling middleware
            handle(err, req, res, next);
            return;
        } else if (!hasError && arity < 4) {
            // request-handling middleware
            handle(req, res, next);
            return;
        }
    } catch (e) {
        // replace the error
        error = e;
    }

    // continue
    next(error, req, res);
}

/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */

function logerror(err) {
    if (env !== 'test') console.error(err.stack || err.toString());
}

/**
 * Get get protocol + host for a URL.
 *
 * @param {string} url
 * @private
 */

function getProtohost(url) {
    if (url.length === 0 || url[0] === '/') {
        return undefined;
    }

    var searchIndex = url.indexOf('?');
    var pathLength = searchIndex !== -1 ? searchIndex : url.length;
    var fqdnIndex = url.substr(0, pathLength).indexOf('://');

    return fqdnIndex !== -1
        ? url.substr(0, url.indexOf('/', 3 + fqdnIndex))
        : undefined;
}