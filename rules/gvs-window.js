// Version: 2
// Окна работы котла на БКН: фиксируем провал подачи и следим за выравниванием
// подача/обратка. Нужно для калибровки датчиков относительно друг друга.
//
// v2 (после первого пойманного окна 18:31–18:45):
//  • plateau_delta фиксируется ОДИН раз на 8-й минуте и больше не перезаписывается —
//    в v1 он затирался каждую минуту и к закрытию окна хранил ΔT уже на выходе (4,63 вместо 1,06);
//  • добавлен delta_drift — скорость изменения ΔT в конце окна, K/мин;
//  • добавлен settled — «ΔT встала» (|drift| ≤ 0,05 K/мин). Только при нём плато
//    считается установившимся; но и тогда это смещение + остаточный перепад от тепла в контуре.
//
// История пишется автоматически: wb-mqtt-db собирает все каналы ("+/+") —
// значения лягут в data.db сами, отдельный файл не нужен.

var CHECK_SEC = 60;        // шаг наблюдения
var HISTORY = 6;           // глубина истории подачи, минут
var DROP_K = 1.0;          // падение подачи, считаем началом окна БКН
var PLATEAU_MIN = 8;       // с этой минуты фиксируем плато
var SETTLED_K_MIN = 0.05;  // порог «ΔT встала», K/мин

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
    plateau_delta: { title: "ΔT на плато (8-я мин), K", type: "value", value: 0, readonly: true, order: 7 },
    plateau_ready: { title: "Плато зафиксировано", type: "switch", value: false, readonly: true, order: 8 },
    delta_drift: { title: "Дрейф ΔT, K/мин", type: "value", value: 0, readonly: true, order: 9 },
    settled: { title: "ΔT установилась", type: "switch", value: false, readonly: true, order: 10 },
    windows: { title: "Окон за сутки", type: "value", value: 0, readonly: true, order: 11 }
  }
});

var history = [];          // подача за последние минуты
var deltaHistory = [];     // ΔT за последние минуты (для дрейфа)
var active = false;
var elapsed = 0;
var minDelta = 0;
var plateauFixed = false;
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
    plateauFixed = false;
    deltaHistory = [];
    windows++;
    log("БКН: подача упала на " + drift.toFixed(2) + " K за " + HISTORY + " мин, окно открыто");
    dev[DEV + "/plateau_ready"] = false;
    dev[DEV + "/plateau_delta"] = 0;
    dev[DEV + "/settled"] = false;
  }

  if (active) {
    elapsed++;
    if (delta < minDelta) minDelta = delta;

    deltaHistory.push(delta);
    if (deltaHistory.length > 4) deltaHistory.shift();
    var deltaDrift = deltaHistory.length === 4
      ? (deltaHistory[3] - deltaHistory[0]) / 3
      : 0;

    // плато фиксируем один раз — иначе к закрытию окна в нём окажется значение на выходе
    if (elapsed >= PLATEAU_MIN && !plateauFixed) {
      plateauFixed = true;
      dev[DEV + "/plateau_delta"] = delta;
      dev[DEV + "/plateau_ready"] = true;
      log("БКН: плато зафиксировано на " + elapsed + "-й мин, ΔT " + delta.toFixed(2) +
          " K, дрейф " + deltaDrift.toFixed(3) + " K/мин");
    }

    dev[DEV + "/delta_drift"] = Math.round(deltaDrift * 1000) / 1000;
    dev[DEV + "/settled"] = !!(plateauFixed && Math.abs(deltaDrift) <= SETTLED_K_MIN);

    if (drift >= DROP_K) {
      active = false;
      log("БКН: подача вернулась на " + drift.toFixed(2) + " K, окно закрыто через " +
          elapsed + " мин, мин ΔT " + minDelta.toFixed(2) +
          (plateauFixed ? ", плато ΔT " + dev[DEV + "/plateau_delta"] +
            ", дрейф " + deltaDrift.toFixed(3) + " K/мин" : ", плато не достигнуто"));
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
