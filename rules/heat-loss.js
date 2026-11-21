// Version: 2
// Теплопотери дома по комнатам — монитор.
//
// Источник модели: Google Sheets «Тепловой расчёт», листы «Исходные данные» и «Теплопотери».
// Порт сверен с таблицей до 0.02 % (11 771 против 11 769 Вт при −25 °C), после чего в модель
// внесены правки по аудиту от 22.11.2026:
//
//   1. r = 0.9 для стен и крыши (теплотехническая однородность: перемычки, углы, примыкания).
//      R_стен 3.7473 → 3.3726; R_крыши 5.4214 → 4.8793 (в таблице 4.1058 из-за множителя 0.75,
//      который подменял 20 см утеплителя на 15 — это исправлено).
//   2. Пол: убран необъяснимый член 2.1 м²·К/Вт. R пола 5.156 → 3.2295 для всех помещений
//      1 этажа (пол по грунту/над подпольем), потери пола выросли в 1.6 раза.
//   3. Ориентация: надбавки по фасаду (С 1.10, В 1.05, Ю 1.00, З 1.05) применяются к стенам
//      и окнам. Коэффициент kc «Угл» из таблицы сохранён и работает по стенам, как в исходнике.
//   4. Гостиная — второй свет: объём 17.96 × 5.2 + 8.25 × 2.7 = 115.69 м³ (в таблице 70.78),
//      поэтому доля приточного воздуха у неё больше, чем по площади пола.
//   5. Вентиляция естественная (кухня, два санузла, детская): вместо кратности 0.237 1/ч
//      нормативный воздухообмен 170 м³/ч (90 кухня + 25 + 25 санузлы + 30 детская),
//      приток распределён по жилым помещениям долями vent.
//   6. Площадь для удельных потерь — фактическая сумма 193.79 м², а не круглые 200.
//   7. Расчёт конвекторов не ведётся: модель отвечает на вопрос «сколько теряет дом», а не
//      «чем добрать». Мощность ТП в модели не участвует.
//   8. Проектный расчёт при −27 °C убран: правило считает только по фактической уличной
//      температуре, без второго числа «а если мороз».
//
// Температуры комнат приходят из HA (Zigbee в ZHA, WB их не видит): HA пишет значения
// в каналы t-* этого VD, правило читает их и считает потери. Отвалившийся или нулевой датчик
// заменяется проектной температурой помещения и попадает в канал rooms-on-project, чтобы
// «дом остыл» не путалось с «датчик пропал».
//
// Правило ничего не переключает: только публикует числа в свой VD.

var DEV = "heat-loss";

// Единственный источник уличной температуры: wb-m1w2_107 в уличной коробке.
// Резервный wb-m1w2_33 не используется: он стоит не на улице, и подмена дала бы
// правдоподобное, но неверное число вместо честного «нет датчика».
var OUTDOOR = "wb-m1w2_107/External Sensor 1";

// Маркер «данных ещё не было». Обязан лежать вне диапазонов plausibleT/plausibleOut
// (-40…60 и -45…45): если диапазоны расширить за -999, маркер станет показанием.
var NO_DATA = -999;

var T_PODVAL = 8;          // температура подвала/грунта, °C
var K_AIR = 0.34;          // объёмная теплоёмкость воздуха, Вт·ч/(м³·К)
var L_VENT = 170;          // нормативный воздухообмен, м³/ч
var AREA_HOUSE = 193.79;   // суммарная площадь помещений, м²
var R_WALL_SRC = 3.747393221;   // R стены по таблице (380 мм кладки + 100 мм утеплителя)
var R_CEIL_SRC = 5.4214;   // 1/8.7 + 1/23 + 0.20/0.038, без подмены толщины
var R_FLOOR = 3.229525862; // 1/8.7 + 1/17 + 0.1146 + 0.10/0.034
var R_WIN = 0.47;          // по паспорту окон; при замене стеклопакетов править здесь
var R_WALL = R_WALL_SRC * 0.9;
var R_CEIL = R_CEIL_SRC * 0.9;

// Поля:
//  kc — коэффициент «Угл» из таблицы (по стенам, как в исходнике)
//  ko — надбавка на ориентацию фасада
//  vent — доля приточного воздуха
//  tProj — проектная температура; используется, когда датчик комнаты молчит
var ROOMS = [
  { id: "spalnya-1e-sever", title: "Спальня 1э север", floor: 1, a: 19.5584, kc: 1.05, ko: 1.10,
    aWall: 31.59, aWin: 2.8704, aFloorOut: 19.5584, floorToOut: false, aCeil: 0,
    vent: 0.1642, tProj: 23 },

  { id: "spalnya-1e-yug", title: "Спальня 1э юг", floor: 1, a: 14.792, kc: 1.05, ko: 1.00,
    aWall: 26.298, aWin: 2.4336, aFloorOut: 14.792, floorToOut: false, aCeil: 0,
    vent: 0.1240, tProj: 23 },

  { id: "vannaya-1e", title: "Ванная 1э", floor: 1, a: 5.736, kc: 1.0, ko: 1.05,
    aWall: 8.046, aWin: 1.17, aFloorOut: 5.736, floorToOut: false, aCeil: 0,
    vent: 0, tProj: 25 },

  { id: "kotelnaya", title: "Котельная", floor: 1, a: 4.992, kc: 1.0, ko: 1.05,
    aWall: 7.965, aWin: 1.17, aFloorOut: 4.992, floorToOut: false, aCeil: 0,
    vent: 0, tProj: 23 },

  { id: "holl-1e", title: "Холл 1э", floor: 1, a: 14.632, kc: 1.0, ko: 1.0,
    aWall: 0, aWin: 0, aFloorOut: 14.632, floorToOut: false, aCeil: 7.7876,
    vent: 0, tProj: 23 },

  { id: "tambur", title: "Тамбур", floor: 1, a: 4.3164, kc: 1.0, ko: 1.05,
    aWall: 2.808, aWin: 2.08, aFloorOut: 4.3164, floorToOut: false, aCeil: 0,
    vent: 0, tProj: 21 },

  { id: "kuhnya", title: "Кухня", floor: 1, a: 19.0464, kc: 1.05, ko: 1.05,
    aWall: 25.92, aWin: 5.7408, aFloorOut: 19.0464, floorToOut: false, aCeil: 0,
    vent: 0, tProj: 23 },

  { id: "gostinaya", title: "Гостиная (2-й свет)", floor: 1, a: 26.2144, kc: 1.05, ko: 1.05,
    aWall: 62.5625, aWin: 16.227, aFloorOut: 26.2144, floorToOut: false, aCeil: 17.9644,
    vent: 0.2199, tProj: 23 },

  { id: "spalnya-2e-sever", title: "Спальня 2э север", floor: 2, a: 19.5584, kc: 1.05, ko: 1.10,
    aWall: 29.219, aWin: 2.8704, aFloorOut: 0, floorToOut: false, aCeil: 25.1367807,
    vent: 0.1642, tProj: 23 },

  { id: "vannaya-2e", title: "Ванная 2э", floor: 2, a: 5.736, kc: 1.0, ko: 1.05,
    aWall: 8.046, aWin: 1.17, aFloorOut: 0, floorToOut: false, aCeil: 5.736,
    vent: 0, tProj: 25 },

  { id: "servernaya", title: "Серверная", floor: 2, a: 4.992, kc: 1.0, ko: 1.0,
    aWall: 7.965, aWin: 1.17, aFloorOut: 0, floorToOut: false, aCeil: 4.992,
    vent: 0, tProj: 23 },

  { id: "holl-2e", title: "Холл 2э", floor: 2, a: 6.8444, kc: 1.0, ko: 1.0,
    aWall: 0, aWin: 0, aFloorOut: 0, floorToOut: false, aCeil: 6.8444,
    vent: 0, tProj: 23 },

  { id: "antresol", title: "Антресоль", floor: 2, a: 8.25, kc: 1.05, ko: 1.0,
    aWall: 5.25, aWin: 0, aFloorOut: 0, floorToOut: false, aCeil: 8.25,
    vent: 0, tProj: 23 },

  { id: "spalnya-2e-vostok", title: "Спальня 2э восток", floor: 2, a: 20.0704, kc: 1.05, ko: 1.05,
    aWall: 32.048, aWin: 2.8704, aFloorOut: 5.2784, floorToOut: true, aCeil: 20.0704,
    vent: 0.1680, tProj: 23 },

  { id: "spalnya-2e-zapad", title: "Спальня 2э запад", floor: 2, a: 19.0464, kc: 1.05, ko: 1.05,
    aWall: 25.404, aWin: 4.324, aFloorOut: 0, floorToOut: false, aCeil: 19.0464,
    vent: 0.1597, tProj: 23 }
];

// Теплопотери помещения, Вт
function roomLoss(room, tIn, tOut) {
  var dOut = tIn - tOut;
  var wall = room.kc * room.ko * (room.aWall - room.aWin) / R_WALL * dOut;
  var win = room.ko * room.aWin / R_WIN * dOut;
  var floor = 0;
  if (room.aFloorOut > 0) {
    floor = room.aFloorOut / R_FLOOR * (room.floorToOut ? dOut : (tIn - T_PODVAL));
  }
  var ceil = room.aCeil > 0 ? room.aCeil / R_CEIL * dOut : 0;
  var vent = room.vent * L_VENT * K_AIR * dOut;
  return { total: wall + win + floor + ceil + vent,
           wall: wall, win: win, floor: floor, ceil: ceil, vent: vent };
}

// Сводка. tByRoom — {id: температура}; отсутствующие берутся проектные.
function calcHouse(tOut, tByRoom) {
  var f1 = 0, f2 = 0, wall = 0, win = 0, floor = 0, ceil = 0, vent = 0, onProject = 0;
  var perRoom = {};
  for (var i = 0; i < ROOMS.length; i++) {
    var r = ROOMS[i];
    var t = r.tProj;
    if (tByRoom && tByRoom[r.id] !== undefined && tByRoom[r.id] !== null) t = tByRoom[r.id];
    else onProject++;
    var l = roomLoss(r, t, tOut);
    perRoom[r.id] = l;
    wall += l.wall; win += l.win; floor += l.floor; ceil += l.ceil; vent += l.vent;
    if (r.floor === 1) f1 += l.total; else f2 += l.total;
  }
  var total = f1 + f2;
  return { total: total, floor1: f1, floor2: f2,
           wall: wall, win: win, floorLoss: floor, ceil: ceil, vent: vent,
           perM2: total / AREA_HOUSE, onProject: onProject, perRoom: perRoom };
}

// --- VD ---

var cells = {};
var order = 1;
for (var i = 0; i < ROOMS.length; i++) {
  cells["t-" + ROOMS[i].id] = { title: ROOMS[i].title + ": температура, °C", type: "temperature",
                                value: NO_DATA, readonly: false, order: order++ };
}
for (var j = 0; j < ROOMS.length; j++) {
  cells["w-" + ROOMS[j].id] = { title: ROOMS[j].title + ": потери, Вт", type: "value",
                                value: 0, readonly: true, order: order++ };
}
cells["t-out"] = { title: "Улица, °C", type: "temperature", value: NO_DATA, readonly: true, order: order++ };
cells["total-w"] = { title: "Теплопотери дома, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["floor1-w"] = { title: "1 этаж, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["floor2-w"] = { title: "2 этаж, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["w-per-m2"] = { title: "Удельные, Вт/м²", type: "value", value: 0, readonly: true, order: order++ };
cells["wall-w"] = { title: "Стены, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["win-w"] = { title: "Окна, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["vent-w"] = { title: "Вентиляция, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["floor-w"] = { title: "Пол, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["ceil-w"] = { title: "Потолок и крыша, Вт", type: "value", value: 0, readonly: true, order: order++ };
cells["rooms-on-project"] = { title: "Комнат без датчика", type: "value", value: 0, readonly: true, order: order++ };
cells.valid = { title: "Данные пригодны", type: "switch", value: false, readonly: true, order: order++ };
cells.status = { title: "Состояние", type: "text", value: "нет данных", readonly: true, order: order++ };
cells.updated = { title: "Обновлено", type: "text", value: "—", readonly: true, order: order++ };

// Побочные эффекты намеренно безусловные — как во всех остальных правилах репозитория.
// «TypeError: call target not an object» на каждом тике давала не обёртка, а объектная
// форма when: { cron: "..." } (см. комментарий у heat_loss_cron).
// Для тестов в Node подставляются заглушки: global.dev, defineVirtualDevice,
// defineRule и cron — полный набор, иначе require() падает до module.exports.
defineVirtualDevice(DEV, { title: "Теплопотери по комнатам", cells: cells });

// Ноль — законное показание (остывание дома до 0 °C — как раз тот случай, ради
// которого монитор и нужен). «Нет данных» помечается значением NO_DATA.
function inRange(t, min, max) {
  return typeof t === "number" && !isNaN(t) && t > min && t < max;
}

function plausibleT(t) { return inRange(t, -40, 60); }
function plausibleOut(t) { return inRange(t, -45, 45); }

function two(n) { return (n < 10 ? "0" : "") + n; }
function stamp() {
  var d = new Date();
  return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
}

// запись только при изменении: иначе каждое тиканье датчика даёт лишний пакет в топик
function put(cell, value) {
  if (dev[DEV + "/" + cell] !== value) dev[DEV + "/" + cell] = value;
}

function readOutdoor() {
  var t = dev[OUTDOOR];
  return plausibleOut(t) ? t : null;
}

// Сброс входов при загрузке правила. Значения каналов VD персистятся в MQTT и при
// переопределении устройства не сбрасываются: на контроллере, где работала прежняя
// версия, в t-* остался её стартовый 0, а теперь 0 — законное показание. Без сброса
// первая же секунда после обновления дала бы «дом при 0 °C» и valid = true.
function resetInputs() {
  for (var i = 0; i < ROOMS.length; i++) put("t-" + ROOMS[i].id, NO_DATA);
  put("t-out", NO_DATA);
}

function recalc() {
  var tOut = readOutdoor();
  if (tOut === null) {
    put("valid", false);
    put("status", "нет уличного датчика");
    return;
  }

  var tByRoom = {};
  var missing = [];
  for (var i = 0; i < ROOMS.length; i++) {
    var r = ROOMS[i];
    var t = dev[DEV + "/t-" + r.id];
    if (plausibleT(t)) tByRoom[r.id] = t;
    else missing.push(r.title);
  }

  var h = calcHouse(tOut, tByRoom);
  for (var k = 0; k < ROOMS.length; k++) {
    put("w-" + ROOMS[k].id, Math.round(h.perRoom[ROOMS[k].id].total));
  }

  put("t-out", Math.round(tOut * 10) / 10);
  put("total-w", Math.round(h.total));
  put("floor1-w", Math.round(h.floor1));
  put("floor2-w", Math.round(h.floor2));
  put("w-per-m2", Math.round(h.perM2 * 10) / 10);
  put("wall-w", Math.round(h.wall));
  put("win-w", Math.round(h.win));
  put("vent-w", Math.round(h.vent));
  put("floor-w", Math.round(h.floorLoss));
  put("ceil-w", Math.round(h.ceil));
  put("rooms-on-project", missing.length);
  put("valid", missing.length === 0);
  put("status", missing.length === 0
      ? "все датчики на связи"
      : "без датчика: " + missing.length + " из " + ROOMS.length);
  put("updated", stamp());
}

var triggers = [];
for (var n = 0; n < ROOMS.length; n++) triggers.push(DEV + "/t-" + ROOMS[n].id);
triggers.push(OUTDOOR);

defineRule("heat_loss_inputs", {
  whenChanged: triggers,
  then: function () { recalc(); }
});

// Периодика — только через cron(...): объект вида { cron: "..." } wb-rules
// пытается вызвать как функцию и падает с «call target not an object» на каждом тике.
// В Node-тестах cron тоже подменяется заглушкой: global.cron = function () { return function () {}; }.
defineRule("heat_loss_cron", {
  when: cron("*/10 * * * *"),
  then: function () { recalc(); }
});

// Первый расчёт при загрузке правила: входам не доверяем (в MQTT могли остаться
// значения прошлой версии), поэтому сначала сброс в NO_DATA, потом счёт.
resetInputs();
recalc();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ROOMS: ROOMS, calcHouse: calcHouse, roomLoss: roomLoss,
                     AREA_HOUSE: AREA_HOUSE, L_VENT: L_VENT,
                     R_WALL: R_WALL, R_CEIL: R_CEIL, R_FLOOR: R_FLOOR };
}
