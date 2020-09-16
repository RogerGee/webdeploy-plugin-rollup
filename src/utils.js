/**
 * utils
 *
 * rollup (webdeploy plugin)
 */

const path = require("path");

function strip(string,match) {
    return stripLeading(stripTrailing(string,match),match);
}

function stripLeading(string,match) {
    while (string.substring(0,match.length) == match) {
        string = string.substring(match.length);
    }
    return string;
}

function stripTrailing(string,match) {
    let n;
    while ((n = string.length - match.length) && string.substring(n) == match) {
        string = string.substring(0,n);
    }
    return string;
}

function makeRandomId(prefix,suffix) {
    prefix = prefix || "";
    suffix = suffix || "";

    return prefix+Math.floor(Math.random() * 10**20).toString(36)+suffix;
}

function applyFileSuffix(filePath,suffix) {
    const parsed = path.parse(filePath);
    parsed.name += suffix;
    return path.join(parsed.dir,parsed.name + parsed.ext);
}

module.exports = {
    strip,
    stripLeading,
    stripTrailing,
    makeRandomId,
    applyFileSuffix
};
