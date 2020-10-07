/**
 * loader.js
 *
 * rollup (webdeploy plugin)
 */

const path = require("path");
const xpath = path.posix;
const rollup = require("rollup");
const minimatch = require("minimatch");
const { format } = require("util");
const { PluginError } = require("./error");

const INPUT_HOOKS = {
    buildEnd: 1,
    buildStart: 1,
    resolveId: 1,
    load: 1,
    options: 1,
    resolveDynamicImport: 1,
    transform: 1,
    watchChange: 1
};

const OUTPUT_HOOKS = {
    watchChange: 1,
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
const BUNDLE_PREFIX = "\0bundle:";
const BUNDLE_EXTERN_PREFIX = "\0extern-bundle:";

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

            if (id.startsWith(BUNDLE_PREFIX)) {
                const moduleId = id.slice(BUNDLE_PREFIX.length);

                return loader.loadBundle(moduleId);
            }

            return null;
        },

        async resolveId(source,_importer) {
            // Resolve external bundle modules.
            if (source.startsWith(BUNDLE_EXTERN_PREFIX)) {
                return {
                    id: source,
                    external: true
                };
            }

            let resolv;
            let importer = _importer;
            const islocal = ( source[0] == "." || source[0] == "/" );

            let isImporterLocal;
            if (importer) {
                isImporterLocal = importer.startsWith(PREFIX);
                if (isImporterLocal) {
                    importer = "/" + importer.slice(PREFIX.length);
                }
            }

            // Cannot import webdeploy module from non-webdeploy module.
            if (islocal && isImporterLocal === false) {
                return null;
            }

            // Try resolving a local source. We try this even for explicitly
            // non-local sources in case an alias maps to a local file.

            resolv = await loader.resolveId(source,importer);
            if (resolv) {
                return PREFIX + resolv;
            }

            // If there was no importer, then we failed to resolve the main
            // module and need to abort.
            if (!importer) {
                if (!islocal) {
                    throw new PluginError("Entry point '%s' is not a webdeploy target",source);
                }

                throw new LoaderAbortException();
            }

            // Try resolving a non-local source.
            if (!islocal) {
                resolv = await loader.resolveId_NonLocal(
                    source,
                    importer,
                    isImporterLocal
                );

                if (resolv) {
                    return resolv;
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
        this.corePlugin = makePlugin(this,{});
        this.moduleMap = new Map();
        this.loadSet = new Set();

        if (this.settings.nodeModules) {
            this.nodeResolve = this.makeNodeModulesPlugin();
        }

        // Local execution properties:
        this.bundleSettings = null;
        this.currentLoadSet = new Set();
        this.entryTarget = null;
        this.extra = [];
        this.bundles = new Map(); // id -> bundleInfo
    }

    makeInputOptions(bundleSettings) {
        const options = Object.assign({},bundleSettings.input);

        // Manipulate plugins.

        let plugins = [this.corePlugin]; // first

        const bundlePlugins = bundleSettings.loadPlugins();
        for (let i = 0;i < bundlePlugins.length;++i) {
            plugins.push(strip_plugin(bundlePlugins[i],INPUT_HOOKS));
        }

        if (bundleSettings.nodeEnv) {
            plugins.push(this.makeNodeEnvPlugin(bundleSettings.nodeEnv));
        }

        if (bundleSettings.source) {
            plugins.push(strip_plugin(bundleSettings.source.getPlugin(this),INPUT_HOOKS));
        }

        if (bundleSettings.babel) {
            plugins.push(this.makeBabelPlugin(bundleSettings.babel));
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
        else {
            options.globals = {};
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

    begin(bundleSettings) {
        this.bundleSettings = {
            input: this.makeInputOptions(bundleSettings),
            output: this.makeOutputOptions(bundleSettings)
        };
    }

    async build() {
        let bundle;
        try {
            bundle = await rollup.rollup(this.bundleSettings.input);
        } catch (ex) {
            if (ex instanceof LoaderAbortException) {
                return [];
            }

            throw ex;
        }

        const results = await bundle.generate(this.bundleSettings.output);

        return results.output;
    }

    end() {
        const info = {
            parentTargets: Array.from(this.currentLoadSet),
            entryTarget: this.entryTarget,
            extra: this.extra,
            refs: this.calcRefs()
        };

        this.bundleSettings = null;
        this.currentLoadSet.clear();
        this.entryTarget = null;
        this.extra = [];
        this.bundles.clear();

        return info;
    }

    calcExtraneous() {
        const targets = new Set(Array.from(this.moduleMap.values()));

        this.loadSet.forEach((target) => {
            targets.delete(target);
        });

        return Array.from(targets);
    }

    calcRefs() {
        const local = this.context.isDevDeployment();
        const refs = [];

        this.bundles.forEach((bundleInfo,id) => {
            bundleInfo.refs.forEach((file) => {
                if (typeof file === "string") {
                    refs.push(xpath.join(bundleInfo.root,file));
                }
                else if (typeof file === "object" && file.local) {
                    let ref;
                    if (local || !file.remote) {
                        ref = xpath.join(bundleInfo.root,file.local);
                    }
                    else {
                        ref = file.remote;
                    }

                    if (typeof ref === "string") {
                        refs.push(ref);
                    }
                }
            });
        });

        return refs;
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

    loadBundle(id) {
        const bundleInfo = this.bundles.get(id);
        if (!bundleInfo || bundleInfo.refs.length == 0) {
            return null;
        }

        // If a global was provided, load a virtual module that provides
        // exports.
        if (bundleInfo.global && typeof bundleInfo.global === "string") {
            const bundleId = BUNDLE_EXTERN_PREFIX + id;
            this.bundleSettings.output.globals[bundleId] = bundleInfo.global;

            let code = "";
            if (bundleInfo.imports && Array.isArray(bundleInfo.imports)) {
                code += bundleInfo.imports.map((i) => format("import '%s';",i)).join("\n");
            }

            code += format("export { default } from \"%s\";\n",bundleId);
            if (bundleInfo.exports && Array.isArray(bundleInfo.exports)) {
                const inner = bundleInfo.exports.join(", ");
                code += format("export { %s } from \"%s\";\n",inner,bundleId);
            }

            return code;
        }

        // If no global was provided, then the bundle is a pure source import
        // resulting in no transformation.
        return "";
    }

    async resolveId(source,importer) {
        let id = source;

        // Resolve aliases. We do this first since aliases always refer to the
        // import source string, not the resolved ID.

        if (this.settings.alias) {
            id = this.resolveAlias(id);
        }

        // Unless configured, we do not allow imports without path
        // characteristics to access webdeploy modules.
        if (!this.settings.implicitRoot) {
            if (id[0] != "." && id[0] != "/") {
                return null;
            }
        }

        // Resolve relative to importer or root. This removes leading and
        // trailing path separators.
        if (importer) {
            // Apply prefix when the import is absolute.
            if (this.settings.prefix && id[0] == "/") {
                id = "/" + this.settings.prefix + id;
            }

            id = xpath.resolve(xpath.dirname(importer),id).slice(1);
        }
        else {
            id = xpath.resolve("/",id).slice(1);

            // Ensure ID is qualified with the prefix if configured.
            if (this.settings.prefix) {
                id = this.settings.prefix + "/" + id;
            }
        }

        const info = await this.resolveIdImpl(id);
        id = info.id;

        if (id) {
            return id;
        }

        // See if any of the candidates are in globals. These modules exist
        // implicitly.

        id = info.candidates.find((id) => {
            return this.makeId("/" + id,true) in this.bundleSettings.output.globals;
        });

        return id || null;
    }

    async resolveIdImpl(candidateId,subtree) {
        let id = candidateId;
        let candidates = [];

        candidates.push(id);
        if (this.moduleMap.has(id)) {
            return { id, candidates };
        }

        // Try the ID with one of the configured extensions.

        let i = 0;
        while (i < this.settings.extensions.length) {
            const idWithExt = id + this.settings.extensions[i];
            candidates.push(idWithExt);

            if (this.moduleMap.has(idWithExt)) {
                return { id: idWithExt, candidates };
            }

            i += 1;
        }

        // Resolve tree paths to indexes. We do this here after the in-memory
        // module checks as the operation may engage the file system.

        if (!subtree && await this.context.tree.testTree(id)) {
            let i = 0;
            while (i < this.settings.indexes.length) {
                const result = await this.resolveIdImpl(id + this.settings.indexes[i],true);
                if (result.id) {
                    return result;
                }
                i += 1;
            }
        }

        return { id: null, candidates };
    }

    async resolveId_NonLocal(id,importer,isImporterLocal) {
        let resolved;

        // Proxy to node-resolve plugin for a non-local resolve. The plugin is
        // not called by rollup in the usual way.

        if (isImporterLocal) {
            // NOTE: Pass 'null' as the importer to trigger using the 'rootDir'
            // as the base directory.
            resolved = await this.nodeResolve.resolveId(id,null);
        }
        else {
            resolved = await this.nodeResolve.resolveId(id,importer);
        }

        if (!resolved) {
            return null;
        }

        if (!this.settings.disableBundlesExtension) {
            let id = resolved;
            if (typeof id === "object") {
                ({ id } = id);
            }
            id = this.resolveBundles(id);

            if (id) {
                resolved = id;
            }
        }

        return resolved;
    }

    resolveBundles(id) {
        // Use the node-resolve plugin to get package.json contents.
        const data = this.nodeResolve.getPackageInfoForId(id);
        if (!data) {
            return null;
        }

        const { packageJson } = data;

        // Use non-standard 'bundles' (or 'bundle') property to pull
        // information.
        const bundleInfo = packageJson.bundles || packageJson.bundle;
        if (!bundleInfo || typeof bundleInfo !== "object" || Array.isArray(bundleInfo)) {
            return null;
        }

        // If the bundle is valid (i.e. contains refs), then we add it to the
        // ordered map of bundles. This preserves the import order.
        if (bundleInfo.refs && Array.isArray(bundleInfo.refs)) {
            // Remember root directory relative to project tree for later.
            let root = xpath.relative(this.context.tree.getPath(),data.root);
            bundleInfo.root = root.replace(/\\/g,"/");

            this.bundles.set(id,bundleInfo);

            return BUNDLE_PREFIX + id;
        }

        return null;
    }

    resolveAlias(id) {
        const parts = id.split(xpath.sep).filter((x) => !!x);

        // Match a path prefix to replace for a module alias.

        let i = 1;
        let prefix = parts[0];
        while (true) {
            if (prefix in this.settings.alias) {
                const newId = xpath.join(this.settings.alias[prefix],...parts.slice(i));
                return xpath.resolve("/",newId);
            }

            if (!parts[i]) {
                break;
            }

            prefix = prefix + xpath.sep + parts[i++];
        }

        // No alias found.

        return id;
    }

    makeNodeModulesPlugin() {
        const plugin = require("@rollup/plugin-node-resolve").default;
        const opts = Object.assign({},this.settings.nodeModules.options);

        if (!this.context.nodeModules) {
            throw new PluginError(
                "Cannot create plugin-node-resolve: node_modules are not available for this project tree"
            );
        }

        // Assign root directory so that all local node_modules import resolve
        // under the node_modules directory used for the webdeploy project.
        opts.rootDir = this.context.nodeModules;

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

    makeNodeEnvPlugin(nodeEnv) {
        const env = nodeEnv === true ? {} : Object.assign({},nodeEnv);
        const options = {};
        const plugin = require("./node-env-plugin");

        env.NODE_ENV = this.context.isDevDeployment() ? "development" : "production";

        return plugin(env,options);
    }

    makeId(id,noprefix) {
        if (id[0] == "/") {
            let newId = id;
            if (this.settings.prefix && !noprefix) {
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
