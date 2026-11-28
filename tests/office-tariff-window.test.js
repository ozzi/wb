#!/usr/bin/env node
// Проверка тарифных зон rules/office-tariff-window.js без контроллера.
//
// Запуск: node tests/office-tariff-window.test.js
// Зависимостей нет: assert встроен в Node, глобалы wb-rules подменяются
// заглушками до require(), иначе правило упадёт на defineVirtualDevice.
//
// Зоны — трёхзонный тариф, согласованный с владельцем:
//   пик      08:00-11:00, 20:00-22:00
//   полупик  07:00-08:00, 11:00-20:00, 22:00-23:00
//   ночь     23:00-07:00
// Поменялись границы — меняется расчёт, и тест падает осознанно.

var assert = require("assert");
var path = require("path");

var dev = {};
global.dev = dev;
global.defineVirtualDevice = function (name, cfg) { dev["__def_" + name] = cfg; };
global.defineRule = function () {};
global.cron = function () { return function () {}; };
global.setInterval = function () { return 0; };
global.log = { info: function () {}, warning: function () {}, error: function () {} };

var RULE = path.join(__dirname, "..", "rules", "office-tariff-window.js");
var m = require(RULE);

var failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function zone(hhmm) {
  var p = hhmm.split(":");
  return m.zoneAt(parseInt(p[0], 10) * 60 + parseInt(p[1], 10));
}

console.log("Тарифные зоны:");

check("07:00 — полупик (начало полупика)", function () {
  assert.strictEqual(zone("07:00"), "полупик");
});
check("07:59 — полупик", function () {
  assert.strictEqual(zone("07:59"), "полупик");
});
check("08:00 — пик (начало пика)", function () {
  assert.strictEqual(zone("08:00"), "пик");
});
check("10:59 — пик", function () {
  assert.strictEqual(zone("10:59"), "пик");
});
check("11:00 — полупик (конец пика)", function () {
  assert.strictEqual(zone("11:00"), "полупик");
});
check("19:59 — полупик", function () {
  assert.strictEqual(zone("19:59"), "полупик");
});
check("20:00 — пик (вечерний)", function () {
  assert.strictEqual(zone("20:00"), "пик");
});
check("21:59 — пик", function () {
  assert.strictEqual(zone("21:59"), "пик");
});
check("22:00 — полупик (конец вечернего пика)", function () {
  assert.strictEqual(zone("22:00"), "полупик");
});
check("22:59 — полупик", function () {
  assert.strictEqual(zone("22:59"), "полупик");
});
check("23:00 — ночь (начало ночи)", function () {
  assert.strictEqual(zone("23:00"), "ночь");
});
check("00:00 — ночь", function () {
  assert.strictEqual(zone("00:00"), "ночь");
});
check("06:59 — ночь (конец ночи)", function () {
  assert.strictEqual(zone("06:59"), "ночь");
});

console.log("Следующее переключение:");

check("в пике 08:30 — ближайшая граница 11:00, нагрев разрешается", function () {
  var n = m.nextSwitch(8 * 60 + 30);
  assert.strictEqual(n.minutes, 11 * 60);
  assert.strictEqual(n.heat, true);
  assert.strictEqual(n.heatNow, false);
});
check("в полупике 19:00 — ближайшая граница 20:00, нагрев запрещается", function () {
  var n = m.nextSwitch(19 * 60);
  assert.strictEqual(n.minutes, 20 * 60);
  assert.strictEqual(n.heat, false);
  assert.strictEqual(n.heatNow, true);
});
check("в полупике 22:30 — границ до конца суток нет", function () {
  assert.strictEqual(m.nextSwitch(22 * 60 + 30), null);
});
check("в ночи 23:30 — границ до конца суток нет", function () {
  assert.strictEqual(m.nextSwitch(23 * 60 + 30), null);
});

console.log("Длительность пика за сутки:");

check("суммарно 5 часов пика (300 мин)", function () {
  var total = 0;
  for (var i = 0; i < m.PEAK.length; i++) {
    total += m.PEAK[i][1] - m.PEAK[i][0];
  }
  assert.strictEqual(total, 300);
});

if (failures > 0) {
  console.log("\n" + failures + " проверок провалено");
  process.exit(1);
}
console.log("\nвсе проверки пройдены");
