/**
 * loader.js
 */

const minimatch = require("minimatch");
const { format } = require("util");

const { PluginError } = require("./error");

function makePlugin(loader,options) {
    return {
        name: 'webdeploy-rollup-loader',

        load(id) {
            return loader.load(id);
        },

        resolveId(source) {
            return loader.resolveId(source);
        }
    };
}

class Loader {
    constructor(settings) {
        this.settings = settings;
        this.moduleMap = new Map();
        this.loadSet = new Set();
        this.currentLoadSet = new Set();
        this.resolver = null;
    }

    plugin(options) {
        return makePlugin(this,options || {});
    }

    async addTargets(context) {
        const targets = context.getTargets();

        for (let i = 0;i < targets.length;++i) {
            const target = targets[i];
            const targetPath = target.getSourceTargetPath();

            if (!this.settings.include.some((glob) => minimatch(targetPath,glob))) {
                continue;
            }
            if (this.settings.exclude.some((glob) => !minimatch(targetPath,glob))) {
                continue;
            }

            await target.loadContent();

            this.moduleMap.set(targetPath,target);
        }
    }

    begin(resolver) {
        this.resolver = resolver;
        this.currentLoadSet.clear();
    }

    end() {
        this.resolver = null;
        return Array.from(this.currentLoadSet);
    }

    load(id) {
        const target = this.loadTarget(id);
        if (!target) {
            // Throw to prevent rollup from hitting the file system.
            throw new PluginError("cannot import '%s': no such module",id);
        }

        // Remember that this target was loaded for later.
        this.currentLoadSet.add(target);
        this.loadSet.add(target);

        return target.getContent();
    }

    resolveId(source) {
        const id = this.resolveSourceToId(source);
        const target = this.loadTarget(id);

        if (target) {
            return id;
        }
    }

    loadTarget(id) {
        // Try the import as-is.
        const target = this.moduleMap.get(id);
        if (target) {
            return target;
        }

        // Try the import with one of the configured extensions.
        let i = 0;
        while (i < this.settings.extensions.length) {
            const cand = id + this.settings.extensions[i];
            const target = this.moduleMap.get(cand);
            if (target) {
                return target;
            }

            i += 1;
        }

        return null;
    }

    resolveSourceToId(source) {
        let id = source;

        // Use the resolver to inject any custom resolution.
        if (this.resolver) {
            id = this.resolver.resolve(id);
        }

        return id;
    }
}

module.exports = {
    Loader
};
