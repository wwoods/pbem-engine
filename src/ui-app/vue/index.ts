
import assert from 'assert';
import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import rimraf from 'rimraf';

const appVersion = 1;

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
};

// Run "vue create -i <json> <app name>"

export type Config = any;

export function setup(buildPath: string, config: Config) {
  let cfg: any = {};
  const cfgPath = path.join(buildPath, "package.json");
  if (fs.existsSync(cfgPath)) {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }

  let p: any = cfg ? cfg.org_pbem ? cfg.org_pbem.version !== undefined ? cfg.org_pbem.version : 0 : 0 : 0;
  if (p < appVersion) {
    rimraf.sync(buildPath);

    const cwd = path.dirname(buildPath);
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd);
    }

    const proj = path.basename(buildPath);
    execFileSync('vue', ['create', '-i', JSON.stringify(vueAppConfig), proj], {
        cwd: cwd,
        stdio: 'inherit',
    });

    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }

  //TODO this should be non-vue-specific, I presume.
  checkPackageConfig(buildPath, cfg, config);
}


function checkPackageConfig(buildPath: string, cfg: any, pbemCfg: Config) {
  let dirty: boolean = false;

  if (cfg.org_pbem === undefined
      || cfg.org_pbem.version !== appVersion) {
    dirty = true;
    cfg.org_pbem = { version: appVersion };
  }

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
    if (i === "name" || i === "version") {
      if (cfg[i] !== pbemCfg[i]) {
        dirty = true;
        cfg[i] = pbemCfg[i];
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

