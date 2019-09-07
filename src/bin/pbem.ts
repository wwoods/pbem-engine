/**
 *
//Setup project -> run "vue *args" from there.
//Setup should A) check version.  If pbem version newer, re-make.
//B) compare pbem-config.json to existing config files; update + npm install packages.
//Do pass-and-play first!
 * */

import assert from 'assert';
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const pbem_folder = "build";
const pbem_client_folder = path.join(pbem_folder, "client");

program
  .version(require('../../package').version)
  .usage('<command> [options]')
  ;

program
  .command('serve')
  .description('serve the pbem-engine application in development mode')
  .action((name: any, cmd: any) => {
    const cfg = './pbem-config.json';
    assert(fs.existsSync(cfg), `No such file: ${cfg}`);

    const config = JSON.parse(fs.readFileSync(cfg));

    const vue = require('../ui-app/vue/index');
    vue.setup(pbem_client_folder, config);

    //TODO .gitignore build

    execFileSync('npm', ['run', 'serve'], {
      cwd: pbem_client_folder,
      stdio: 'inherit',
    });
  })
;

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

