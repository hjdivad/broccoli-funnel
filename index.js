'use strict';

var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var walkSync = require('walk-sync-matcher');
var Minimatch = require('minimatch').Minimatch;
var arrayEqual = require('array-equal');
var Plugin = require('broccoli-plugin');
var symlinkOrCopy = require('symlink-or-copy');
var debug = require('debug');
var FSTree = require('./fs-tree');
var rimraf = require('rimraf');

function makeDictionary() {
  var cache = Object.create(null);

  cache['_dict'] = null;
  delete cache['_dict'];
  return cache;
}

Funnel.prototype = Object.create(Plugin.prototype);
Funnel.prototype.constructor = Funnel;
function Funnel(inputNode, options) {
  if (!(this instanceof Funnel)) { return new Funnel(inputNode, options); }

  Plugin.call(this, [inputNode]);

  this._persistentOutput = true;

  this._includeFileCache = makeDictionary();
  this._destinationPathCache = makeDictionary();
  this._fsTree = new FSTree();

  var keys = Object.keys(options || {});
  for (var i = 0, l = keys.length; i < l; i++) {
    var key = keys[i];
    this[key] = options[key];
  }

  this.destDir = this.destDir || '/';
  this.count = 0;

  if (this.files && typeof this.files === 'function') {
    // Save dynamic files func as a different variable and let the rest of the code
    // still assume that this.files is always an array.
    this._dynamicFilesFunc = this.files;
    delete this.files;
  } else if (this.files && !Array.isArray(this.files)) {
    throw new Error('Invalid files option, it must be an array or function (that returns an array).');
  }

  if ((this.files || this._dynamicFilesFunc) && (this.include || this.exclude)) {
    throw new Error('Cannot pass files option (array or function) and a include/exlude filter. You can only have one or the other');
  }

  this._setupFilter('include');
  this._setupFilter('exclude');

  this._matchedWalk = this.include && this.include.filter(function(a) {
    return a instanceof Minimatch;
  }).length === this.include.length;

  this._instantiatedStack = (new Error()).stack;
  this._buildStart = undefined;
}

Funnel.prototype._debug = function(message) {
  debug('broccoli-funnel:' + (this.description || this.name || this.constructor.name)).apply(null, arguments);
};

Funnel.prototype._setupFilter = function(type) {
  if (!this[type]) {
    return;
  }

  if (!Array.isArray(this[type])) {
    throw new Error('Invalid ' + type + ' option, it must be an array. You specified `' + typeof this[type] + '`.');
  }

  // Clone the filter array so we are not mutating an external variable
  var filters = this[type] = this[type].slice(0);

  for (var i = 0, l = filters.length; i < l; i++) {
    filters[i] = this._processPattern(filters[i]);
  }
};

Funnel.prototype._processPattern = function(pattern) {
  if (pattern instanceof RegExp) {
    return pattern;
  }

  var type = typeof pattern;

  if (type === 'string') {
    return new Minimatch(pattern);
  }

  if (type === 'function') {
    return pattern;
  }

  throw new Error('include/exclude patterns can be a RegExp, glob string, or function. You supplied `' + typeof pattern +'`.');
};

Funnel.prototype.shouldLinkRoots = function() {
  return !this.files && !this.include && !this.exclude && !this.getDestinationPath;
};

Funnel.prototype.build = function() {
  this._buildStart = new Date();
  this.destPath = path.join(this.outputPath, this.destDir);
  if (this.destPath[this.destPath.length -1] === '/') {
    this.destPath = this.destPath.slice(0, -1);
  }

  var inputPath = this.inputPaths[0];
  if (this.srcDir) {
    inputPath = path.join(inputPath, this.srcDir);
  }

  if (this._dynamicFilesFunc) {
    this.lastFiles = this.files;
    this.files = this._dynamicFilesFunc() || [];

    // Blow away the include cache if the list of files is new
    if (this.lastFiles !== undefined && !arrayEqual(this.lastFiles, this.files)) {
      this._includeFileCache = makeDictionary();
    }
  }

  var linkedRoots = false;
  if (this.shouldLinkRoots()) {
    linkedRoots = true;
    if (fs.existsSync(inputPath)) {
      rimraf.sync(this.outputPath);
      this._copy(inputPath, this.destPath);
    } else if (this.allowEmpty) {
      mkdirp.sync(this.destPath);
    }
  } else {
    this.processFilters(inputPath);
  }

  this._debug('build, %o', {
    in: new Date() - this._buildStart + 'ms',
    linkedRoots: linkedRoots,
    inputPath: inputPath,
    destPath: this.destPath
  });
};

Funnel.prototype.processFilters = function(inputPath) {
  var files;

  if (this.files && !this.exclude && !this.include) {
    files = this.files.slice(0); //clone to be compatible with walkSync
  } else {
    if (this._matchedWalk) {
      files = walkSync(inputPath, undefined, this.include);
    } else {
      files = walkSync(inputPath);
    }
  }

  var destRelativePath, fullInputPath, fullOutputPath;

  var nextTree = new FSTree({
    files: files.filter(this.includeFile, this)
  });

  // [
  //  ["rm", "./lib/foo.js"],
  //  ["rm", "./lib/foo2.js"],
  //  ["create", "./lib/qq.js"],
  //  ["create", "./lib/shazam.js"],
  // ]
  var patch = this._fsTree.calculatePatch(nextTree);
  this._fsTree = nextTree;
  var removes = patch.filter(function(entry) { return entry[0] === 'rm'; }).map(byPath);
  var adds    = patch.filter(function(entry) { return entry[0] === 'create'; }).map(byPath);

  function byPath(operation) {
    return operation[1];
  }


  function prependPath(outputPath) {
    return function(path) {
      return outputPath + '/' + path;
    };
  }

  removes.map(prependPath(this.outputPath)).forEach(function(path) {
    rimraf.sync(path);
  });

  adds.map(function(relativePath) {
    fullInputPath    = path.join(inputPath, relativePath);
    destRelativePath = this.lookupDestinationPath(relativePath);
    fullOutputPath   = path.join(this.destPath, destRelativePath);

    this.processFile(fullInputPath, fullOutputPath, relativePath);
  }, this);


  // TODO: do work and then update this._fsTree( files )

  var count = nextTree.size;

  this._debug('processFilters %o', {
    in: new Date() - this._buildStart + 'ms',
    filesFound: files.length,
    filesProcessed: count,
    inputPath: inputPath,
    destPath: this.destPath
  });
};

Funnel.prototype.lookupDestinationPath = function(relativePath) {
  if (this._destinationPathCache[relativePath] !== undefined) {
    return this._destinationPathCache[relativePath];
  }

  if (this.getDestinationPath) {
    return this._destinationPathCache[relativePath] = this.getDestinationPath(relativePath);
  }

  return this._destinationPathCache[relativePath] = relativePath;
};

Funnel.prototype.includeFile = function(relativePath) {
  var includeFileCache = this._includeFileCache;

  if (includeFileCache[relativePath] !== undefined) {
    return includeFileCache[relativePath];
  }

  // do not include directories, only files
  if (relativePath[relativePath.length - 1] === '/') {
    return includeFileCache[relativePath] = false;
  }

  var i, l, pattern;

  // Check for specific files listing
  if (this.files) {
    return includeFileCache[relativePath] = this.files.indexOf(relativePath) > -1;
  }

  // Check exclude patterns
  if (this.exclude) {
    for (i = 0, l = this.exclude.length; i < l; i++) {
      // An exclude pattern that returns true should be ignored
      pattern = this.exclude[i];

      if (this._matchesPattern(pattern, relativePath)) {
        return includeFileCache[relativePath] = false;
      }
    }
  }

  // Check include patterns
  if (this.include && this.include.length > 0) {
    for (i = 0, l = this.include.length; i < l; i++) {
      // An include pattern that returns true (and wasn't excluded at all)
      // should _not_ be ignored
      pattern = this.include[i];

      if (this._matchesPattern(pattern, relativePath)) {
        return includeFileCache[relativePath] = true;
      }
    }

    // If no include patterns were matched, ignore this file.
    return includeFileCache[relativePath] = false;
  }

  // Otherwise, don't ignore this file
  return includeFileCache[relativePath] = true;
};

Funnel.prototype._matchesPattern = function(pattern, relativePath) {
  if (pattern instanceof RegExp) {
    return pattern.test(relativePath);
  } else if (pattern instanceof Minimatch) {
    return pattern.match(relativePath);
  } else if (typeof pattern === 'function') {
    return pattern(relativePath);
  }

  throw new Error('Pattern `' + pattern + '` was not a RegExp, Glob, or Function.');
};

Funnel.prototype.processFile = function(sourcePath, destPath /*, relativePath */) {
  this._copy(sourcePath, destPath);
};

Funnel.prototype._copy = function(sourcePath, destPath) {
  var destDir  = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    mkdirp.sync(destDir);
  }

  symlinkOrCopy.sync(sourcePath, destPath);
};

module.exports = Funnel;
