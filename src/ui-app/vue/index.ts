
import assert from 'assert';
import {execFileSync} from 'child_process';
import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import rimraf from 'rimraf';
import {fileURLToPath} from 'url';

//Remember, path relative to typescript-built "lib" folder.
const pbemVueTemplate = path.join(path.dirname(__filename), "../../../src/ui-app/vue/template");

const pbemExtra = path.join(path.dirname(__filename), "../../../src/extra");

const pbemEnginePackage = path.join(path.dirname(__filename), "../../../");

/*
const vueAppConfig = {
  "useConfigFiles": false,
  "plugins": {
    "@vue/cli-plugin-typescript": {
      "classComponent": false,
      "tsLint": true,
      "lintOn": [
        "save"
      ]
    },
    "@vue/cli-plugin-pwa": {}
  },
  "router": true,
  "routerHistoryMode": true,
  "cssPreprocessor": "dart-sass"
};*/

export type Config = any;

export function setup(buildPath: string, config: Config) {
  const cfgTemplate: any = JSON.parse(fs.readFileSync(path.join(pbemVueTemplate,
      "package.json"), 'utf8'));

  let cfg: any = undefined;
  const cfgPath = path.join(buildPath, "package.json");
  if (fs.existsSync(cfgPath)) {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }

  if (cfg === undefined || cfg.org_pbem.version < cfgTemplate.org_pbem.version) {
    rimraf.sync(buildPath);

    const cwd = path.dirname(buildPath);
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd);
    }

    fsExtra.copySync(pbemVueTemplate, buildPath);

    //Make pbem-engine available, which the template requires but we want to
    //make sure that the version installed for the build matches the local
    //version.
    execFileSync('npm', ['install', '--no-audit', pbemEnginePackage], {
      cwd: buildPath,
      stdio: 'inherit',
    });

    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }

  //TODO this should be non-vue-specific, I presume.
  checkPackageConfig(buildPath, cfg, config);

  {
    const jsonPath = path.join(buildPath, 'public', 'manifest.json');
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    jsonData.name = cfg.description;
    jsonData.short_name = cfg.description;
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
  }
}


function checkPackageConfig(buildPath: string, cfg: any, pbemCfg: Config) {
  let dirty: boolean = false;

  //Ensure game + ui packages are properly setup.
  function depCheck(src: any, dst: any) {
    if (src === undefined) return;

    for (let i of Object.keys(src)) {
      if (dst[i] !== src[i]) {
        dst[i] = src[i];
        dirty = true;
      }
    }
  }

  for (const i of Object.keys(pbemCfg)) {
    if (i === "name") {
      // Since node complains if "name" isn't a valid identifier, populate the
      // "description" field instead.
      if (cfg.description !== pbemCfg[i]) {
        dirty = true;
        cfg.description = pbemCfg[i];
      }
    }
    else if (i === "version") {
      if (cfg[i] !== pbemCfg[i]) {
        dirty = true;
        cfg[i] = pbemCfg[i];
      }
    }
    else if (i === "pbem-extra") {
      // See that all extras UI packages are installed
      const cc = cfg[i] || [];
      const pc = pbemCfg[i] || [];
      if (cc.join(',,,') !== pc.join(',,,')) {
        dirty = true;
        cfg[i] = pbemCfg[i];

        const extraPath = path.join(buildPath, 'src', 'components',
            'defaults', 'extra');
        rimraf.sync(extraPath);

        fs.mkdirSync(extraPath);
        const plugs = [];
        for (const extra of pc) {
          const vueSrc = path.join(pbemExtra, extra, 'vue');
          if (fs.existsSync(vueSrc)) {
            fsExtra.copySync(vueSrc, path.join(extraPath, extra));
            plugs.push(extra);
          }
        }
        const imports = plugs.map(x => `import ${x} from './${x}';`);
        const installs = plugs.map(x => `${x}.install(Vue, options);`);
        fs.writeFileSync(path.join(extraPath, 'index.ts'), `
            /** Auto-generated for plugins from pbem-config.json */
            ${imports.join('\n')}
            const VuePlugin = {
              install(Vue: any, options: any) {
                ${installs.join('\n')}
              }
            };
            export default VuePlugin;
            `);
      }
    }
    else if (i === "game") {
      // Steal dependencies only, as they are probably required for state
      // transitions.
      depCheck(pbemCfg[i].dependences, cfg.dependencies);
      depCheck(pbemCfg[i].devDependences, cfg.devDependencies);
    }
    else if (i === "ui") {
      for (const j of Object.keys(pbemCfg[i])) {
        if (j === "dependencies" || j === "devDependencies") {
          depCheck(pbemCfg[i][j], cfg[j]);
        }
        else {
          assert(false, `Unrecognized key ${i} -> ${j}`);
        }
      }
    }
    else if (i === "tslint") {
      assert(Object.keys(pbemCfg[i]).length === 1,
        'tslint.rules only at the moment');
      assert(pbemCfg[i].rules !== undefined, 'tslint.rules only');

      const tslintPath = path.join(buildPath, "tslint.json");
      const tslintCfg = JSON.parse(fs.readFileSync(tslintPath, 'utf8'));
      for (const [j, v] of Object.entries(pbemCfg[i].rules)) {
        tslintCfg.rules[j] = v;
      }
      fs.writeFileSync(tslintPath, JSON.stringify(tslintCfg, null, 2));
    }
    else {
      assert(false, `Unrecognized key ${i}`);
    }
  }

  if (dirty) {
    const cfgPath = path.join(buildPath, "package.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    execFileSync('npm', ['install'], {
        cwd: buildPath,
        stdio: 'inherit',
    });
  }
}

