/**
 * settings.js
 *
 * rollup (webdeploy plugin)
 */

const utils = require("./utils");
const { format } = require("util");
const { PluginError } = require("./error");

function format_context(context,key) {
    if (typeof key === "number") {
        return format("%s[%d]",context,key);
    }

    return format("%s.%s",context,key);
}

function check_val(context,key,val,...types) {
    let type;
    if (Array.isArray(val)) {
        type = "array";
    }
    else {
        type = typeof val;
    }

    if (type === "undefined") {
        throw new PluginError(
            "invalid config: missing '%s'",
            format_context(context,key)
        );
    }

    if (types.indexOf(type) < 0) {
        throw new PluginError(
            "invalid config: '%s' must be %s",
            format_context(context,key),
            types.join(" or ")
        );
    }

    return val;
}

function lookup_key(context,settings,name,optional) {
    const regex = "^" + name + "$";
    const key = Object.keys(settings).find((key) => key.match(regex));
    if (!key) {
        if (optional) {
            return;
        }

        throw new PluginError(
            "invalid config: missing '%s'",
            format_context(context,name)
        );
    }

    return key;
}

function check(context,settings,name,...types) {
    const key = lookup_key(context,settings,name);
    return check_val(context,key,settings[key],...types);
}

function check_array_impl(context,val,...types) {
    return val.map((elem,index) => check_val(context,index,elem,...types));
}

function check_array(context,settings,name,...types) {
    const key = lookup_key(context,settings,name);
    const val = settings[key];

    if (!Array.isArray(val)) {
        throw new PluginError(
            "invalid config: '%s' must be array of %s",
            format_context(context,key),
            types.join(" or ")
        );
    }

    return check_array_impl(context,val,...types);
}

function check_array_ensure(context,settings,name,...types) {
    const key = lookup_key(context,settings,name);
    const val = settings[key];

    if (!Array.isArray(val)) {
        check_val(context,key,val,...types);
        return [val];
    }

    return check_array_impl(context,val,...types);
}

function check_optional(fn,context,settings,name,defval,...types) {
    const key = lookup_key(context,settings,name,true);

    if (typeof key === "undefined") {
        return defval;
    }

    return fn(context,settings,name,...types);
}

class NodeModulesSettings {
    constructor(settings,context) {
        this.context = context;

        this.options = check_optional(check,this.context,settings,"options",{},"object");
    }
}

class LoaderSettings {
    constructor(settings,context) {
        this.context = context;

        this.implicitRoot = check_optional(
            check,
            this.context,
            settings,
            "implicitRoot",
            false,
            "boolean"
        );

        this.prefix = check_optional(check,this.context,settings,"prefix",null,"string");
        this.alias = check_optional(check,this.context,settings,"alias",{},"object");

        this.include = check_array(this.context,settings,"include","string");
        this.exclude = check_optional(check_array,this.context,settings,"exclude",[],"string");

        const nodeModules = check_optional(
            check,
            context,
            settings,
            "nodeModules",
            false,
            "object",
            "boolean"
        );
        if (nodeModules) {
            this.nodeModules = new NodeModulesSettings(
                typeof nodeModules === "object" ? nodeModules : {},
                format("%s.nodeModules",this.context)
            );
        }
        else {
            this.nodeModules = null;
        }

        this.extensions = check_optional(
            check_array,
            context,
            settings,
            "extensions",
            [".js","css"],
            "string"
        );

        this._normalizeExtensions();
        this._normalizePrefix();
    }

    _normalizeExtensions() {
        for (let i = 0;i < this.extensions.length;++i) {
            if (this.extensions[i][0] != ".") {
                this.extensions[i] = "." + this.extensions[i];
            }
        }
    }

    _normalizePrefix() {
        if (this.prefix) {
            this.prefix = utils.strip(this.prefix,"/");
        }
    }
}

class SourceSettings {
    constructor(settings,context) {
        this.context = context;

        this.output = check(this.context,settings,"output","string");
        this.match = check(this.context,settings,"match","string","array");
        if (Array.isArray(this.match)) {
            for (let i = 0;i < this.match.length;++i) {
                check(format_context(this.context,i),this.match,i,"string");
            }
        }
        else {
            this.match = [this.match];
        }

        this._plugin = null;
    }

    getPlugin(loader) {
        // Create the plugin once so its state is preserved.
        if (!this._plugin) {
            this._plugin = require("./source-loader")(loader,this);
        }

        return this._plugin;
    }
}

class BundleSettings {
    constructor(settings,context) {
        this.context = context;

        this._pluginsLoaded = null;
        this.plugins = check_optional(
            check_array,
            this.context,
            settings,
            "plugins",
            [],
            "array","string"
        );

        for (let i = 0;i < this.plugins.length;++i) {
            const localContext = format_context(format("%s.plugins",this.context),i);
            check(
                localContext,
                this.plugins,
                i,
                "string","array"
            );

            if (Array.isArray(this.plugins[i])) {
                const item = this.plugins[i];
                if (item.length > 2) {
                    throw new PluginError(
                        "invalid config: %s must be [string,object]",
                        localContext
                    );
                }

                if (typeof item[0] !== "string") {
                    throw new PluginError(
                        "invalid config: %s[0] must be string",
                        localContext
                    );
                }

                if (item[1] && typeof item[1] !== "object") {
                    throw new PluginError(
                        "invalid config: %s[0] must be object",
                        localContext
                    );
                }
            }
        }

        this.output = check(this.context,settings,"output","object");
        this.input = check(this.context,settings,"input","object");
        this.resolve = check_optional(check,this.context,settings,"resolve",{},"object");
        this.babel = check_optional(check,context,settings,"babel",null,"object");

        this.source = check_optional(check,this.context,settings,"source",null,"object");
        if (this.source) {
            this.source = new SourceSettings(
                this.source,
                format_context(this.context,"source")
            );
        }

        this.nodeEnv = check_optional(
            check,
            this.context,
            settings,
            "nodeEnv",
            false,
            "object","boolean"
        );

        this._normalizeNodeEnv();
    }

    loadPlugins() {
        // NOTE: We have to cache plugins so that their state is preserved for
        // both rollup phases: generation and output.

        if (!this._pluginsLoaded) {
            this._pluginsLoaded = this.plugins.map((spec) => {
                let packageName;
                let options;

                if (Array.isArray(spec)) {
                    packageName = spec[0];
                    options = spec[1] || {};
                }
                else {
                    packageName = spec;
                    options = {};
                }

                return require(packageName)(options);
            });
        }

        return this._pluginsLoaded;
    }

    _normalizeNodeEnv() {
        if (!this.nodeEnv) {
            return;
        }

        const keys = Object.keys(this.nodeEnv);
        for (let i = 0;i < keys.length;++i) {
            const key = keys[i];
            if (typeof this.nodeEnv[key] !== "string") {
                this.nodeEnv[key] = JSON.stringify(this.nodeEnv[key]);
            }
        }
    }
}

class PluginSettings {
    constructor(settings) {
        this.loader = new LoaderSettings(
            check("settings",settings,"loader","object"),
            "settings.loader"
        );

        this.bundles = check_array_ensure("settings",settings,"bundles?","object")
            .map((bundleSettings,index) => {
                return new BundleSettings(
                    bundleSettings,
                    format_context("settings.bundles",index)
                );
            });

        this.build = check_optional(check_array,"settings",settings,"build",[],"object","string");

        this.write = check_optional(check,"settings",settings,"write",{},"object");
    }
}

module.exports = {
    PluginSettings
};
