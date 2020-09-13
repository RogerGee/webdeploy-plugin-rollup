/**
 * loader.js
 *
 * rollup (webdeploy plugin)
 */

const path = require("path");
const xpath = path.posix;
const minimatch = require("minimatch");
const { format } = require("util");

const utils = require("./utils");
const { PluginError } = require("./error");

const PREFIX = "\0webdeploy:";

class LoaderAbortException extends Error {

}

function makePlugin(loader,options) {
    return {
        name: 'webdeploy-rollup-loader',

        load(id) {
            if (id.startsWith(PREFIX)) {
                const moduleId = id.slice(PREFIX.length);

                return loader.load(moduleId);
            }

            return null;
        },

        resolveId(source,importer) {
            const resolv = loader.resolveId(source);
            if (resolv) {
                return PREFIX + resolv;
            }

            if (!importer) {
                throw new LoaderAbortException();
            }

            if (importer.startsWith(PREFIX)) {
                const context = "/" + importer.slice(PREFIX.length);
                const resolved = xpath.resolve(
                    xpath.dirname(context),
                    source
                ).slice(1);

                const resolv = loader.resolveId(resolved);
                if (resolv) {
                    return PREFIX + resolv;
                }
            }

            return null;
        }
    };
}

class Loader {
    constructor(settings,context) {
        this.settings = settings;
        this.context = context;
        this.moduleMap = new Map();
        this.loadSet = new Set();
        this.currentLoadSet = new Set();
        this.entryTarget = null;
        this.resolver = null;
    }

    plugin(options) {
        return makePlugin(this,options || {});
    }

    getInputPlugins(extra) {
        let plugins = [this.plugin()]; // first
        if (extra) {
            plugins = plugins.concat(extra);
        }

        if (this.settings.nodeModules) {
            plugins.push(this.makeNodeModulesPlugin());
        }

        return plugins;
    }

    getOutputPlugins(extra) {
        let plugins = [];
        if (extra) {
            plugins = plugins.concat(extra);
        }

        return plugins;
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

    count() {
        return this.moduleMap.size;
    }

    begin(resolver) {
        this.resolver = resolver;
        this.currentLoadSet.clear();
        this.entryTarget = null;
    }

    end() {
        this.resolver = null;
        return {
            parentTargets: Array.from(this.currentLoadSet),
            entryTarget: this.entryTarget
        };
    }

    calcExtraneous() {
        const targets = new Set(Array.from(this.moduleMap.values()));

        this.loadSet.forEach((target) => {
            targets.delete(target);
        });

        return Array.from(targets);
    }

    load(id) {
        const target = this.loadTarget(id);
        if (!target) {
            return null;
        }

        // Remember that this target was loaded for later.
        this.currentLoadSet.add(target);
        this.loadSet.add(target);

        // Consider first loaded target the entry target.
        if (!this.entryTarget) {
            this.entryTarget = target;
        }

        return target.getContent();
    }

    resolveId(source) {
        const id = this.resolveSourceToId(source);
        const target = this.loadTarget(id);

        if (target) {
            return id;
        }

        return null;
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

        // Remove leading path separators.
        id = utils.strip(id,xpath.sep);

        // Use the resolver to inject any custom resolution.
        if (this.resolver) {
            id = this.resolver.resolve(id);
        }

        return id;
    }

    makeNodeModulesPlugin() {
        const plugin = require("@rollup/plugin-node-resolve").default;
        const opts = Object.assign({},this.settings.nodeModules.options);

        // Assign custom resolve options. We do not allow the user to manipulate
        // these.
        opts.customResolveOptions = {
            basedir: this.context.tree.getPath(),
            moduleDirectory: path.join(this.context.tree.getRelativePath(),"node_modules")
        };

        return plugin(opts);
    }
}

module.exports = {
    Loader,
    LoaderAbortException
};
