// Originally from https://github.com/mafintosh/recursive-watch/blob/master/index.js
// But, that version only called watch once, so I've modified it to not check
// for same-ness.
// TODO also check queue?  Or maybe it's my code, hm.

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
  var prev = null
  var prevTime = 0

  var w = fs.watch(filename, function () {
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
  var queued = []

  visit('.', function () {
    loaded = true
  })

  return function () {
    Object.keys(watching).forEach(function (dir) {
      watching[dir].close()
    })
  }

  function emit (name) {
    queued.push(name)
    if (queued.length === 1) update()
  }

  function update () {
    var filename = queued[0]

    fs.lstat(filename, function (err, st) {
      var w = watching[filename]

      if (err && w) {
        w.close()
        delete watching[filename]
      }

      onchange(filename)

      visit(path.relative(directory, filename), function () {
        queued.shift()
        if (queued.length) update()
      })
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
        emit(path.join(directory, filename))
      })

      w.on('error', noop)
      watching[dir] = w

      fs.readdir(dir, function (err, list) {
        if (err) return cb(err)

        loop()

        function loop () {
          if (!list.length) return cb()
          visit(path.join(next, list.shift()), loop)
        }
      })
    })
  }
}

function noop () {}

