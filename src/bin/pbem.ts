/**
 *
//Setup project -> run "vue *args" from there.
//Setup should A) check version.  If pbem version newer, re-make.
//B) compare pbem-config.json to existing config files; update + npm install packages.
//Do pass-and-play first!
 * */

import assert from 'assert';
const {spawn} = require('child_process');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const program = require('commander');
const recursiveWatch = require('recursive-watch');
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

    //Copy in the "game" and "ui" contents.
    const gamePath = fs.existsSync("game.ts") ? "game.ts" : "game";
    const uiPath = fs.existsSync("ui.ts") ? "ui.ts" : "ui";

    const update = (src: string, dst: string) => {
      const epsilonMs = 1000;

      const srcStat = fs.statSync(src);
      if (srcStat.isFile()) {
        if (!fs.existsSync(dst)
            || fs.statSync(dst).mtimeMs + epsilonMs < srcStat.mtimeMs) {
          try {
            fsExtra.copySync(src, dst, {preserveTimestamps: true});
          }
          catch (e) {
            console.error(e);
          }
        }
      }
      else if (srcStat.isDirectory()) {
        fs.readdirSync(src)
          .map((name: string) => update(path.join(src, name), path.join(dst, name)));
      }
      else {
        console.log(`TODO ${srcStat}`);
      }
    };

    update(gamePath, path.join(pbem_client_src_folder, gamePath));
    update(uiPath, path.join(pbem_client_src_folder, uiPath));

    const watchers = new Array<any>();
    const updates = new Map<string, number>();
    for (const p of [gamePath, uiPath]) {
      watchers.push(recursiveWatch(p, (fpath: string) => {
        const now = Date.now();
        updates.set(fpath, now);
        const updateWatched = () => {
          if (updates.get(fpath) === now && fs.existsSync(fpath)) {
            update(fpath, path.join(pbem_client_src_folder, fpath));
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

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

