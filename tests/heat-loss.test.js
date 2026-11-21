#!/usr/bin/env node
// Проверка модели теплопотерь rules/heat-loss.js без контроллера.
//
// Запуск: node tests/heat-loss.test.js
// Зависимостей нет: assert встроен в Node, глобалы wb-rules подменяются заглушками
// до require(), иначе правило упадёт на defineVirtualDevice раньше module.exports.
//
// Эталоны — не «правильные ответы физики», а зафиксированные значения модели после
// правок по аудиту (r=0.9, R пола без члена 2.1, ориентация, второй свет, вентиляция
// 170 м³/ч). Их смысл — поймать случайное изменение расчёта при будущих правках:
// поменялось число — тест падает, и это повод осознанно обновить эталон.

var assert = require("assert");
var path = require("path");

var dev = {};
global.dev = dev;
global.defineVirtualDevice = function (name, cfg) { dev["__def_" + name] = cfg; };
global.defineRule = function () {};
global.cron = function () { return function () {}; };

var RULE = path.join(__dirname, "..", "rules", "heat-loss.js");
var model = require(RULE);

var failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function close(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol,
    "получено " + actual.toFixed(2) + ", ожидалось " + expected + " ±" + tol);
}
function allRooms(t) {
  var m = {};
  for (var i = 0; i < model.ROOMS.length; i++) m[model.ROOMS[i].id] = t;
  return m;
}

console.log("heat-loss.js: модель без контроллера");

check("15 помещений в таблице", function () {
  assert.strictEqual(model.ROOMS.length, 15);
});

check("каналы: 44, без проектных proj-*", function () {
  var cells = Object.keys(dev["__def_heat-loss"].cells);
  assert.strictEqual(cells.length, 44);
  assert.deepStrictEqual(cells.filter(function (c) { return c.indexOf("proj") === 0; }), []);
});

check("-27 °C / 23 °C: 13 340 Вт, 68.8 Вт/м²", function () {
  var h = model.calcHouse(-27, allRooms(23));
  close(h.total, 13340, 1);
  close(h.perM2, 68.84, 0.01);
  close(h.floor1, 7957, 1);
  close(h.floor2, 5383, 1);
});

check("-15 °C / 24.5 °C: 10 696 Вт, 55.2 Вт/м²", function () {
  var h = model.calcHouse(-15, allRooms(24.5));
  close(h.total, 10696, 1);
  close(h.perM2, 55.19, 0.01);
});

check("0 °C / 23 °C: 6 410 Вт (ноль — законная уличная температура)", function () {
  var h = model.calcHouse(0, allRooms(23));
  close(h.total, 6410, 1);
});

check("+6.7 °C / 23 °C: 4 691 Вт", function () {
  var h = model.calcHouse(6.7, allRooms(23));
  close(h.total, 4691, 1);
});

check("спальня 1э север при -27/23: 1 393 Вт", function () {
  close(model.roomLoss(model.ROOMS[0], 23, -27).total, 1393, 1);
});

check("сумма по комнатам равна итогу дома", function () {
  var h = model.calcHouse(-20, allRooms(22));
  var sum = 0;
  for (var id in h.perRoom) sum += h.perRoom[id].total;
  close(sum, h.total, 0.01);
});

check("потери растут с понижением улицы и с ростом внутренней", function () {
  var warm = model.calcHouse(-5, allRooms(23)).total;
  var cold = model.calcHouse(-20, allRooms(23)).total;
  var hotter = model.calcHouse(-5, allRooms(25)).total;
  assert.ok(cold > warm, "при -20 должно быть больше, чем при -5");
  assert.ok(hotter > warm, "при 25 внутри должно быть больше, чем при 23");
});

check("доля вентиляции при -27 °C около 21.7 %", function () {
  var h = model.calcHouse(-27, allRooms(23));
  close(h.vent / h.total * 100, 21.7, 0.2);
});

check("помещение без данных считается по проектной температуре", function () {
  var h = model.calcHouse(-15, {});
  assert.strictEqual(h.onProject, 15);
  assert.ok(h.total > 0);
});

check("частичные данные: отсутствующие комнаты попадают в onProject", function () {
  var h = model.calcHouse(-15, { "gostinaya": 24 });
  assert.strictEqual(h.onProject, 14);
  close(h.perRoom["gostinaya"].total, model.roomLoss(model.ROOMS[7], 24, -15).total, 0.01);
});

console.log(failures === 0 ? "\nвсе проверки пройдены" : "\nпровалено проверок: " + failures);
process.exit(failures === 0 ? 0 : 1);
