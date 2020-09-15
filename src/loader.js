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

const INPUT_HOOKS = {
    buildEnd: 1,
    buildStart: 1,
//    resolveId: 1,
//    load: 1,
    options: 1,
    resolveDynamicImport: 1,
    transform: 1,
    watchChange: 1
};

const OUTPUT_HOOKS = {
//    watchChange: 1,
	augmentChunkHash: 1,
	generateBundle: 1,
	outputOptions: 1,
	renderChunk: 1,
	renderDynamicImport: 1,
	renderError: 1,
	renderStart: 1,
	resolveAssetUrl: 1,
	resolveFileUrl: 1,
	resolveImportMeta: 1,
	writeBundle: 1
};

function strip_plugin(plugin,hooks) {
    const stripped = { name: plugin.name };

    // Strip out hooks that either don't work in this context or are unsupported
    // by this webdeploy plugin.
    Object.keys(plugin).forEach((hook) => {
        if (hook in hooks) {
            stripped[hook] = plugin[hook];
        }
    });

    return stripped;
}

// NOTE: I'd like the prefix to contain a null byte, but many rollup packages
// refuse to touch a file if its name has a null byte.
const PREFIX = "webdeploy:";

class LoaderAbortException extends Error {

}

function makePlugin(loader,options) {
    return {
        name: 'webdeploy-core',

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
                if ((source[0] == "." && source[0] == "/")) {
                    throw new PluginError("Entry point '%s' is not a webdeploy target",source);
                }

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
        this.corePlugin = makePlugin(this,{});
        this.moduleMap = new Map();
        this.loadSet = new Set();
        this.currentLoadSet = new Set();
        this.entryTarget = null;
        this.extra = [];
        this.resolver = null;
    }

    makeInputOptions(bundleSettings) {
        const options = Object.assign({},bundleSettings.input);

        // Manipulate plugins.

        let plugins = [this.corePlugin]; // first

        if (!this.settings.disableNodeEnv) {
            plugins.push(this.makeProcessEnvPlugin());
        }

        if (this.settings.nodeModules) {
            plugins.push(this.makeNodeModulesPlugin());
        }

        if (bundleSettings.babel) {
            plugins.push(this.makeBabelPlugin(bundleSettings.babel));
        }

        const bundlePlugins = bundleSettings.loadPlugins();
        for (let i = 0;i < bundlePlugins.length;++i) {
            plugins.push(strip_plugin(bundlePlugins[i],INPUT_HOOKS));
        }

        if (bundleSettings.source) {
            plugins.push(strip_plugin(bundleSettings.source.getPlugin(this),INPUT_HOOKS));
        }

        options.plugins = plugins;

        if (options.external) {
            options.external = this.modifyExternal(options.external);
        }

        return options;
    }

    makeOutputOptions(bundleSettings) {
        const options = Object.assign({},bundleSettings.output);

        if (options.globals) {
            this.modifyGlobals(options.globals);
        }

        let plugins = [];

        const bundlePlugins = bundleSettings.loadPlugins();
        for (let i = 0;i < bundlePlugins.length;++i) {
            plugins.push(strip_plugin(bundlePlugins[i],OUTPUT_HOOKS));
        }

        if (bundleSettings.source) {
            plugins.push(strip_plugin(bundleSettings.source.getPlugin(this),OUTPUT_HOOKS));
        }

        options.plugins = plugins;

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
    }

    end() {
        const info = {
            parentTargets: Array.from(this.currentLoadSet),
            entryTarget: this.entryTarget,
            extra: this.extra
        };

        this.resolver = null;
        this.currentLoadSet.clear();
        this.entryTarget = null;
        this.extra = [];

        return info;
    }

    calcExtraneous() {
        const targets = new Set(Array.from(this.moduleMap.values()));

        this.loadSet.forEach((target) => {
            targets.delete(target);
        });

        return Array.from(targets);
    }

    lookupTarget(id) {
        // NOTE: 'id' is prefixed in this context.

        if (id.startsWith(PREFIX)) {
            return this.moduleMap.get(id.slice(PREFIX.length));
        }

        return null;
    }

    addExtra(target) {
        this.extra.push(target);
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

    makeProcessEnvPlugin() {
        const env = Object.assign({},this.settings.nodeEnv);
        const options = {};
        const plugin = require("rollup-plugin-inject-process-env");

        env.NODE_ENV = this.context.isDevDeployment() ? "development" : "production";
        options.include = /\.js$/;

        return plugin(env,options);
    }

    makeId(id) {
        if (id[0] == "/") {
            let newId = id;
            if (this.settings.prefix) {
                newId = this.settings.prefix + newId;
            }
            else {
                newId = newId.slice(1);
            }

            return PREFIX + newId;
        }

        return id;
    }

    modifyExternal(external) {
        // NOTE: Currently we only support string or string[].

        if (typeof external === "string") {
            return this.makeId(external);
        }

        if (Array.isArray(external)) {
            for (let i = 0;i < external.length;++i) {
                if (typeof external[i] === "string") {
                    external[i] = this.makeId(external[i]);
                }
            }
        }

        return external;
    }

    modifyGlobals(globals) {
        Object.keys(globals).forEach((key) => {
            if (key[0] == "/") {
                globals[this.makeId(key)] = globals[key];
                delete globals[key];
            }
        });
    }
}

module.exports = {
    Loader,
    LoaderAbortException
};
