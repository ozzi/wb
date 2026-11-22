#!/usr/bin/env node
// Проверка логики rules/scenario-keepalive.js без контроллера.
//
// Запуск: node tests/scenario-keepalive.test.js
// Зависимостей нет: assert встроен в Node, глобалы wb-rules (dev, log,
// PersistentStorage, defineVirtualDevice, defineRule, setInterval, getDevice)
// подменяются заглушками до require().
//
// Часы подменяются через Date.now: сценарии сценария-сторожа (прогрев,
// ожидание 5 минут, тормоз за 6 часов) иначе не проверить. Каждый сценарий
// получает свежий dev и store, поэтому тесты не влияют друг на друга.

var assert = require("assert");
var path = require("path");

var RULE = path.join(__dirname, "..", "rules", "scenario-keepalive.js");

var realNow = Date.now;
var clock = 0;

var OFFICE_ENABLED = "wbsc_office2/rule_enabled";
var OFFICE_ERR = "wb-m1w2_118/External Sensor 1#error";
var HEN_ENABLED = "wbsc_henhouse2/rule_enabled";
var HEN_ERR = "wb-m1w2_33/External Sensor 1#error";
var HEAT_ALLOWED = "kuryatnik-termo-dayoff/heating_allowed";

// Свежее окружение: заглушки wb-rules, пустые dev/store, загрузка правила.
function makeEnv() {
  var dev = {};
  var known = {};
  var store = {};
  var logs = [];
  var timers = [];
  var rules = {};

  clock = 1000000000000;   // фиксированная точка, чтобы эталоны были стабильны

  function add(topic, value) {
    known[topic] = true;
    dev[topic] = value;
  }

  global.dev = dev;
  global.log = {
    info: function (m) { logs.push("I " + m); },
    warning: function (m) { logs.push("W " + m); },
    error: function (m) { logs.push("E " + m); }
  };
  global.PersistentStorage = function () { return store; };
  global.defineVirtualDevice = function (id, spec) {
    for (var cell in spec.cells) {
      if (spec.cells.hasOwnProperty(cell)) {
        add(id + "/" + cell, spec.cells[cell].value);
      }
    }
  };
  global.defineRule = function (name, spec) { rules[name] = spec; };
  global.setInterval = function (fn) { timers.push(fn); return timers.length; };
  // Наличие контрола проверяется через getDevice().isControlExists(), как в wb-rules.
  global.getDevice = function (id) {
    var prefix = id + "/";
    for (var topic in known) {
      if (topic.indexOf(prefix) === 0) {
        return {
          isControlExists: function (ctrl) { return !!known[prefix + ctrl]; }
        };
      }
    }
    return undefined;
  };

  Date.now = function () { return clock; };

  delete require.cache[RULE];
  var rule = require(RULE);

  // Retained-значения, которые на контроллере приходят из MQTT.
  add(OFFICE_ENABLED, true);
  add("wb-m1w2_118/External Sensor 1", 21);
  add(OFFICE_ERR, "");
  add("wb-mr6cu_91/K1", false);
  add("wb-mr6cu_91/K1#error", "");
  add(HEN_ENABLED, true);
  add("wb-m1w2_33/External Sensor 1", 12);
  add(HEN_ERR, "");
  add("wb-mrm2-mini_46/K2", false);
  add("wb-mrm2-mini_46/K2#error", "");
  add(HEAT_ALLOWED, true);

  return {
    rule: rule,
    dev: dev,
    store: store,
    logs: logs,
    rules: rules,
    add: add,
    tick: function () { timers[0](); },
    advance: function (ms) { clock += ms; },
    now: function () { return clock; }
  };
}

function state(e, key) { return e.dev[(key || "office") + "-keepalive/state"]; }
function alert(e, key) { return e.dev[(key || "office") + "-keepalive/alert_code"]; }

var failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("scenario-keepalive.js: сторож сценариев без контроллера");

var S = makeEnv().rule.STATE;

check("прогрев: первые 60 с решений не принимает", function () {
  var e = makeEnv();
  e.tick();
  assert.strictEqual(state(e), S.OK);
  assert.strictEqual(alert(e), 0);
  assert.deepStrictEqual(e.logs, []);
});

check("авария: самоотключение -> ожидание -> лечение -> тревога 2", function () {
  var e = makeEnv();
  e.advance(61000);

  e.dev[OFFICE_ERR] = "r";
  e.tick();
  assert.strictEqual(state(e), S.CHANNEL_ERROR, "канал в ошибке");
  assert.strictEqual(alert(e), 0, "пока сценарий работает — тихо");
  assert.strictEqual(e.store["office_autoOff"], undefined, "маркера ещё нет");

  e.dev[OFFICE_ENABLED] = false;   // так сценарий выключает защита wb-scenarios
  e.tick();
  assert.strictEqual(e.store["office_autoOff"], "1", "самоотключение запомнено");
  assert.strictEqual(alert(e), 1, "тревога «сценарий выключен»");
  assert.ok(e.logs.join("\n").indexOf("считаю самоотключением") !== -1,
    "неоднозначный случай отмечен в логе");

  e.dev[OFFICE_ERR] = "";
  e.tick();
  assert.strictEqual(state(e), S.WAITING_STABLE, "ждёт стабилизации");
  assert.strictEqual(alert(e), 1);

  e.advance(5 * 60000);
  e.tick();
  assert.strictEqual(e.dev[OFFICE_ENABLED], true, "сценарий включён обратно");

  e.tick();   // подтверждение записи на следующем тике
  assert.strictEqual(state(e), S.HEALED, "вылечен");
  assert.strictEqual(alert(e), 2, "тревога 2 для HA");
  assert.strictEqual(e.dev["office-keepalive/heal_count"], 1);

  e.tick();
  assert.strictEqual(state(e), S.OK, "дальше сценарий работает");
  assert.strictEqual(alert(e), 0);
  assert.strictEqual(e.store["office_autoOff"], "0", "маркер снят");
});

check("ручное выключение не лечится, даже если ошибка пришла позже", function () {
  var e = makeEnv();
  e.advance(61000);

  e.dev[OFFICE_ENABLED] = false;
  e.tick();
  assert.strictEqual(state(e), S.MANUAL, "выключили руками — не трогаем");

  e.dev[OFFICE_ERR] = "r";   // ошибка уже после выключения
  e.tick();
  assert.notStrictEqual(e.store["office_autoOff"], "1", "маркер не ставится");
  e.dev[OFFICE_ERR] = "";
  e.tick();

  e.advance(60 * 60000);   // раньше здесь срабатывало окно 30 мин
  e.tick();
  assert.strictEqual(e.dev[OFFICE_ENABLED], false, "сценарий остаётся выключенным");
  assert.strictEqual(alert(e), 0, "тревоги нет");
});

check("тормоз: 5 лечений за 6 ч, следующий тик его не затирает", function () {
  var e = makeEnv();
  e.advance(61000);
  e.dev[OFFICE_ENABLED] = false;
  e.store["office_autoOff"] = "1";
  e.store["office_lastErrorAt"] = e.now() - 10 * 60000;
  e.store["office_healTimes"] = JSON.stringify([1, 2, 3, 4, 5].map(function () {
    return e.now();
  }));

  e.tick();
  assert.strictEqual(state(e), S.BRAKE);
  assert.strictEqual(alert(e), 4, "тревога «нужен человек»");
  assert.strictEqual(e.dev["office-keepalive/enabled"], false, "сторож выключил себя");

  e.tick();
  assert.strictEqual(state(e), S.BRAKE, "следующий тик не затирает тормоз");
  assert.strictEqual(alert(e), 4, "тревога 4 не затирается");

  e.dev["office-keepalive/enabled"] = true;   // человек включил сторож вручную
  e.tick();
  assert.strictEqual(e.dev["office-keepalive/heal_count"], 0, "счётчик сброшен");
  assert.strictEqual(e.store["office_healTimes"], "[]");
});

check("неудачные лечения считаются в тормоз", function () {
  var e = makeEnv();
  e.advance(61000);
  e.dev[OFFICE_ERR] = "r";
  e.tick();
  e.dev[OFFICE_ENABLED] = false;
  e.tick();
  e.dev[OFFICE_ERR] = "";
  e.advance(6 * 60000);

  // Запись в rule_enabled не применяется: контрол readonly или связь потеряна.
  Object.defineProperty(e.dev, OFFICE_ENABLED, {
    get: function () { return false; },
    set: function () {},
    configurable: true
  });

  e.tick();   // попытка включить
  e.tick();   // запись не применилась
  assert.strictEqual(state(e), S.HEAL_FAILED);
  assert.strictEqual(alert(e), 3);
  assert.strictEqual(JSON.parse(e.store["office_healTimes"]).length, 1);

  for (var i = 0; i < 40 && state(e) !== S.BRAKE; i++) {
    e.tick();
  }
  assert.strictEqual(state(e), S.BRAKE, "после 5 неудач — тормоз");
  assert.strictEqual(alert(e), 4);
  assert.strictEqual(e.dev["office-keepalive/enabled"], false);
  assert.strictEqual(JSON.parse(e.store["office_healTimes"]).length, 5);
});

check("пропавший топик сценария -> NO_CONFIG и alert 5", function () {
  var e = makeEnv();
  e.advance(61000);
  delete e.dev[OFFICE_ENABLED];
  e.tick();
  assert.strictEqual(state(e), S.NO_CONFIG);
  assert.strictEqual(alert(e), 5);
  assert.ok(e.logs.join("\n").indexOf("не найдены топики") !== -1);
});

check("выключенный сторож не поднимает NO_CONFIG", function () {
  var e = makeEnv();
  e.advance(61000);
  e.dev["office-keepalive/enabled"] = false;
  delete e.dev[OFFICE_ENABLED];
  e.tick();
  assert.strictEqual(state(e), S.DISABLED);
  assert.strictEqual(alert(e), 0);
});

check("пропажа топика не затирает тормоз", function () {
  var e = makeEnv();
  e.advance(61000);
  e.dev[OFFICE_ENABLED] = false;
  e.store["office_autoOff"] = "1";
  e.store["office_lastErrorAt"] = e.now() - 10 * 60000;
  e.store["office_healTimes"] = JSON.stringify([1, 2, 3, 4, 5].map(function () {
    return e.now();
  }));
  e.tick();
  assert.strictEqual(state(e), S.BRAKE);

  delete e.dev[OFFICE_ENABLED];
  e.tick();
  assert.strictEqual(state(e), S.BRAKE, "тормоз важнее пропавшего топика");
  assert.strictEqual(alert(e), 4);
});

check("курятник: днём молчит, вечером лечит независимо от возраста ошибки", function () {
  var e = makeEnv();
  e.advance(61000);

  e.dev[HEN_ERR] = "r";
  e.tick();
  e.dev[HEN_ENABLED] = false;
  e.tick();
  assert.strictEqual(e.store["henhouse_autoOff"], "1");

  e.dev[HEN_ERR] = "";
  e.dev[HEAT_ALLOWED] = false;   // день, сценарий выключен штатным правилом
  e.tick();
  assert.strictEqual(state(e, "henhouse"), S.SUPPRESSED);
  assert.strictEqual(alert(e, "henhouse"), 0, "ложных дневных пушей нет");

  e.advance(12 * 3600000);   // ошибке уже больше 30 минут
  e.tick();
  assert.strictEqual(state(e, "henhouse"), S.SUPPRESSED, "днём по-прежнему молчит");

  e.dev[HEAT_ALLOWED] = true;
  e.tick();
  assert.strictEqual(e.dev[HEN_ENABLED], true, "вечером сценарий возвращён");
  e.tick();
  assert.strictEqual(state(e, "henhouse"), S.HEALED);
});

check("самоотключение в период прогрева тоже запоминается", function () {
  var e = makeEnv();
  e.advance(10000);   // ещё внутри startupGraceMs
  e.dev[OFFICE_ERR] = "r";
  e.dev[OFFICE_ENABLED] = false;
  e.tick();
  assert.strictEqual(e.store["office_autoOff"], "1", "маркер поставлен до первого решения");
  assert.ok(e.store["office_lastErrorAt"] > 0, "время ошибки запомнено в прогреве");

  e.dev[OFFICE_ERR] = "";
  e.advance(60000);
  e.tick();
  assert.strictEqual(state(e), S.WAITING_STABLE, "5 минут стабилизации соблюдены");

  e.advance(5 * 60000);
  e.tick();   // лечение
  assert.strictEqual(e.dev[OFFICE_ENABLED], true);
  e.tick();
  assert.strictEqual(state(e), S.HEALED);
});

check("зависшее подтверждение лечения забывается", function () {
  var e = makeEnv();
  e.advance(61000);
  e.dev[OFFICE_ERR] = "r";
  e.tick();
  e.dev[OFFICE_ENABLED] = false;
  e.tick();
  e.dev[OFFICE_ERR] = "";
  e.advance(6 * 60000);
  e.tick();   // попытка включить, pending создан

  // Подтверждение не пришло: сценарий снова выключен, а тик случился поздно.
  e.dev[OFFICE_ENABLED] = false;
  e.advance(4 * 60000);
  e.tick();
  assert.ok(e.logs.join("\n").indexOf("подтверждение лечения не дождалось") !== -1,
    "просроченная попытка отброшена с предупреждением");
  assert.notStrictEqual(state(e), S.HEAL_FAILED, "ложного HEAL_FAILED нет");
  assert.strictEqual(JSON.parse(e.store["office_healTimes"]).length, 1,
    "забытая попытка тоже расходует тормоз");
  assert.strictEqual(e.dev["office-keepalive/heal_count"], 1);
});

check("тексты тормоза собираются из CFG", function () {
  var e = makeEnv();
  e.rule.CFG.brakeCount = 3;
  e.rule.CFG.brakeWindowMs = 2 * 3600000;
  e.advance(61000);
  e.dev[OFFICE_ENABLED] = false;
  e.store["office_autoOff"] = "1";
  e.store["office_lastErrorAt"] = e.now() - 10 * 60000;
  e.store["office_healTimes"] = JSON.stringify([1, 2, 3].map(function () {
    return e.now();
  }));

  e.tick();
  assert.strictEqual(state(e), S.BRAKE);
  assert.ok(e.dev["office-keepalive/reason"].indexOf("лечений за 2 ч: 3") !== -1,
    "причина берёт окно из CFG");
  assert.ok(e.dev["office-keepalive/alert_text"].indexOf("3 лечений за 2 ч") !== -1,
    "тревога берёт порог и окно из CFG");
});

check("isCritical: любой непустой код — авария, незнакомый пишется один раз", function () {
  var e = makeEnv();
  var isCritical = e.rule.isCritical;
  assert.strictEqual(isCritical(undefined), false);
  assert.strictEqual(isCritical(null), false);
  assert.strictEqual(isCritical(""), false);
  assert.strictEqual(isCritical("r"), true);
  assert.strictEqual(isCritical("w"), true);
  assert.strictEqual(isCritical("rw"), true);

  var before = e.logs.length;
  assert.strictEqual(isCritical("timeout"), true, "незнакомый формат не прячет аварию");
  assert.strictEqual(e.logs.length, before + 1, "незнакомый код залогирован");
  assert.strictEqual(isCritical("timeout"), true);
  assert.strictEqual(e.logs.length, before + 1, "повторно не спамит");
});

Date.now = realNow;

console.log(failures === 0 ? "\nвсе проверки пройдены" : "\nпровалено проверок: " + failures);
process.exit(failures === 0 ? 0 : 1);
