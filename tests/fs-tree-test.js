'use strict';

var expect = require('chai').expect;
var FSTree = require('../fs-tree');

var context = describe;
var fsTree;

describe('FSTree', function() {
  it('can be instantiated', function() {
    expect(new FSTree()).to.be.an.instanceOf(FSTree);
  });

  describe('.calculatePatch', function() {
    context('from an empty tree', function() {
      beforeEach( function() {
        fsTree = new FSTree();
      });

      context('to an empty tree', function() {
        it('returns 0 operations', function() {
          expect(fsTree.calculatePatch([])).to.deep.equal([]);
        });
      });

      context('to a non-empty tree', function() {
        it('returns n create operations', function() {
          expect(fsTree.calculatePatch([
            'bar/baz.js',
            'foo.js',
          ])).to.deep.equal([
            ['mkdir', 'bar'],
            ['create', 'foo.js'],
            ['create', 'bar/baz.js'],
          ]);
        });
      });
    });

    context('from a simple non-empty tree', function() {
      beforeEach( function() {
        fsTree = new FSTree({
          files: [
            'bar/baz.js',
            'foo.js',
          ],
        });
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch([])).to.deep.equal([
            ['unlink', 'bar/baz.js'],
            ['rmdir', 'bar'],
            ['unlink', 'foo.js'],
          ]);
        });
      });
    });

    context('from a non-empty tree', function() {
      beforeEach( function() {
        fsTree = new FSTree({
          files: [
            'foo/one.js',
            'foo/two.js',
            'bar/one.js',
            'bar/two.js',
          ],
        });
      });

      context('with removals', function() {
        it('reduces the rm operations', function() {
          expect(fsTree.calculatePatch([
            'bar/two.js'
          ])).to.deep.equal([
            ['unlink', 'foo/one.js'],
            ['unlink', 'foo/two.js'],
            ['unlink', 'bar/one.js'],
            ['rmdir',  'foo'],
          ]);
        });
      });

      context('with removals and additions', function() {
        it('reduces the rm operations', function() {
          expect(fsTree.calculatePatch([
            'bar/three.js'
          ])).to.deep.equal([
            ['unlink', 'foo/one.js'],
            ['unlink', 'foo/two.js'],
            ['unlink', 'bar/one.js'],
            ['unlink', 'bar/two.js'],
            ['rmdir', 'foo'],
            ['rmdir', 'bar'],
            ['mkdir', 'bar'],
            ['create', 'bar/three.js'],
          ]);
        });
      });
    });

    context('from a deep non-empty tree', function() {
      beforeEach( function() {
        fsTree = new FSTree({
          files: [
            'bar/quz/baz.js',
            'foo.js',
          ],
        });
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch([])).to.deep.equal([
            ['unlink', 'bar/quz/baz.js'],
            ['rmdir', 'bar/quz'],
            ['rmdir', 'bar'],
            ['unlink', 'foo.js'],
          ]);
        });
      });
    });

    context('from a deep non-empty tree \w intermediate entry', function() {
      beforeEach( function() {
        fsTree = new FSTree({
          files: [
            'bar/quz/baz.js',
            'bar/foo.js',
          ],
        });
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch([
            'bar/quz/baz.js'
          ])).to.deep.equal([
            ['unlink', 'bar/foo.js']
          ]);
        });
      });
    });

    context('asdf', function() {
      beforeEach( function() {
        fsTree = new FSTree({
          files: [
            'subdir1/subsubdir1/foo.png',
            'subdir2/bar.css'
          ],
        });
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch([
            'subdir1/subsubdir1/foo.png'
          ])).to.deep.equal([
            ['unlink', 'subdir2/bar.css'],
            ['rmdir',  'subdir2']
          ]);
        });
      });
    });
  });
});
