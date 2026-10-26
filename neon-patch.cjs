// 2026-10-15: 劫持 @neondatabase/serverless 模块, 用 raw fetch 替代
// 加载方式: NODE_OPTIONS=--require=/path/neon-patch.cjs
//
// 必须 CommonJS (.cjs) 因为它通过 --require 加载, 在 server.js 启动前执行

const path = require('path');
const Module = require('module');

const NEON_MODULE_ID = '@neondatabase/serverless';
// 1. 预加载 shim 并塞进 require cache (path 是 absolute, 不需要 resolve)
const SHIM_PATH = path.join(__dirname, 'neon-shim.cjs');
const shim = require(SHIM_PATH);

// 2. 注入 require cache, 用 virtual filename, 任何 require('@neondatabase/serverless') 都会命中
require.cache[NEON_MODULE_ID] = {
  id: NEON_MODULE_ID,
  filename: NEON_MODULE_ID,
  loaded: true,
  exports: shim,
  paths: [],
  children: [],
};

// 3. Hook resolve: 任何 '@neondatabase/serverless' 或子路径请求都映射到 NEON_MODULE_ID
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === NEON_MODULE_ID || request.startsWith(NEON_MODULE_ID + '/')) {
    return NEON_MODULE_ID;
  }
  return origResolveFilename.call(this, request, parent, isMain, options);
};

console.log('[neon-patch] @neondatabase/serverless → shim loaded from', SHIM_PATH);