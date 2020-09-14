/**
 * settings.js
 *
 * rollup (webdeploy plugin)
 */

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
    }

    _normalizeExtensions() {
        for (let i = 0;i < this.extensions.length;++i) {
            if (this.extensions[i][0] != ".") {
                this.extensions[i] = "." + this.extensions[i];
            }
        }
    }
}

class BundleSettings {
    constructor(settings,context) {
        this.context = context;

        this.output = check(this.context,settings,"output","object");
        this.input = check(this.context,settings,"input","object");
        this.resolve = check_optional(check,this.context,settings,"resolve",{},"object");
        this.babel = check_optional(check,context,settings,"babel",null,"object");
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
