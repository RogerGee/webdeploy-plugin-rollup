/**
 * loader.js
 *
 * rollup (webdeploy plugin)
 */

const path = require("path");
const xpath = path.posix;
const minimatch = require("minimatch");
const { format } = require("util");
const { PluginError } = require("./error");

// NOTE: I'd like the prefix to contain a null byte, but many rollup packages
// refuse to touch a file if its name has a null byte.
const PREFIX = "webdeploy:";

function modify_external(external) {
    function make(id) {
        if (id[0] == "/") {
            return PREFIX + id.slice(1);
        }

        return id;
    }

    // NOTE: Currently we only support string or string[].

    if (typeof external === "string") {
        external = make(external);
    }
    else if (Array.isArray(external)) {
        for (let i = 0;i < external.length;++i) {
            if (typeof external[i] === "string") {
                external[i] = make(external[i]);
            }
        }
    }

}

function modify_globals(globals) {
    Object.keys(globals).forEach((key) => {
        if (key[0] == "/") {
            globals[PREFIX + key.slice(1)] = globals[key];
            delete globals[key];
        }
    });
}

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

        resolveId(source,_importer) {
            let importer = _importer;

            if (importer) {
                if (importer.startsWith(PREFIX)) {
                    importer = "/" + importer.slice(PREFIX.length);
                }
                else if (source[0] == ".") {
                    // Cannot import webdeploy module from non-webdeploy module.
                    return null;
                }
            }

            const resolv = loader.resolveId(source,importer);
            if (resolv) {
                return PREFIX + resolv;
            }

            // If there was no importer, then we failed to resolve the main
            // module and need to abort.
            if (!importer) {
                throw new LoaderAbortException();
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

    makeInputOptions(bundleSettings) {
        const options = Object.assign({},bundleSettings.input);

        // Manipulate plugins.

        let plugins = [this.plugin()]; // first

        if (options.plugins) {
            plugins = plugins.concat(options.plugins);
        }

        if (this.settings.nodeModules) {
            plugins.push(this.makeNodeModulesPlugin());
        }

        if (bundleSettings.babel) {
            plugins.push(this.makeBabelPlugin(bundleSettings.babel));
        }

        options.plugins = plugins;

        // Manipulate external.

        if (options.external) {
            modify_external(options.external);
        }

        return options;
    }

    makeOutputOptions(bundleSettings) {
        const options = Object.assign({},bundleSettings.output);

        if (options.globals) {
            modify_globals(options.globals);
        }

        return options;
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
        const target = this.moduleMap.get(id);
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

    resolveId(source,importer) {
        let id = source;

        // Unless configured, we do not allow imports without path
        // characteristics to access webdeploy modules.
        if (!this.settings.implicitRoot) {
            if (id[0] != "." && id[0] != "/") {
                return null;
            }
        }

        // Resolve relative to importer or root.
        if (importer) {
            id = xpath.resolve(xpath.dirname(importer),id).slice(1);
        }
        else {
            id = xpath.resolve("/",id).slice(1);

            // Apply prefix when we have no import context.
            if (this.settings.prefix) {
                id = this.settings.prefix + "/" + id;
            }

        }

        // Use the resolver to inject any custom resolution.
        if (this.resolver) {
            id = this.resolver.resolve(id);
        }

        if (this.moduleMap.has(id)) {
            return id;
        }

        let i = 0;
        while (i < this.settings.extensions.length) {
            const idWithExt = id + this.settings.extensions[i];

            // Try the ID with the extension.
            if (this.moduleMap.has(idWithExt)) {
                return idWithExt;
            }

            i += 1;
        }

        return null;
    }

    makeNodeModulesPlugin() {
        const plugin = require("@rollup/plugin-node-resolve").default;
        const opts = Object.assign({},this.settings.nodeModules.options);

        if (!this.context.nodeModules) {
            throw new PluginError(
                "Cannot create plugin-node-resolve: node_modules are not available for this project tree"
            );
        }

        // Assign custom resolve options. We do not allow the user to manipulate
        // these.
        opts.customResolveOptions = {
            basedir: this.context.tree.getPath(),
            moduleDirectory: this.context.nodeModules
        };

        return plugin(opts);
    }

    makeBabelPlugin(options) {
        const plugin = require("@rollup/plugin-babel").default;
        const opts = Object.assign({},options);

        if (!this.context.nodeModules) {
            throw new PluginError(
                "Cannot create plugin-babel: node_modules are not available for this project tree"
            );
        }

        // Make babel work under the webdeploy project tree node_modules.
        opts.cwd = this.context.nodeModules;

        if (!opts.include) {
            opts.include = new RegExp("^" + PREFIX);
        }

        return plugin(opts);
    }
}

module.exports = {
    Loader,
    LoaderAbortException
};
