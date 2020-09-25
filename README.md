# rollup (webdeploy plugin)

> Deploy plugin integrating `webdeploy` and [rollup](https://rollupjs.org)

## Synopsis

The rollup deploy plugin integrates `webdeploy` and rollup.js, allowing output targets to be converted into one or more bundles. The plugin works by implementing several custom rollup plugins that virtualize access to `webdeploy` targets and perform common tasks for building/deploying web applications. While rollup.js bundles JavaScript natively, the plugin provides ways to bundle other source asset types as well (e.g. CSS).

Important note: since `webdeploy` integration requires special considerations, this plugin cannot take advantage of every rollup feature or configuration. Some rollup plugins may not work when performing a remote deployment. As such, rollup config files are not supported. Instead, rollup is used as the engine for bundling and we integrate it indirectly. (This is why rollup is _not_ a peer dependency.) The plugin does integrates a number of core rollup plugins and optimizes them for `webdeploy`. You should _not_ add these core plugins to the build directly: they are added automatically based on the deploy plugin config.

The following core plugins have been integrated and should not be added:

- [node-resolve](https://github.com/rollup/plugins/blob/master/packages/node-resolve)
- [babel](https://github.com/rollup/plugins/blob/master/packages/babel)
	- Peer dependency of `@babel/core` is required

While it is possible to utilize additional rollup plugins (both core and 3rd party) in a build, such utilization should be considered experimental. Not all plugins will work with the `webdeploy` system.

## Install

~~~
npm install --save-dev @webdeploy/plugin-rollup
~~~

If you are using `babel`, then you should also install `@babel/core@^7.0.0`.

If you define a `manifest` section in your config, you should also install [`@webdeploy/plugin-manfest`](https://www.npmjs.com/package/@webdeploy/plugin-manifest).

## Config

There are three core config sections:

 - `loader` (required)
 - `bundles` (required)
 - `build` (optional)
 - `manifest` (optional)

## Config: `loader`

### `loader.include`

- Type: `string[]`
- Required

A list of glob patterns used to match the targets available for loading. All targets matched by this property will be available for import in your entry point module(s), and any target not imported will be implicitly removed from the deployment.

### `loader.exclude`

- Type: `string[]`
- Optional

A list of glob patterns used to exclude targets from the loader.

### `loader.implicitRoot`

- Type: `boolean`
- Default: `false`

If set to `true`, then target modules can be loaded with an implicit root (i.e. without path characteristics). The use of this feature should be discouraged, as it can cause conflicts with 3rd party modules loaded via `node_modules`.

For example, `import "a"` could be used instead of `import "/a"` if `implicitRoot` is enabled.

### `loader.prefix`

- Type: `string`
- Optional

Denotes the path prefix for all project modules. This is a simple way to alias all module access under a common subtree.

Note that the prefix takes precedence above all other loader transformations. This means aliases map to locations under the prefix. A prefix is typically only good for projects that have every required module under a common subtree.

### `loader.alias`

- Type: `object` dictionary
- Optional

Provides a dictionary of alias translations to apply. The keys represent leading path components to match, and the values represent the replacement. When the loader performs an alias replacement, the replacement always lives under the project tree, meaning you can't alias to `node_modules`. Also, alias transformations are non-recursive: only one occurs for each module resolution. The matched module path does not have to have path characteristics (e.g. `themes/default.css` can be aliased to `/styles/themes/default.css`).

### `loader.nodeModules`

- Type: `boolean|object`
- Default: `false`

Enables loading modules from `node_modules`. The plugin ensures the resolver points to the current `node_modules` directory for your project.

You can customize the behavior of the core rollup plugin [node-resolve](https://github.com/rollup/plugins/blob/master/packages/node-resolve) by passing an object `{ options:{} }`. The `options` get forwarded to the rollup plugin. Note that some options are overwritten by the deploy plugin and cannot be overwritten by your config.

### `loader.extensions`

- Type: `string[]`
- Default: `[".js",".css"]`

Defines a list of file extensions used to resolve import source paths. If a path doesn't match directly, then the loader attempts to match the path having an extension, trying each extension in list-order until a match is found.

For example, `import "./a";` can import a target `a.js` if `.js` is in the `extensions` list.

### `loader.indexes` (or `loader.index)`

- Type: `string|string[]`
- Default: `["index.js"]`

Defines one or more default file names to be used when the source path refers to a subtree (i.e. directory). The loader will try each of them in order until it finds a match.

### `loader.disableBundlesExtension`

- Type: `boolean`
- Default: `false`

Disables the non-standard bundles extension functionality. See the section below on _Bundles Extension_ for more on this.

## Config: `bundles` (or `bundle`)

The `bundles` section maps to an array of bundle config objects (`bundleConfig`). If the section maps to a non-array object, then it is treated as a singleton bundle config object array.

### `bundleConfig.input`

- Type: `object`
- Required

Rollup input options. See [this page](https://rollupjs.org/guide/en/#inputoptions-object) from rollup docs for details. The only options that are supported are: `main` and `external`. Using anything else is experimental and discouraged at this time.

**Important**: your main module (via `input`) must start with a `/`. Also, multiple entry points is experimental and hasn't been tested yet.

### `bundleConfig.output`

- Type: `object`
- Required

Rollup output options. See [this page](https://rollupjs.org/guide/en/#outputoptions-object) from rollup docs for details. The only options that are supported are: `file`, `format`, `globals` and `name`. Using anything else is experimental and discouraged at this time.

Note on `format`: only `iife` is supported at this time. Using any other bundle format is experimental.

### `bundleConfig.babel`

- Type: `object`
- Optional

Enables babel via core babel [plugin](https://github.com/rollup/plugins/blob/master/packages/babel). The object is passed to the core babel plugin which get passed to Babel. Only the `babelHelpers` option is supported at this time; using any other options for the rollup core babel plugin is experimental.

### `bundleConfig.plugins`

- Type: `string[]|(string,object)[]`
- Optional
- Experimental: Caution! Not all rollup plugins work with the `webdeploy` subsystem

Enables additional rollup plugins to be injected into the input and output phases. Plugins are loaded by package name. If you pass a tuple, the first element is the package name and the second is the options object to pass to create the plugin instance.

Example:
~~~js
plugins: [
  ["@rollup/plugin-commonjs",{
    include: [/deepmerge|raf|is-promise|fuzzysearch|is-firefox|performance-now/],
    ignoreGlobal: true
  }]
]
~~~

### `bundleConfig.source`

- Type: `object`
- Optional

Enables source bundle compilation. This is an auxiliary bundle that is generated alongside your JavaScript bundle. The bundle is generated as the concatenation of the code from one or more modules. This is primarily useful for bundling CSS and should be preferred over other rollup plugins that do the same thing.

The object has the form `{ output: "<BUNDLE>", match: "<GLOB>" }`. The `output` property defines the name of the output target created for the source bundle. The `match` property is a scalar or list of glob patterns used to match files to include in the source bundle.

Example: Generate a CSS bundle:
~~~js
source: {
  output: 'dist/app.css',
  match: '**/*.css'
}
~~~

### `bundleConfig.nodeEnv`

- Type: `boolean|object`
- Optional

Enables `NODE_ENV` injection. If this is `true`, then `process.env` will be defined with `NODE_ENV` set to `development` or `production` based on `webdeploy` build type. If you provide an object, then additional key-value pairs from the object will be added to `process.env`.

When rollup writes out the bundle, it will contain a bit of code defining `process.env`. The code attempts to merge `process.env` if it already exists.

## Config: `build`

- Type: `array`
- Optional

This is an array of build handlers having the same format as core `webdeploy` `includes`. These build handlers are executed on all bundle targets created by the plugin.

## Config: `manifest`

If you need to generate a manifest, then you can provide a `manifest` section. When a `manifest` is enabled, the plugin will chain to [`@webdeploy/plugin-manfest`](https://www.npmjs.com/package/@webdeploy/plugin-manifest) instead of just writing out the files. References to bundles (either generated or referenced via the Bundles Extension) are forwarded to the manifest extension.

This config object is passed to the `manifest` plugin. Every property is respected except `refs` which are set by the rollup plugin.

## Example Config

Here's an example config for a Vue.js project. In this example, all of the modules live under `src/`. This build compiles the app into two bundles: `dist/app.js` and `dist/app.css`. In production, the bundles are passed to the `minify` plugin for compression. Finally, an HTML manifest is generated that contains references to the bundles under `dist/`.

~~~js
const loader = {
  prefix: "src",
  extensions: [".vue.js",".js",".vue.css",".css"],
  include: [
    'src/**'
  ],
  index: ["index.js","index.vue.js"],
  nodeModules: true
};
const bundles = [
  {
    input: {
      input: '/main'
    },
    output: {
      file: 'dist/app.js',
      format: 'iife'
    },
    source: {
      output: 'dist/app.css',
      match: '**/*.css'
    },
    babel: {
      babelHelpers: "bundled",
      presets: [
        "@babel/env"
      ]
    }
  }
];
const config = {
  id: "rollup",
  loader,
  bundles,
  manifest: {
    output: "index.html",
    manifest: {
      type: "html",
      template: "index.html.template"
    },
    groups: {
      styles: "**/*.css",
      scripts: "**/*.js"
    }
  }
};
module.exports = {
  build: {
    ...config
  },
  deploy: {
    ...config,
    build: [
      {
        id: "minify",
        rename: false
      }
    ]
  },
  includes: [
    {
      match: "src/**/*.vue",
      handlers: [
        {
          id: "vuejs",
          dev: true
        }
      ]
    },
    {
      match: [
        "src/**",
        "index.html.template"
      ]
    }
  ]
};
~~~

## Bundles Extension

We've created a non-standardized specification for distributing bundles that is implemented by this deploy plugin. This allows you to inject pre-compiled bundles into your application in both development and production. Production builds can reference a remote URL of the asset instead of the local one installed under `node_modules`.

It works by adding a `bundles` (or `bundle`) property to your `package.json` file. When you `import` a module from your bundle package, the plugin will see it has a `bundles` property in the `package.json`, and the loader will automatically virtualize the imported module so that imports are pulled from the external asset. The bundle global is added to `output.globals` so that it can be referenced by the application bundle. Instead of loading the file specified by `module`, the loader creates a virtual module based on the metadata provided under `bundles`. This includes `imports` and `exports`. Every bundle always provides a default export, which just resolves to the bundle exports object.

When a bundle is loaded, a reference to it is injected into the manifest. The reference can either be `local` for development builds or `remote` for production. The `remote` reference can be a URL that points to a CDN or asset server that distributes your bundles. If you load multiple bundles in a project, the plugin will order the references based on `import` order so that bundles are loaded in the correct order. You can also specify `imports` in your `bundles` section to denote any prerequisites. (Prerequisites in this case refer to other bundle packages.)

Example `package.json`:

~~~json
{
  "name": "@myorg/mybundle",
  "description": "An important bundle",
  "version": "1.0.3",
  "module": "main.js",
  "files": [
    "main.js",
    "dist/**"
  ],
  "bundles": {
    "refs": [
      {
        "local": "dist/bundle.js",
        "remote": "https://cdn.myorg.example.com/mybundle/1.0.3/mybundle.js"
      },
      {
        "local": "dist/bundle.css",
        "remote": "https://cdn.myorg.example.com/mybundle/1.0.3/mybundle.css"
      }
    ],
    "global": "$thing",
    "imports": [
      "@myorg/vue"
    ],
    "exports": [
      "Library",
      "dateFns",
      "fuzzysearch"
    ]
  }
}
~~~

When `@myorg/mybundle` is loaded, it is transformed into a virtual module like so:

~~~js
import "@myorg/vue";
export { default } from "\0bundle:mybundle";
export { Library, dateFns, fuzzysearch } from "\0bundle:mybundle";
~~~
The virtual module is what gets marked as external and will be replaced with references to the bundle `global`.

Note: you have to provide a valid `module` or `main` property in your `package.json` in order to "trick" the resolver into resolving the `node_modules` import. This can either just point to one of your bundle's distribution files or to a dummy file. In the example above, `main.js` is just a dummy file included in the package having the following contents:

~~~js
export default {};
~~~

