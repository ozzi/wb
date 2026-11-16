// Version: 3
// Окна работы котла на БКН: фиксируем провал подачи и ждём выравнивания
// подача/обратка. Нужно для калибровки датчиков относительно друг друга.
//
// История правок:
//  v1 — plateau_delta перезаписывался каждую минуту, к закрытию окна хранил ΔT на выходе (4,63).
//  v2 — плато фиксировалось один раз на 8-й минуте; по ночным данным оказалось, что 8-я минута
//       тоже не равна установлению: в окне 01:56–04:44 зафиксировалось 4,88, а ΔT дошла до 0,98.
//  v3 — плато = ПОСЛЕДНЕЕ значение, при котором ΔT установилась (|дрейф| ≤ 0,05 K/мин),
//       и оно обновляется, пока окно открыто; elapsed сбрасывается при закрытии;
//       окна длиннее 60 минут помечаются как long (ночной простой, а не цикл ГК).
//
// История пишется автоматически: wb-mqtt-db собирает все каналы ("+/+") — значения лягут в data.db.

var CHECK_SEC = 60;          // шаг наблюдения
var HISTORY = 6;             // глубина истории подачи, минут
var DROP_K = 1.0;            // падение подачи, считаем началом окна БКН
var PLATEAU_MIN = 8;         // раньше этой минуты плато не ищем
var SETTLED_K_MIN = 0.05;    // порог «ΔT встала», K/мин
var LONG_WINDOW_MIN = 60;    // дольше — это простой, а не цикл ГК

var DEV = "gvs-window";
var IN_T = "wb-ms_25/External Sensor 1";
var OUT_T = "wb-ms_25/External Sensor 2";

defineVirtualDevice(DEV, {
  title: "Окна БКН (калибровка датчиков)",
  cells: {
    active: { title: "Окно открыто", type: "switch", value: false, readonly: true, order: 1 },
    elapsed_min: { title: "Длительность, мин", type: "value", value: 0, readonly: true, order: 2 },
    t_in: { title: "Подача, °C", type: "temperature", value: 0, readonly: true, order: 3 },
    t_out: { title: "Обратка, °C", type: "temperature", value: 0, readonly: true, order: 4 },
    delta: { title: "ΔT, K", type: "value", value: 0, readonly: true, order: 5 },
    min_delta: { title: "Мин. ΔT в окне, K", type: "value", value: 0, readonly: true, order: 6 },
    plateau_delta: { title: "ΔT на плато (установившаяся)", type: "value", value: 0, readonly: true, order: 7 },
    plateau_ready: { title: "Плато найдено", type: "switch", value: false, readonly: true, order: 8 },
    delta_drift: { title: "Дрейф ΔT, K/мин", type: "value", value: 0, readonly: true, order: 9 },
    settled: { title: "ΔT установилась", type: "switch", value: false, readonly: true, order: 10 },
    long_window: { title: "Длинное окно (>60 мин)", type: "switch", value: false, readonly: true, order: 11 },
    windows: { title: "Окон за сутки", type: "value", value: 0, readonly: true, order: 12 }
  }
});

var history = [];          // подача за последние минуты
var deltaHistory = [];     // ΔT за последние минуты (для дрейфа)
var active = false;
var elapsed = 0;
var minDelta = 0;
var plateauFound = false;
var windows = 0;
var dayKey = "";

function num(topic) {
  var v = dev[topic];
  return typeof v === "number" ? v : NaN;
}

function tick() {
  var tIn = num(IN_T);
  var tOut = num(OUT_T);
  if (isNaN(tIn) || isNaN(tOut) || tIn < 5 || tOut < 5) return;

  var today = (new Date()).getDate();
  if (dayKey !== today) { dayKey = today; windows = 0; }

  history.push(tIn);
  if (history.length > HISTORY + 1) history.shift();

  var delta = Math.round((tIn - tOut) * 100) / 100;
  var drift = history.length > HISTORY ? tIn - history[0] : 0;

  if (!active && drift <= -DROP_K) {
    active = true;
    elapsed = 0;
    minDelta = delta;
    plateauFound = false;
    deltaHistory = [];
    windows++;
    log("БКН: подача упала на " + drift.toFixed(2) + " K за " + HISTORY + " мин, окно открыто");
    dev[DEV + "/plateau_ready"] = false;
    dev[DEV + "/plateau_delta"] = 0;
    dev[DEV + "/settled"] = false;
    dev[DEV + "/long_window"] = false;
  }

  if (active) {
    elapsed++;
    if (delta < minDelta) minDelta = delta;

    deltaHistory.push(delta);
    if (deltaHistory.length > 4) deltaHistory.shift();
    var deltaDrift = deltaHistory.length === 4
      ? (deltaHistory[3] - deltaHistory[0]) / 3
      : 0;
    var isSettled = elapsed >= PLATEAU_MIN && Math.abs(deltaDrift) <= SETTLED_K_MIN;

    // плато — последнее УСТАНОВИВШЕЕСЯ значение, а не значение по таймеру
    if (isSettled) {
      if (!plateauFound) {
        plateauFound = true;
        log("БКН: ΔT установилась на " + elapsed + "-й мин, " + delta.toFixed(2) +
            " K, дрейф " + deltaDrift.toFixed(3) + " K/мин");
      }
      dev[DEV + "/plateau_delta"] = delta;
      dev[DEV + "/plateau_ready"] = true;
    }

    dev[DEV + "/delta_drift"] = Math.round(deltaDrift * 1000) / 1000;
    dev[DEV + "/settled"] = !!isSettled;
    dev[DEV + "/long_window"] = elapsed > LONG_WINDOW_MIN;

    if (drift >= DROP_K) {
      active = false;
      log("БКН: подача вернулась на " + drift.toFixed(2) + " K, окно закрыто через " +
          elapsed + " мин" + (elapsed > LONG_WINDOW_MIN ? " (длинное, простой)" : "") +
          ", мин ΔT " + minDelta.toFixed(2) +
          (plateauFound ? ", плато ΔT " + dev[DEV + "/plateau_delta"] : ", плато не найдено"));
      elapsed = 0;
      dev[DEV + "/settled"] = false;
    }
  }

  dev[DEV + "/active"] = !!active;
  dev[DEV + "/elapsed_min"] = elapsed;
  dev[DEV + "/t_in"] = Math.round(tIn * 10000) / 10000;
  dev[DEV + "/t_out"] = Math.round(tOut * 10000) / 10000;
  dev[DEV + "/delta"] = delta;
  dev[DEV + "/min_delta"] = Math.round(minDelta * 100) / 100;
  dev[DEV + "/windows"] = windows;
}

setInterval(tick, CHECK_SEC * 1000);
tick();
