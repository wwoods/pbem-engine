/**
 *
//Setup project -> run "vue *args" from there.
//Setup should A) check version.  If pbem version newer, re-make.
//B) compare pbem-config.json to existing config files; update + npm install packages.
//Do pass-and-play first!
 * */

import assert from 'assert';
const {execFileSync, spawn} = require('child_process');
const fs = require('fs');
const fsExtra = require('fs-extra');
const os = require('os');
const path = require('path');
const program = require('commander');
const recursiveWatch = require('../recursive-watch');
const rimraf = require('rimraf');

const pbem_folder = "build";
const pbem_client_folder = path.join(pbem_folder, "client");
const pbem_client_src_folder = path.join(pbem_client_folder, "src");

program
  .version(require('../../package').version)
  .usage('<command> [options]')
  ;

program
  .command('serve')
  .description('serve the pbem-engine application in development mode')
  .option('--clean', 'do not re-use existing build')
  .option('--vue-debug', "debug pbem-engine's vue template")
  .action((cmd: any) => {
    const cfg = './pbem-config.json';
    assert(fs.existsSync(cfg), `No such file: ${cfg}`);
    const config = JSON.parse(fs.readFileSync(cfg));

    if (cmd.opts().clean) {
      console.log("Cleaning...");
      rimraf.sync(pbem_client_folder);
    }

    const vue = require('../ui-app/vue/index');
    vue.setup(pbem_client_folder, config);

    if (!fs.existsSync(".gitignore")) {
      fs.writeFileSync(".gitignore", "/build");
    }

    //Since e.g. webpack doesn't deal well with symlinks, we have to live-
    //copy the user's code into the project when it updates.
    const gamePaths = _gameFilesGetPaths();
    for (const g of gamePaths) {
      _gameFilesUpdate(g, pbem_client_src_folder, true);
    }

    const watchers = new Array<any>();
    const updates = new Map<string, number>();
    for (const p of gamePaths) {
      watchers.push(recursiveWatch(p, (fpath: string) => {
        const now = Date.now();
        updates.set(fpath, now);
        const updateWatched = () => {
          if (updates.get(fpath) === now && fs.existsSync(fpath)) {
            _gameFilesUpdate(fpath, pbem_client_src_folder);
          }
        };
        setTimeout(updateWatched, 10);
      }));
    }
    if (cmd.opts().vueDebug) {
      const templateSrc = path.join(__filename, '../../../src/ui-app/vue/template/src');
      watchers.push(recursiveWatch(templateSrc, (fpath: string) => {
        const now = Date.now();
        updates.set(fpath, now);
        const updateWatched = () => {
          if (updates.get(fpath) === now && fs.existsSync(fpath)) {
            const rel = path.relative(templateSrc, fpath);
            try {
              fsExtra.copySync(fpath, path.join(pbem_client_src_folder, rel), {
                  preserveTimestamps: true});
            }
            catch (e) {
              console.error(e);
            }
          }
        };
        setTimeout(updateWatched, 10);
      }));
    }

    // Cannot use execFileSync: need event loop for file watch.
    const server = spawn('npm', ['run', 'serve'], {
      cwd: pbem_client_folder,
      stdio: 'inherit',
    });
    server.on('close', (code: number) => {
      for (const w of watchers) {
        w();
      }

      process.exitCode = code;
    });
  })
;


program
  .command('serve-pwa')
  .description('build and serve the pbem-engine application in a way which may be downloaded as a PWA on a phone')
  .action((cmd: any) => {
    // TODO actually build project.. unify with serve code.  Allow --clean.

    for (const g of _gameFilesGetPaths()) {
      _gameFilesUpdate(g, pbem_client_src_folder, true);
    }
    
    execFileSync('npm', ['run', 'build'], {
      cwd: pbem_client_folder,
      stdio: 'inherit',
    });

    // Note that real PWA requires HTTPS cert, or a local device proxy
    // TODO ensure ~/.https-serve... rename that folder?
    // (mkdir -p $HOME/.https-serve/ && cd $HOME/.https-serve/ && sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.crt)
    // PWA needs trusted? https://certbot.eff.org/lets-encrypt/ubuntubionic-other
    // OR use local device proxy https://stackoverflow.com/a/43426714/160205
    execFileSync('npx', ['--no-install', 'serve', '-l', '8080', '-s', path.join(pbem_client_folder, 'dist')], {
      stdio: 'inherit',
    });
  })
;


program
  .command('run')
  .description('run the game in production mode.')
  .option('--clean', 'do not re-use existing build')
  .action((cmd: any) => {
    const cfg = './pbem-config.json';
    assert(fs.existsSync(cfg), `No such file: ${cfg}`);
    const config = JSON.parse(fs.readFileSync(cfg));

    if (cmd.opts().clean) {
      console.log("Cleaning...");
      rimraf.sync(pbem_client_folder);
    }

    const vue = require('../ui-app/vue/index');
    vue.setup(pbem_client_folder, config);

    // https://docs.couchdb.org/en/2.1.2/best-practices/nginx.html#reverse-proxying-couchdb-in-a-subdirectory-with-nginx
    for (const g of _gameFilesGetPaths()) {
      _gameFilesUpdate(g, pbem_client_src_folder, true);
    }

    execFileSync('npm', ['run', 'build'], {
      cwd: pbem_client_folder,
      stdio: 'inherit',
    });

    require('../webserver').run(path.join(pbem_client_folder, 'dist'), 
        config.db).catch(console.error);
  })
;


function _gameFilesGetPaths() {
  //Copy in the "game" and "ui" contents.
  const gamePath = fs.existsSync("game.ts") ? "game.ts" : "game";
  const uiPath = fs.existsSync("ui.ts") ? "ui.ts" : "ui";
  return [gamePath, uiPath];
}


function _gameFilesUpdate(srcFile: string, buildSrcFolder: string, startup: boolean = false) {
  const epsilonMs = startup ? 0 : 1000;
  const dst = path.join(buildSrcFolder, srcFile);

  const srcStat = fs.statSync(srcFile);
  if (srcStat.isFile()) {
    if (!fs.existsSync(dst)
        || fs.statSync(dst).mtimeMs + epsilonMs < srcStat.mtimeMs) {
      try {
        fsExtra.copySync(srcFile, dst, {preserveTimestamps: true});
      }
      catch (e) {
        console.error(e);
      }
    }
  }
  else if (srcStat.isDirectory()) {
    fs.readdirSync(srcFile)
      .map((name: string) => _gameFilesUpdate(path.join(srcFile, name),
        buildSrcFolder, startup));
  }
  else {
    console.log(`TODO ${srcStat}`);
  }
}


program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

