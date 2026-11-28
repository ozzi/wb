#!/usr/bin/env node
// Проверка rules/delta-temp.js без контроллера.
//
// Запуск: node tests/delta-temp.test.js
// Глобалы wb-rules подменяются заглушками до require(); часы не нужны —
// правило считает на изменении каналов.

var assert = require("assert");
var path = require("path");

var dev = {};
global.dev = dev;
global.publish = function () {};
global.log = { info: function () {}, warning: function () {}, error: function () {} };
global.defineVirtualDevice = function (name, cfg) { dev["__def_" + name] = cfg; };
global.defineRule = function (name, spec) { dev["__rule_" + name] = spec; };

var RULE = path.join(__dirname, "..", "rules", "delta-temp.js");
var m = require(RULE);

var failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}

// Каналы, которые правило создаёт у контура.
function cells(name) {
  var d = dev["__def_delta-temp-" + name];
  return d ? d.cells : null;
}

console.log("Раскладка каналов WB-MS v2:");

check("ТП 1Э берётся с bus1_temp1 / bus1_temp2", function () {
  var src = require("fs").readFileSync(RULE, "utf8");
  assert.ok(src.indexOf('"wb-ms_203/bus1_temp1"') !== -1, "подача ТП 1Э не на bus1_temp1");
  assert.ok(src.indexOf('"wb-ms_203/bus1_temp2"') !== -1, "обратка ТП 1Э не на bus1_temp2");
});
check("первичное кольцо берётся с bus2_temp1 / bus2_temp2", function () {
  var src = require("fs").readFileSync(RULE, "utf8");
  assert.ok(src.indexOf('"wb-ms_203/bus2_temp1"') !== -1, "подача кольца не на bus2_temp1");
  assert.ok(src.indexOf('"wb-ms_203/bus2_temp2"') !== -1, "обратка кольца не на bus2_temp2");
});
check("ТП 2Э остаётся на External Sensor 1/2", function () {
  var src = require("fs").readFileSync(RULE, "utf8");
  assert.ok(src.indexOf('"wb-ms_25/External Sensor 1"') !== -1);
  assert.ok(src.indexOf('"wb-ms_25/External Sensor 2"') !== -1);
});
check("создаются три контура: подъезд-1, кольцо, подъезд-2 не путаются", function () {
  assert.ok(cells("underfloor-1"), "нет контура underfloor-1");
  assert.ok(cells("primary-ring"), "нет контура primary-ring");
  assert.ok(cells("underfloor-2"), "нет контура underfloor-2");
});

console.log("Достоверность датчика:");

check("plausible: 0 — недостоверно (пустая ячейка шаблона)", function () {
  assert.strictEqual(m.plausible(0), false);
});
check("plausible: 0.0625 — честный ноль DS18B20, достоверно", function () {
  assert.strictEqual(m.plausible(0.0625), true);
});
check("plausible: границы диапазона −40…95", function () {
  assert.strictEqual(m.plausible(-40.1), false);
  assert.strictEqual(m.plausible(95.1), false);
  assert.strictEqual(m.plausible(45), true);
});
check("plausible: не число и NaN — недостоверно", function () {
  assert.strictEqual(m.plausible(undefined), false);
  assert.strictEqual(m.plausible(null), false);
  assert.strictEqual(m.plausible("12"), false);
  assert.strictEqual(m.plausible(NaN), false);
});

if (failures > 0) {
  console.log("\n" + failures + " проверок провалено");
  process.exit(1);
}
console.log("\nвсе проверки пройдены");
