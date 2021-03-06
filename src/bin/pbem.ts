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

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  // application specific logging, throwing an error, or other logic here
});

program
  .version(require('../../package').version)
  .usage('<command> [options]')
  ;

program
  .command('serve')
  .description('serve the pbem-engine application in development mode')
  .option('--clean', 'do not re-use existing build')
  .option('--vue-debug', "debug pbem-engine's vue template")
  .option('--production', 'compile UI; needed for e.g. PWA.  Will override '
    + 'NODE_ENV environment variable.')
  .action((cmd: any) => {
    const buildResult = _gameBuild({
        clean: cmd.opts().clean,
        production: cmd.opts().production,
        vueDebug: cmd.opts().vueDebug,
    });

    const p = require('../webserver').run(pbem_client_folder,
        buildResult.webApp, buildResult.db);
    p.catch((e: any) => {
      console.error(e);
      process.exit(1);
    });
  })
;


function _gameBuild(gameConfig: {clean?: boolean, production?: boolean,
    vueDebug?: boolean}) {
  const cfg = './pbem-config.json';
  assert(fs.existsSync(cfg), `No such file: ${cfg}`);
  const config = JSON.parse(fs.readFileSync(cfg));

  if (gameConfig.clean) {
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
  if (gameConfig.vueDebug) {
    // TODO currently, even with --vue-debug, which would be better named
    // --pbem-debug...
    // One must run "npm run build" to update the pbem source code modules
    // when debugging client code. That's a pain. We should additionally put
    // a watch on the `src` folder, and run "npm run build" once a change is
    // detected. Additionally, changes to the `src` folder should _NOT_ trigger
    // Vue's intrinsic hot reload on the client application, which is a bit
    // of a challenge.
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
  let webApp: number | string;

  if (!gameConfig.production && process.env.NODE_ENV !== 'production') {
    webApp = process.env.PORT ? parseInt(process.env.PORT) - 1 : 8079;
    const server = spawn('npx',
      ['--no-install', 'vue-cli-service', 'serve', '--port', webApp.toString()],
      {
        cwd: pbem_client_folder,
        stdio: 'inherit',
      },
    );
    server.on('close', (code: number) => {
      for (const w of watchers) {
        w();
      }

      process.exitCode = code;
    });
    process.on('exit', () => {
      server.kill();
    });
    const cleanExit = () => { process.exit(); };
    process.on('SIGINT', cleanExit); // ctrl+c
    process.on('SIGTERM', cleanExit); // kill
  }
  else {
    webApp = path.join(pbem_client_folder, 'dist');
    execFileSync('npm', ['run', 'build'], {
      cwd: pbem_client_folder,
      stdio: 'inherit',
    });
    // Note that real PWA requires HTTPS cert, or a local device proxy
    // TODO ensure ~/.https-serve... rename that folder?
    // (mkdir -p $HOME/.https-serve/ && cd $HOME/.https-serve/ && sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.crt)
    // PWA needs trusted? https://certbot.eff.org/lets-encrypt/ubuntubionic-other
    // OR use local device proxy https://stackoverflow.com/a/43426714/160205
  }

  let db: string;
  if (!config.db) {
    db = 'local';//./build/pbem-db/';
  }
  else {
    db = config.db;
  }

  return {db, webApp};
}


function _gameFilesGetPaths() {
  const paths = new Array<string>();

  //Copy in the "game" and "ui" contents.
  const gamePath = fs.existsSync("game.ts") ? "game.ts" : "game";
  paths.push(gamePath);
  const uiPath = fs.existsSync("ui.ts") ? "ui.ts" : "ui";
  paths.push(uiPath);

  // Optional "test" folder.
  const testPath = fs.existsSync("test") ? "test" : "";
  if (testPath) {
    paths.push(testPath);
  }
  return paths;
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

