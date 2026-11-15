// Version: 1
// Окна работы котла на БКН: фиксируем провал подачи и следим за выравниванием
// подача/обратка. Нужно для калибровки датчиков относительно друг друга:
// когда подвода тепла нет и фронт улёгся, разница показаний = смещение датчиков.
//
// История пишется автоматически: wb-mqtt-db собирает все каналы ("+/+"),
// поэтому достаточно публиковать значения в VD gvs-window.

var CHECK_SEC = 60;        // шаг наблюдения
var HISTORY = 6;           // глубина истории подачи, минут
var DROP_K = 1.0;          // падение подачи, считаем началом окна БКН
var PLATEAU_MIN = 8;       // после стольких минут окна считаем, что фронт улёгся

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
    plateau_delta: { title: "ΔT на плато, K", type: "value", value: 0, readonly: true, order: 7 },
    plateau_ready: { title: "Плато достигнуто", type: "switch", value: false, readonly: true, order: 8 },
    windows: { title: "Окон за сутки", type: "value", value: 0, readonly: true, order: 9 }
  }
});

var history = [];          // подача за последние минуты
var active = false;
var elapsed = 0;
var minDelta = 0;
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
    windows++;
    log("БКН: подача упала на " + drift.toFixed(2) + " K за " + HISTORY + " мин, окно открыто");
    dev[DEV + "/plateau_ready"] = false;
    dev[DEV + "/plateau_delta"] = 0;
  }

  if (active) {
    elapsed++;
    if (delta < minDelta) minDelta = delta;
    if (elapsed >= PLATEAU_MIN) {
      dev[DEV + "/plateau_delta"] = delta;
      dev[DEV + "/plateau_ready"] = true;
    }
    if (drift >= DROP_K) {
      active = false;
      log("БКН: подача вернулась на " + drift.toFixed(2) + " K, окно закрыто через " +
          elapsed + " мин, мин ΔT " + minDelta.toFixed(2) +
          (elapsed >= PLATEAU_MIN ? ", плато ΔT " + delta.toFixed(2) : ", плато не достигнуто"));
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
