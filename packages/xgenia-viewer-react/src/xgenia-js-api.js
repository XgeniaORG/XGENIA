'use strict';

import { SeoApi } from './api/seo';

export default function createXgeniaAPI(xgeniaRuntime) {
  // Support SSR
  const global = typeof window !== 'undefined' ? window : globalThis;

  global.XGENIA.getProjectSettings = xgeniaRuntime.getProjectSettings.bind(xgeniaRuntime);
  global.XGENIA.getMetaData = xgeniaRuntime.getMetaData.bind(xgeniaRuntime);
  global.XGENIA.Collection = global.XGENIA.Array = require('@xgenia/runtime/src/collection');
  global.XGENIA.Model = global.XGENIA.Object = require('@xgenia/runtime/src/model');
  // '--ndl--global-variables' is the store EVERY variable node actually uses
  // (setvariablenode.js, variablenode2.js, variablenode.js). The rebrand renamed only
  // this handle to '--xgenia--global-variables', splitting the public API onto a dead,
  // always-empty model: XGENIA.Variables reads saw nothing, and writes were invisible
  // to Variable/Set Variable nodes (trace 1784502460845).
  global.XGENIA.Variables = global.XGENIA.Object.get('--ndl--global-variables');
  global.XGENIA.Events = global.XGENIA.eventEmitter = xgeniaRuntime.context.eventSenderEmitter;
  global.XGENIA.Records = require('@xgenia/runtime/src/api/records')();
  global.XGENIA.Users = require('./api/users');
  global.XGENIA.CloudFunctions = require('./api/cloudfunctions');
  global.XGENIA.Navigation = require('./api/navigation');
  global.XGENIA.Navigation._xgeniaRuntime = xgeniaRuntime;
  global.XGENIA.Files = require('./api/files');
  global.XGENIA.SEO = new SeoApi();
  if (!global.XGENIA.Env) {
    global.XGENIA.Env = {};
  }

  global.XGENIA.Arrays = new Proxy(global.XGENIA.Array, {
    get(target, prop, receiver) {
      return XGENIA.Array.get(prop);
    },
    set(obj, prop, value) {
      if (!Array.isArray(value)) {
        throw new Error('Cannot assign non array value to array with id ' + prop);
      }
      XGENIA.Array.get(prop).set(value);
    }
  });

  global.XGENIA.Objects = new Proxy(global.XGENIA.Object, {
    get(target, prop, receiver) {
      return XGENIA.Object.get(prop);
    },
    set(obj, prop, value) {
      XGENIA.Object.get(prop).setAll(value);
    }
  });
}
