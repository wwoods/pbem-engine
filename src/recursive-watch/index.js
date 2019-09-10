// Originally from https://github.com/mafintosh/recursive-watch/blob/master/index.js
// But, that version only called watch once when watching a single file which
// is overwritten, so I've modified it for my own purposes.

var os = require('os')
var fs = require('fs')
var path = require('path')

var isLinux = os.platform() === 'linux' // native recursive watching not supported here
var watchDirectory = isLinux ? watchFallback : watchRecursive

module.exports = watch

function watch (name, onchange) {
  var clear = null
  var stopped = false

  fs.lstat(name, function (_, st) {
    if (!st || stopped) {
      stopped = true
      return
    }
    clear = st.isDirectory() ? watchDirectory(name, onchange) : watchFile(name, onchange)
  })

  return function () {
    if (stopped) return
    stopped = true
    if (clear) {
      clear()
    }
  }
}

function watchFile (filename, onchange) {
  // This function was originally wrong.  If using an editor like VIM, which
  // replaces the whole file, then fs.watch() will expire after the first
  // edit.  To fix this, we'll watch the directory containing our file of
  // interest, discarding all events which are not the file of interest.
  const dirname = path.dirname(filename);
  const basename = path.basename(filename);
  var w = fs.watch(dirname, function (type, fpath) {
    if (fpath !== filename) return;
    onchange(filename);
  })

  return function () {
    w.close()
  }
}

function watchRecursive (directory, onchange) {
  var w = fs.watch(directory, {recursive: true}, function (change, filename) {
    if (!filename) return // filename not always given (https://nodejs.org/api/fs.html#fs_filename_argument)
    onchange(path.join(directory, filename))
  })

  return function () {
    w.close()
  }
}

function watchFallback (directory, onchange) {
  var watching = {}
  var loaded = false

  visit('.', function () {
    loaded = true
  })

  return function () {
    Object.keys(watching).forEach(function (dir) {
      watching[dir].close()
    })
  }

  function update (filename) {
    onchange(filename)

    fs.lstat(filename, function (err, st) {
      if (err) {
        var w = watching[filename]
        if (w) {
          console.log(`recursive-watch: removing ${filename}: ${err}`);
          w.close()
          delete watching[filename]
        }
        return;
      }

      if (st.isDirectory()) {
        visit(path.relative(directory, filename));
      }
    })
  }

  function visit (next, cb) {
    var dir = path.join(directory, next)

    fs.lstat(dir, function (err, st) {
      if (err || !st.isDirectory()) return cb()
      if (watching[dir]) return cb()
      if (loaded) emit(dir)

      var w = fs.watch(dir, function (change, filename) {
        filename = path.join(next, filename)
        update(path.join(directory, filename))
      })

      w.on('error', logError)
      watching[dir] = w

      fs.readdir(dir, function (err, list) {
        if (err) {
          // Most likely does not exist.
          return cb()
        }

        loop()

        function loop () {
          if (!list.length) return cb();
          visit(path.join(next, list.shift()), loop)
        }
      })
    })
  }
}

function logError () {
  console.error(`recursive-watch: ${arguments.join(', ')}`);
}

